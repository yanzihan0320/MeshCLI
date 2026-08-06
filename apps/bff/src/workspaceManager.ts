import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
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
  changeSet?: ChangeSet;
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
    if ((process.env.AGENT_REQUIRE_CLEAN_WORKTREE ?? 'true') !== 'false') {
      const status = await this.git(['status', '--porcelain=v1', '--untracked-files=normal'], this.sourceRoot, signal);
      if (status.trim()) {
        throw new Error('The real project has uncommitted changes. Commit or stash them before running an Agent.');
      }
    }

    const runRoot = resolve(this.runsRoot, runId);
    const workspacePath = resolve(runRoot, 'workspace');
    assertInside(this.runsRoot, runRoot);
    assertInside(runRoot, workspacePath);
    await mkdir(runRoot, { recursive: true });
    await this.git(
      ['clone', '--local', '--no-hardlinks', '--no-recurse-submodules', '--quiet', this.sourceRoot, workspacePath],
      this.sourceRoot,
      signal,
    );
    const baseCommit = (await this.git(['rev-parse', 'HEAD'], workspacePath, signal)).trim();
    const managed: ManagedRunWorkspace = {
      runId,
      sourceRoot: this.sourceRoot,
      runRoot,
      workspacePath,
      persistencePath: resolve(runRoot, 'conversation'),
      patchPath: resolve(runRoot, 'change.patch'),
      baseCommit,
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
    const status = await this.git(['status', '--porcelain=v1', '--untracked-files=normal'], this.sourceRoot);
    if (status.trim()) throw new Error('The real project is no longer clean; patch was not applied.');
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
