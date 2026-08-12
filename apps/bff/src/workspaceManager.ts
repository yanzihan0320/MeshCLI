import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { AgentEvent, AgentRunStatus, ChangeSet, ChangedFile } from '../../../packages/protocol/src/agent';

const execFileAsync = promisify(execFile);
const MAX_UI_DIFF_BYTES = 2 * 1024 * 1024;
const MAX_PATCH_BYTES = 64 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_MAX_RUNS = 200;
const DEFAULT_MAX_STORAGE_BYTES = 1024 * 1024 * 1024;

export interface WorkspacePreparation {
  workspaceId?: string;
  nodeId?: string;
  sourceRoot?: string;
  workingDirectory?: string;
}

export interface ManagedRunWorkspace {
  version: 1;
  runId: string;
  nodeId: string;
  workspaceId: string;
  sourceRoot: string;
  runRoot: string;
  workspacePath: string;
  workingDirectory: string;
  persistencePath: string;
  patchPath: string;
  manifestPath: string;
  eventsPath: string;
  baseCommit: string;
  workspaceBaselineCommit: string;
  sourceFingerprint: string;
  status: AgentRunStatus;
  createdAt: number;
  updatedAt: number;
  changeSet?: ChangeSet;
  preApplyFingerprint?: string;
  postApplyFingerprint?: string;
  undoExpiresAt?: number;
}

export type ApplyWorkspaceResult =
  | { kind: 'applied'; changeSet: ChangeSet; undoExpiresAt: number }
  | { kind: 'review_required'; changeSet: ChangeSet }
  | { kind: 'conflict'; changeSet: ChangeSet; error: string };

export type UndoWorkspaceResult =
  | { kind: 'reverted'; changeSet: ChangeSet }
  | { kind: 'conflict'; changeSet: ChangeSet; error: string };

export interface RunWorkspaceProvider {
  initialize(): Promise<void>;
  create(runId: string, signal?: AbortSignal, options?: WorkspacePreparation): Promise<ManagedRunWorkspace>;
  diff(runId: string, signal?: AbortSignal): Promise<ChangeSet>;
  replay(runId: string): Promise<ApplyWorkspaceResult>;
  prepare(runId: string, signal?: AbortSignal, options?: WorkspacePreparation): Promise<ManagedRunWorkspace>;
  createChangeSet(runId: string, signal?: AbortSignal): Promise<ChangeSet>;
  apply(runId: string): Promise<ApplyWorkspaceResult>;
  undo(runId: string): Promise<UndoWorkspaceResult>;
  reject(runId: string): Promise<ChangeSet>;
  cancel(runId: string): Promise<void>;
  fail(runId: string): Promise<void>;
  restore(runId: string): Promise<ManagedRunWorkspace | undefined>;
  appendEvent(runId: string, event: AgentEvent): Promise<void>;
  discard(runId: string, status?: 'cancelled' | 'failed' | 'rejected'): Promise<void>;
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

function validateRelativeDirectory(value: string | undefined): string {
  const normalized = (value || '.').replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized === '.' || normalized === '') return '.';
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error('Working directory must be a safe path relative to the workspace root.');
  }
  return normalized;
}

function changedStatus(code: string): ChangedFile['status'] {
  if (code.includes('R')) return 'renamed';
  if (code.includes('D')) return 'deleted';
  if (code === '??' || code.includes('A')) return 'added';
  return 'modified';
}

function parseNameStatus(raw: string): Map<string, ChangedFile['status']> {
  const result = new Map<string, ChangedFile['status']>();
  const records = raw.split('\0');
  for (let index = 0; index < records.length;) {
    const code = records[index++];
    if (!code) continue;
    let path = records[index++] ?? '';
    if (code.includes('R') || code.includes('C')) {
      path = records[index++] ?? path;
    }
    if (!path) continue;
    result.set(path.replaceAll('\\', '/'), changedStatus(code));
  }
  return result;
}

function parseNumstat(raw: string): Map<string, { additions: number | null; deletions: number | null }> {
  const result = new Map<string, { additions: number | null; deletions: number | null }>();
  const records = raw.split('\0');
  for (let index = 0; index < records.length;) {
    const header = records[index++];
    if (!header) continue;
    const [added, deleted, ...pathParts] = header.split('\t');
    let path = pathParts.join('\t');
    if (!path) {
      index += 1; // old path for a rename/copy
      path = records[index++] ?? '';
    }
    if (!path) continue;
    result.set(path.replaceAll('\\', '/'), {
      additions: added === '-' ? null : Number(added),
      deletions: deleted === '-' ? null : Number(deleted),
    });
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

async function pathSize(path: string): Promise<number> {
  const info = await stat(path).catch(() => undefined);
  if (!info) return 0;
  if (info.isFile()) return info.size;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  return (await Promise.all(entries.map((entry) => pathSize(resolve(path, entry.name)))))
    .reduce((total, size) => total + size, 0);
}

export class CloneWorkspaceProvider implements RunWorkspaceProvider {
  readonly defaultSourceRoot: string;
  readonly runsRoot: string;
  private readonly runs = new Map<string, ManagedRunWorkspace>();
  private readonly locks = new Map<string, Promise<void>>();
  private initializePromise?: Promise<void>;

  constructor(sourceRoot?: string) {
    this.defaultSourceRoot = resolve(sourceRoot || process.env.AGENT_WORKSPACE_ROOT || process.cwd());
    this.runsRoot = process.env.AGENT_RUNS_DIR
      ? resolve(process.env.AGENT_RUNS_DIR)
      : sourceRoot
        ? resolve(this.defaultSourceRoot, '.meshcli', 'runs')
        : resolve(process.env.LOCALAPPDATA || tmpdir(), 'MeshCLI', 'runs');
  }

  initialize(): Promise<void> {
    this.initializePromise ??= this.initializeStorage();
    return this.initializePromise;
  }

  get(runId: string): ManagedRunWorkspace | undefined {
    return this.runs.get(runId);
  }

  create(runId: string, signal?: AbortSignal, options?: WorkspacePreparation) {
    return this.prepare(runId, signal, options);
  }

  diff(runId: string, signal?: AbortSignal) {
    return this.createChangeSet(runId, signal);
  }

  async replay(runId: string): Promise<ApplyWorkspaceResult> {
    const managed = await this.requireRun(runId);
    return this.withSourceLock(managed.sourceRoot, async () => (
      this.replayAgainstLatest(managed, await this.captureSourceSnapshot(managed.sourceRoot))
    ));
  }

  async prepare(
    runId: string,
    signal?: AbortSignal,
    options: WorkspacePreparation = {},
  ): Promise<ManagedRunWorkspace> {
    await this.initialize();
    const existing = this.runs.get(runId) ?? await this.restore(runId);
    if (existing) return existing;
    const sourceRoot = resolve(options.sourceRoot || this.defaultSourceRoot);
    await this.git(['rev-parse', '--is-inside-work-tree'], sourceRoot, signal);
    const requireClean = (process.env.AGENT_REQUIRE_CLEAN_WORKTREE ?? 'false') === 'true';
    if (requireClean) {
      const status = await this.git(['status', '--porcelain=v1', '--untracked-files=normal'], sourceRoot, signal);
      if (status.trim()) {
        throw new Error('The real project has uncommitted changes. Commit or stash them before running an Agent.');
      }
    }
    const snapshot = await this.captureSourceSnapshot(sourceRoot, signal);
    const runRoot = resolve(this.runsRoot, runId);
    assertInside(this.runsRoot, runRoot);
    await mkdir(runRoot, { recursive: true });
    const now = Date.now();
    const managed: ManagedRunWorkspace = {
      version: 1,
      runId,
      nodeId: options.nodeId || 'unknown-node',
      workspaceId: options.workspaceId || 'default-workspace',
      sourceRoot,
      runRoot,
      workspacePath: resolve(runRoot, 'workspace'),
      workingDirectory: validateRelativeDirectory(options.workingDirectory),
      persistencePath: resolve(runRoot, 'conversation'),
      patchPath: resolve(runRoot, 'change.patch'),
      manifestPath: resolve(runRoot, 'manifest.json'),
      eventsPath: resolve(runRoot, 'events.jsonl'),
      baseCommit: snapshot.head,
      workspaceBaselineCommit: snapshot.head,
      sourceFingerprint: snapshot.fingerprint,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    };
    await this.materializeWorkspace(managed, snapshot, signal);
    this.runs.set(runId, managed);
    await this.persist(managed);
    return managed;
  }

  async createChangeSet(runId: string, signal?: AbortSignal): Promise<ChangeSet> {
    const managed = await this.requireRun(runId);
    const changeSet = await this.buildChangeSet(managed, signal);
    managed.status = 'review_ready';
    managed.updatedAt = Date.now();
    await this.persist(managed);
    await this.releaseWorkspace(managed);
    return changeSet;
  }

  async apply(runId: string): Promise<ApplyWorkspaceResult> {
    const managed = await this.requireRun(runId);
    return this.withSourceLock(managed.sourceRoot, async () => {
      if (!managed.changeSet) throw new Error('Run has no change set to apply.');
      const currentSnapshot = await this.captureSourceSnapshot(managed.sourceRoot);
      if (currentSnapshot.head !== managed.baseCommit || currentSnapshot.fingerprint !== managed.sourceFingerprint) {
        return this.replayAgainstLatest(managed, currentSnapshot);
      }
      const patch = await readFile(managed.patchPath, 'utf8');
      if (patch.trim()) {
        await this.git(['apply', '--check', '--whitespace=nowarn', managed.patchPath], managed.sourceRoot);
        await this.git(['apply', '--whitespace=nowarn', managed.patchPath], managed.sourceRoot);
      }
      const postApply = await this.captureSourceSnapshot(managed.sourceRoot);
      managed.preApplyFingerprint = currentSnapshot.fingerprint;
      managed.postApplyFingerprint = postApply.fingerprint;
      managed.undoExpiresAt = Date.now() + this.retentionMilliseconds();
      managed.status = 'applied';
      managed.updatedAt = Date.now();
      await this.persist(managed);
      return { kind: 'applied', changeSet: managed.changeSet, undoExpiresAt: managed.undoExpiresAt };
    });
  }

  async undo(runId: string): Promise<UndoWorkspaceResult> {
    const managed = await this.requireRun(runId);
    return this.withSourceLock(managed.sourceRoot, async () => {
      if (!managed.changeSet || managed.status !== 'applied') {
        throw new Error('Only an applied change set can be undone.');
      }
      if (!managed.undoExpiresAt || managed.undoExpiresAt < Date.now()) {
        return { kind: 'conflict', changeSet: managed.changeSet, error: 'The undo checkpoint has expired.' };
      }
      const current = await this.captureSourceSnapshot(managed.sourceRoot);
      if (current.fingerprint !== managed.postApplyFingerprint) {
        return {
          kind: 'conflict',
          changeSet: managed.changeSet,
          error: 'The real project changed after Apply; automatic undo was not performed.',
        };
      }
      const patch = await readFile(managed.patchPath, 'utf8');
      if (patch.trim()) {
        await this.git(['apply', '--reverse', '--check', '--whitespace=nowarn', managed.patchPath], managed.sourceRoot);
        await this.git(['apply', '--reverse', '--whitespace=nowarn', managed.patchPath], managed.sourceRoot);
      }
      const restored = await this.captureSourceSnapshot(managed.sourceRoot);
      if (restored.fingerprint !== managed.preApplyFingerprint) {
        throw new Error('Undo completed but the workspace fingerprint did not return to its checkpoint.');
      }
      managed.status = 'reverted';
      managed.updatedAt = Date.now();
      await this.persist(managed);
      return { kind: 'reverted', changeSet: managed.changeSet };
    });
  }

  async reject(runId: string): Promise<ChangeSet> {
    const managed = await this.requireRun(runId);
    if (!managed.changeSet) throw new Error('Run has no change set to reject.');
    managed.status = 'rejected';
    managed.updatedAt = Date.now();
    await this.releaseWorkspace(managed);
    await this.persist(managed);
    return managed.changeSet;
  }

  async cancel(runId: string): Promise<void> {
    const managed = this.runs.get(runId) ?? await this.restore(runId);
    if (!managed) return;
    managed.status = 'cancelled';
    managed.updatedAt = Date.now();
    await this.releaseWorkspace(managed);
    await this.persist(managed);
  }

  async fail(runId: string): Promise<void> {
    const managed = this.runs.get(runId) ?? await this.restore(runId);
    if (!managed) return;
    managed.status = 'failed';
    managed.updatedAt = Date.now();
    await this.releaseWorkspace(managed);
    await this.persist(managed);
  }

  async discard(runId: string, status: 'cancelled' | 'failed' | 'rejected' = 'cancelled'): Promise<void> {
    const managed = this.runs.get(runId) ?? await this.restore(runId);
    if (!managed) return;
    managed.status = status;
    managed.updatedAt = Date.now();
    await this.releaseWorkspace(managed);
    await this.persist(managed);
  }

  async restore(runId: string): Promise<ManagedRunWorkspace | undefined> {
    const existing = this.runs.get(runId);
    if (existing) return existing;
    const runRoot = resolve(this.runsRoot, runId);
    assertInside(this.runsRoot, runRoot);
    const manifestPath = resolve(runRoot, 'manifest.json');
    try {
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as ManagedRunWorkspace;
      if (parsed.version !== 1 || parsed.runId !== runId || resolve(parsed.runRoot) !== runRoot) return undefined;
      this.runs.set(runId, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }

  async appendEvent(runId: string, event: AgentEvent): Promise<void> {
    const managed = this.runs.get(runId) ?? await this.restore(runId);
    if (!managed) return;
    await appendFile(managed.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  async readEvents(runId: string): Promise<AgentEvent[]> {
    const managed = this.runs.get(runId) ?? await this.restore(runId);
    if (!managed) return [];
    const raw = await readFile(managed.eventsPath, 'utf8').catch(() => '');
    return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as AgentEvent]; } catch { return []; }
    });
  }

  private async replayAgainstLatest(
    managed: ManagedRunWorkspace,
    snapshot: SourceSnapshot,
  ): Promise<ApplyWorkspaceResult> {
    if (!managed.changeSet) throw new Error('Run has no change set to replay.');
    const previous = managed.changeSet;
    try {
      await this.materializeWorkspace(managed, snapshot);
      await this.git(['apply', '--check', '--whitespace=nowarn', managed.patchPath], managed.workspacePath);
      await this.git(['apply', '--whitespace=nowarn', managed.patchPath], managed.workspacePath);
      managed.baseCommit = snapshot.head;
      managed.sourceFingerprint = snapshot.fingerprint;
      const changeSet = await this.buildChangeSet(managed);
      managed.status = 'review_ready';
      managed.updatedAt = Date.now();
      await this.releaseWorkspace(managed);
      await this.persist(managed);
      return { kind: 'review_required', changeSet };
    } catch (error) {
      await this.releaseWorkspace(managed);
      return {
        kind: 'conflict',
        changeSet: previous,
        error: `The project changed and the Agent patch could not be replayed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async materializeWorkspace(
    managed: ManagedRunWorkspace,
    snapshot: SourceSnapshot,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.releaseWorkspace(managed);
    await mkdir(managed.runRoot, { recursive: true });
    await this.git(
      ['-c', 'core.autocrlf=false', 'clone', '--local', '--no-hardlinks', '--no-recurse-submodules', '--quiet', managed.sourceRoot, managed.workspacePath],
      managed.sourceRoot,
      signal,
    );
    await this.git(['config', 'core.filemode', 'false'], managed.workspacePath, signal);
    if (snapshot.trackedPatch.trim()) {
      const baselinePatchPath = resolve(managed.runRoot, 'baseline.patch');
      await writeFile(baselinePatchPath, snapshot.trackedPatch, 'utf8');
      await this.git(['apply', '--whitespace=nowarn', baselinePatchPath], managed.workspacePath, signal);
    }
    for (const file of snapshot.untracked) {
      validatePatchPath(file.path);
      const target = resolve(managed.workspacePath, file.path);
      assertInside(managed.workspacePath, target);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    if (snapshot.trackedPatch.trim() || snapshot.untracked.length) {
      await this.git(['add', '--all'], managed.workspacePath, signal);
      await this.git([
        '-c', 'user.name=MeshCLI Snapshot',
        '-c', 'user.email=meshcli@example.invalid',
        'commit', '--quiet', '-m', 'MeshCLI run baseline',
      ], managed.workspacePath, signal);
    }
    managed.workspaceBaselineCommit = (await this.git(['rev-parse', 'HEAD'], managed.workspacePath, signal)).trim();
    const cwd = resolve(managed.workspacePath, managed.workingDirectory);
    if (cwd !== managed.workspacePath) assertInside(managed.workspacePath, cwd);
    const cwdStat = await stat(cwd).catch(() => undefined);
    if (!cwdStat?.isDirectory()) throw new Error(`Working directory does not exist: ${managed.workingDirectory}`);
  }

  private async buildChangeSet(managed: ManagedRunWorkspace, signal?: AbortSignal): Promise<ChangeSet> {
    await this.git(['add', '--all'], managed.workspacePath, signal);
    const baseline = managed.workspaceBaselineCommit || managed.baseCommit;
    const statusRaw = await this.git(
      ['-c', 'core.filemode=false', 'diff', '--name-status', '-z', '-M', baseline, '--'],
      managed.workspacePath,
      signal,
    );
    const statuses = parseNameStatus(statusRaw);
    const diff = await this.git(
      ['-c', 'core.filemode=false', 'diff', '--binary', '--full-index', '--no-ext-diff', '--no-color', baseline, '--'],
      managed.workspacePath,
      signal,
      MAX_PATCH_BYTES,
    );
    await writeFile(managed.patchPath, diff, 'utf8');
    const numstat = await this.git(
      ['-c', 'core.filemode=false', 'diff', '--numstat', '-z', '-M', baseline, '--'],
      managed.workspacePath,
      signal,
    );
    const stats = parseNumstat(numstat);
    const files: ChangedFile[] = [...statuses.entries()].map(([path, status]) => {
      validatePatchPath(path);
      const fileStat = stats.get(path);
      return {
        path,
        status: fileStat && fileStat.additions === null && fileStat.deletions === null ? 'binary' : status,
        additions: fileStat?.additions ?? null,
        deletions: fileStat?.deletions ?? null,
      };
    });
    const truncated = Buffer.byteLength(diff, 'utf8') > MAX_UI_DIFF_BYTES;
    const visibleDiff = truncated
      ? `${Buffer.from(diff, 'utf8').subarray(0, MAX_UI_DIFF_BYTES).toString('utf8')}\n\n[Diff truncated in UI]`
      : diff;
    const changeSet: ChangeSet = {
      changeSetId: randomUUID(),
      runId: managed.runId,
      baseCommit: managed.baseCommit,
      files,
      diff: visibleDiff,
      truncated,
      createdAt: Date.now(),
    };
    managed.changeSet = changeSet;
    return changeSet;
  }

  private async requireRun(runId: string): Promise<ManagedRunWorkspace> {
    const managed = this.runs.get(runId) ?? await this.restore(runId);
    if (!managed) throw new Error('Managed run workspace was not found.');
    return managed;
  }

  private async releaseWorkspace(managed: ManagedRunWorkspace): Promise<void> {
    assertInside(managed.runRoot, managed.workspacePath);
    await rm(managed.workspacePath, { recursive: true, force: true });
  }

  private async persist(managed: ManagedRunWorkspace): Promise<void> {
    await mkdir(managed.runRoot, { recursive: true });
    await writeFile(managed.manifestPath, `${JSON.stringify(managed, null, 2)}\n`, 'utf8');
  }

  private async captureSourceSnapshot(sourceRoot: string, signal?: AbortSignal): Promise<SourceSnapshot> {
    const head = (await this.git(['rev-parse', 'HEAD'], sourceRoot, signal)).trim();
    const trackedPatch = await this.git(
      ['diff', '--binary', '--full-index', '--no-ext-diff', '--no-color', 'HEAD', '--'],
      sourceRoot,
      signal,
      MAX_PATCH_BYTES,
    );
    const rawPaths = await this.git(['ls-files', '--others', '--exclude-standard', '-z'], sourceRoot, signal);
    const untracked: Array<{ path: string; content: Buffer }> = [];
    for (const path of rawPaths.split('\0').filter(Boolean).sort()) {
      validatePatchPath(path);
      const absolutePath = resolve(sourceRoot, path);
      assertInside(sourceRoot, absolutePath);
      untracked.push({ path: path.replaceAll('\\', '/'), content: await readFile(absolutePath) });
    }
    const hash = createHash('sha256').update(head).update('\0').update(trackedPatch);
    for (const file of untracked) hash.update('\0').update(file.path).update('\0').update(file.content);
    return { head, trackedPatch, untracked, fingerprint: hash.digest('hex') };
  }

  private async initializeStorage(): Promise<void> {
    await mkdir(this.runsRoot, { recursive: true });
    const entries = await readdir(this.runsRoot, { withFileTypes: true }).catch(() => []);
    const retained: Array<{ path: string; updatedAt: number; size: number }> = [];
    const cutoff = Date.now() - this.retentionMilliseconds();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const runRoot = resolve(this.runsRoot, entry.name);
      assertInside(this.runsRoot, runRoot);
      const workspacePath = resolve(runRoot, 'workspace');
      assertInside(runRoot, workspacePath);
      await rm(workspacePath, { recursive: true, force: true });
      const manifestPath = resolve(runRoot, 'manifest.json');
      let updatedAt = (await stat(runRoot)).mtimeMs;
      try {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ManagedRunWorkspace;
        updatedAt = manifest.updatedAt || updatedAt;
        if (['running', 'queued', 'preparing'].includes(manifest.status)) {
          manifest.status = 'failed';
          manifest.updatedAt = Date.now();
          await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        }
      } catch { /* invalid manifests expire like other run data */ }
      if (updatedAt < cutoff) {
        await rm(runRoot, { recursive: true, force: true });
        continue;
      }
      retained.push({ path: runRoot, updatedAt, size: await pathSize(runRoot) });
    }
    const maxRuns = Number(process.env.AGENT_MAX_RETAINED_RUNS || DEFAULT_MAX_RUNS);
    const maxBytes = Number(process.env.AGENT_RUN_STORAGE_MAX_BYTES || DEFAULT_MAX_STORAGE_BYTES);
    retained.sort((a, b) => b.updatedAt - a.updatedAt);
    let used = 0;
    for (let index = 0; index < retained.length; index += 1) {
      const item = retained[index];
      used += item.size;
      if (index >= maxRuns || used > maxBytes) {
        await rm(item.path, { recursive: true, force: true });
      }
    }
  }

  private retentionMilliseconds(): number {
    const days = Number(process.env.AGENT_RUN_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
    return Math.max(1, days) * 24 * 60 * 60 * 1000;
  }

  private async withSourceLock<T>(sourceRoot: string, operation: () => Promise<T>): Promise<T> {
    const key = resolve(sourceRoot).toLowerCase();
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    const queued = previous.then(() => gate);
    this.locks.set(key, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === queued) this.locks.delete(key);
    }
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

// Compatibility export for existing callers while the provider registry lands.
export class WorkspaceManager extends CloneWorkspaceProvider {}
