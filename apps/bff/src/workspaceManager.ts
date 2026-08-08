import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { ChangeSet, ChangedFile } from '../../../packages/protocol/src/agent';

const execFileAsync = promisify(execFile);
const MAX_UI_DIFF_BYTES = 2 * 1024 * 1024;

export interface ManagedRunWorkspace {
  runId: string;
  sourceRoot: string;
  runRoot: string;
  workspacePath: string;
  persistencePath: string;
  patchPath: string;
  baseCommit: string;
  sourceFingerprint: string;
  changeSet?: ChangeSet;
}

interface SourceSnapshot {
  head: string;
  trackedPatch: string;
  untracked: Array<{ path: string; content: Buffer }>;
  fingerprint: string;
}

function assertInside(parent: string, child: string): void {
  const value = relative(resolve(parent), resolve(child));
  if (!value || value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new Error('Managed path escaped its configured parent directory.');
  }
}

function changedStatus(code: string): ChangedFile['status'] {
  if (code.includes('R')) return 'renamed';
  if (code.includes('D')) return 'deleted';
  if (code === '??' || code.includes('A')) return 'added';
  return 'modified';
}

function parseStatus(raw: string): Map<string, ChangedFile['status']> {
  const result = new Map<string, ChangedFile['status']>();
  const records = raw.split('\0').filter(Boolean);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const code = record.slice(0, 2);
    let path = record.slice(3);
    if (code.includes('R') || code.includes('C')) {
      path = records[index + 1] ?? path;
      index += 1;
    }
    result.set(path.replaceAll('\\', '/'), changedStatus(code));
  }
  return result;
}

function validatePatchPath(path: string): void {
  const normalized = path.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new Error(`Unsafe absolute patch path: ${path}`);
  }
  const segments = normalized.split('/');
  if (segments.includes('..') || segments[0] === '.git' || segments[0] === '.meshcli') {
    throw new Error(`Protected patch path: ${path}`);
  }
}

export class WorkspaceManager {
  readonly sourceRoot: string;
  readonly runsRoot: string;
  private readonly runs = new Map<string, ManagedRunWorkspace>();

  constructor(sourceRoot = process.env.AGENT_WORKSPACE_ROOT || process.cwd()) {
    this.sourceRoot = resolve(sourceRoot);
    this.runsRoot = process.env.AGENT_RUNS_DIR
      ? resolve(process.env.AGENT_RUNS_DIR)
      : resolve(this.sourceRoot, '.meshcli', 'runs');
    assertInside(this.sourceRoot, this.runsRoot);
  }

  get(runId: string): ManagedRunWorkspace | undefined {
    return this.runs.get(runId);
  }

  async prepare(runId: string, signal?: AbortSignal): Promise<ManagedRunWorkspace> {
    const existing = this.runs.get(runId);
    if (existing) return existing;
    await this.git(['rev-parse', '--is-inside-work-tree'], this.sourceRoot, signal);
    const requireClean = (process.env.AGENT_REQUIRE_CLEAN_WORKTREE ?? 'false') === 'true';
    if (requireClean) {
      const status = await this.git(['status', '--porcelain=v1', '--untracked-files=normal'], this.sourceRoot, signal);
      if (status.trim()) {
        throw new Error('The real project has uncommitted changes. Commit or stash them before running an Agent.');
      }
    }
    const snapshot = await this.captureSourceSnapshot(signal);

    const runRoot = resolve(this.runsRoot, runId);
    const workspacePath = resolve(runRoot, 'workspace');
    assertInside(this.runsRoot, runRoot);
    assertInside(runRoot, workspacePath);
    await mkdir(runRoot, { recursive: true });
    await this.git(
      ['-c', 'core.autocrlf=false', 'clone', '--local', '--no-hardlinks', '--no-recurse-submodules', '--quiet', this.sourceRoot, workspacePath],
      this.sourceRoot,
      signal,
    );
    if (snapshot.trackedPatch.trim()) {
      const baselinePatchPath = resolve(runRoot, 'baseline.patch');
      await writeFile(baselinePatchPath, snapshot.trackedPatch, 'utf8');
      await this.git(['apply', '--whitespace=nowarn', baselinePatchPath], workspacePath, signal);
    }
    for (const file of snapshot.untracked) {
      validatePatchPath(file.path);
      const target = resolve(workspacePath, file.path);
      assertInside(workspacePath, target);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    if (snapshot.trackedPatch.trim() || snapshot.untracked.length) {
      await this.git(['add', '--all'], workspacePath, signal);
      await this.git([
        '-c', 'user.name=MeshCLI Snapshot',
        '-c', 'user.email=meshcli@example.invalid',
        'commit', '--quiet', '-m', 'MeshCLI run baseline',
      ], workspacePath, signal);
    }
    const managed: ManagedRunWorkspace = {
      runId,
      sourceRoot: this.sourceRoot,
      runRoot,
      workspacePath,
      persistencePath: resolve(runRoot, 'conversation'),
      patchPath: resolve(runRoot, 'change.patch'),
      baseCommit: snapshot.head,
      sourceFingerprint: snapshot.fingerprint,
    };
    this.runs.set(runId, managed);
    return managed;
  }

  async createChangeSet(runId: string, signal?: AbortSignal): Promise<ChangeSet> {
    const managed = this.requireRun(runId);
    const statusRaw = await this.git(['status', '--porcelain=v1', '-z', '--untracked-files=normal'], managed.workspacePath, signal);
    const statuses = parseStatus(statusRaw);
    await this.git(['add', '--intent-to-add', '--', '.'], managed.workspacePath, signal).catch(() => undefined);
    const diff = await this.git(
      ['diff', '--binary', '--full-index', '--no-ext-diff', '--no-color', 'HEAD', '--'],
      managed.workspacePath,
      signal,
      64 * 1024 * 1024,
    );
    await writeFile(managed.patchPath, diff, 'utf8');
    const numstat = await this.git(['diff', '--numstat', 'HEAD', '--'], managed.workspacePath, signal);
    const stats = new Map<string, { additions: number | null; deletions: number | null }>();
    for (const line of numstat.split(/\r?\n/)) {
      if (!line) continue;
      const [added, deleted, ...pathParts] = line.split('\t');
      const path = pathParts.join('\t').replaceAll('\\', '/');
      if (!path) continue;
      stats.set(path, {
        additions: added === '-' ? null : Number(added),
        deletions: deleted === '-' ? null : Number(deleted),
      });
    }
    const files: ChangedFile[] = [...statuses.entries()].map(([path, status]) => {
      validatePatchPath(path);
      const stat = stats.get(path) ?? { additions: null, deletions: null };
      return {
        path,
        status: stat.additions === null && stat.deletions === null ? 'binary' : status,
        additions: stat.additions,
        deletions: stat.deletions,
      };
    });
    const truncated = Buffer.byteLength(diff, 'utf8') > MAX_UI_DIFF_BYTES;
    const visibleDiff = truncated
      ? `${Buffer.from(diff, 'utf8').subarray(0, MAX_UI_DIFF_BYTES).toString('utf8')}\n\n[Diff truncated in UI]`
      : diff;
    const changeSet: ChangeSet = {
      changeSetId: randomUUID(),
      runId,
      baseCommit: managed.baseCommit,
      files,
      diff: visibleDiff,
      truncated,
      createdAt: Date.now(),
    };
    managed.changeSet = changeSet;
    return changeSet;
  }

  async apply(runId: string): Promise<ChangeSet> {
    const managed = this.requireRun(runId);
    if (!managed.changeSet) throw new Error('Run has no change set to apply.');
    const currentCommit = (await this.git(['rev-parse', 'HEAD'], this.sourceRoot)).trim();
    if (currentCommit !== managed.baseCommit) {
      throw new Error('The real project base commit changed after the run started.');
    }
    const currentSnapshot = await this.captureSourceSnapshot();
    if (currentSnapshot.fingerprint !== managed.sourceFingerprint) {
      throw new Error('The real project changed after this Agent run started; patch was not applied.');
    }
    const patch = await readFile(managed.patchPath, 'utf8');
    if (patch.trim()) {
      await this.git(['apply', '--check', '--whitespace=nowarn', managed.patchPath], this.sourceRoot);
      await this.git(['apply', '--whitespace=nowarn', managed.patchPath], this.sourceRoot);
    }
    await this.cleanupWorkspace(managed);
    return managed.changeSet;
  }

  async reject(runId: string): Promise<ChangeSet> {
    const managed = this.requireRun(runId);
    if (!managed.changeSet) throw new Error('Run has no change set to reject.');
    await this.cleanupWorkspace(managed);
    return managed.changeSet;
  }

  async cancel(runId: string): Promise<void> {
    const managed = this.runs.get(runId);
    if (managed) await this.cleanupWorkspace(managed);
  }

  private requireRun(runId: string): ManagedRunWorkspace {
    const managed = this.runs.get(runId);
    if (!managed) throw new Error('Managed run workspace was not found.');
    return managed;
  }

  private async cleanupWorkspace(managed: ManagedRunWorkspace): Promise<void> {
    assertInside(managed.runRoot, managed.workspacePath);
    await rm(managed.workspacePath, { recursive: true, force: true });
  }

  private async captureSourceSnapshot(signal?: AbortSignal): Promise<SourceSnapshot> {
    const head = (await this.git(['rev-parse', 'HEAD'], this.sourceRoot, signal)).trim();
    const trackedPatch = await this.git(
      ['diff', '--binary', '--full-index', '--no-ext-diff', '--no-color', 'HEAD', '--'],
      this.sourceRoot,
      signal,
      64 * 1024 * 1024,
    );
    const rawPaths = await this.git(['ls-files', '--others', '--exclude-standard', '-z'], this.sourceRoot, signal);
    const untracked = [] as Array<{ path: string; content: Buffer }>;
    for (const path of rawPaths.split('\0').filter(Boolean).sort()) {
      validatePatchPath(path);
      const absolutePath = resolve(this.sourceRoot, path);
      assertInside(this.sourceRoot, absolutePath);
      untracked.push({ path: path.replaceAll('\\', '/'), content: await readFile(absolutePath) });
    }
    const hash = createHash('sha256').update(head).update('\0').update(trackedPatch);
    for (const file of untracked) hash.update('\0').update(file.path).update('\0').update(file.content);
    return { head, trackedPatch, untracked, fingerprint: hash.digest('hex') };
  }

  private async git(
    args: string[],
    cwd: string,
    signal?: AbortSignal,
    maxBuffer = 16 * 1024 * 1024,
  ): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer,
      signal,
      windowsHide: true,
    });
    return stdout;
  }
}
