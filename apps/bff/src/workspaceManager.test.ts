import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceManager } from './workspaceManager';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function git(cwd: string, ...args: string[]) {
  await execFileAsync('git', args, { cwd });
}

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'meshcli-workspace-'));
  roots.push(root);
  await git(root, 'init', '--quiet');
  await git(root, 'config', 'user.name', 'MeshCLI Test');
  await git(root, 'config', 'user.email', 'meshcli@example.invalid');
  await git(root, 'config', 'core.autocrlf', 'false');
  await writeFile(join(root, '.gitignore'), '.meshcli/\n', 'utf8');
  await writeFile(join(root, 'sample.txt'), 'before\n', 'utf8');
  await git(root, 'add', '.');
  await git(root, 'commit', '--quiet', '-m', 'fixture');
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('WorkspaceManager', () => {
  it('keeps edits isolated until an approved patch is applied', async () => {
    const root = await fixtureRepo();
    const manager = new WorkspaceManager(root);
    const managed = await manager.prepare('run-1');
    await writeFile(join(managed.workspacePath, 'sample.txt'), 'after\n', 'utf8');
    await writeFile(join(managed.workspacePath, 'new.txt'), 'new\n', 'utf8');

    const changeSet = await manager.createChangeSet('run-1');
    expect(changeSet.files.map((file) => file.path).sort()).toEqual(['new.txt', 'sample.txt']);
    expect(await readFile(join(root, 'sample.txt'), 'utf8')).toBe('before\n');
    await expect(access(managed.workspacePath)).rejects.toThrow();

    await manager.apply('run-1');
    expect(await readFile(join(root, 'sample.txt'), 'utf8')).toBe('after\n');
    expect(await readFile(join(root, 'new.txt'), 'utf8')).toBe('new\n');
  });

  it('discards a rejected workspace without touching the source', async () => {
    const root = await fixtureRepo();
    const manager = new WorkspaceManager(root);
    const managed = await manager.prepare('run-2');
    await writeFile(join(managed.workspacePath, 'sample.txt'), 'rejected\n', 'utf8');
    await manager.createChangeSet('run-2');
    await manager.reject('run-2');

    expect(await readFile(join(root, 'sample.txt'), 'utf8')).toBe('before\n');
  });

  it('refuses to apply when the real project changed after review', async () => {
    const root = await fixtureRepo();
    const manager = new WorkspaceManager(root);
    const managed = await manager.prepare('run-3');
    await writeFile(join(managed.workspacePath, 'sample.txt'), 'agent\n', 'utf8');
    await manager.createChangeSet('run-3');
    await writeFile(join(root, 'sample.txt'), 'user\n', 'utf8');

    const result = await manager.apply('run-3');
    expect(result.kind).toBe('conflict');
    expect(await readFile(join(root, 'sample.txt'), 'utf8')).toBe('user\n');
  });

  it('uses uncommitted tracked and untracked files as the isolated run baseline', async () => {
    const root = await fixtureRepo();
    await writeFile(join(root, 'sample.txt'), 'user baseline\n', 'utf8');
    await writeFile(join(root, 'draft.txt'), 'draft baseline\n', 'utf8');
    const manager = new WorkspaceManager(root);
    const managed = await manager.prepare('run-dirty');

    expect((await readFile(join(managed.workspacePath, 'sample.txt'), 'utf8')).replaceAll('\r\n', '\n')).toBe('user baseline\n');
    expect(await readFile(join(managed.workspacePath, 'draft.txt'), 'utf8')).toBe('draft baseline\n');
    await writeFile(join(managed.workspacePath, 'sample.txt'), 'agent result\n', 'utf8');
    await manager.createChangeSet('run-dirty');
    await manager.apply('run-dirty');

    expect(await readFile(join(root, 'sample.txt'), 'utf8')).toBe('agent result\n');
    expect(await readFile(join(root, 'draft.txt'), 'utf8')).toBe('draft baseline\n');
  });

  it('reports renamed and binary files without misclassifying missing numstat entries', async () => {
    const root = await fixtureRepo();
    const manager = new WorkspaceManager(root);
    const managed = await manager.prepare('run-file-kinds');
    await rename(join(managed.workspacePath, 'sample.txt'), join(managed.workspacePath, 'renamed.txt'));
    await writeFile(join(managed.workspacePath, 'asset.bin'), Buffer.from([0, 255, 1, 254]));

    const changeSet = await manager.createChangeSet('run-file-kinds');
    expect(changeSet.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'renamed.txt', status: 'renamed' }),
      expect.objectContaining({ path: 'asset.bin', status: 'binary' }),
    ]));
  });

  it('captures content changes even when the Agent commits inside the isolated clone', async () => {
    const root = await fixtureRepo();
    const manager = new WorkspaceManager(root);
    const managed = await manager.prepare('run-agent-commit');
    await writeFile(join(managed.workspacePath, 'sample.txt'), 'committed by agent\n', 'utf8');
    await writeFile(join(managed.workspacePath, 'committed.txt'), 'new committed file\n', 'utf8');
    await git(managed.workspacePath, 'add', '--all');
    // Clones do not inherit the source repository's local Git identity.
    await git(
      managed.workspacePath,
      '-c', 'user.name=MeshCLI Test',
      '-c', 'user.email=meshcli@example.invalid',
      'commit', '--quiet', '-m', 'agent commit',
    );

    const changeSet = await manager.createChangeSet('run-agent-commit');
    expect(changeSet.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'sample.txt', status: 'modified', additions: 1, deletions: 1 }),
      expect.objectContaining({ path: 'committed.txt', status: 'added', additions: 1, deletions: 0 }),
    ]));
    expect(changeSet.diff).toContain('+committed by agent');
    expect(changeSet.diff).toContain('+new committed file');

    const applied = await manager.apply('run-agent-commit');
    expect(applied.kind).toBe('applied');
    expect(await readFile(join(root, 'sample.txt'), 'utf8')).toBe('committed by agent\n');
    expect(await readFile(join(root, 'committed.txt'), 'utf8')).toBe('new committed file\n');
  });

  it('undoes an applied patch while preserving the pre-apply dirty baseline', async () => {
    const root = await fixtureRepo();
    await writeFile(join(root, 'sample.txt'), 'user baseline\n', 'utf8');
    const manager = new WorkspaceManager(root);
    const managed = await manager.prepare('run-undo');
    await writeFile(join(managed.workspacePath, 'sample.txt'), 'agent result\n', 'utf8');
    await manager.createChangeSet('run-undo');

    const applied = await manager.apply('run-undo');
    expect(applied.kind).toBe('applied');
    expect(await readFile(join(root, 'sample.txt'), 'utf8')).toBe('agent result\n');

    const undone = await manager.undo('run-undo');
    expect(undone.kind).toBe('reverted');
    expect(await readFile(join(root, 'sample.txt'), 'utf8')).toBe('user baseline\n');
  });

  it('refuses undo after the source changes again', async () => {
    const root = await fixtureRepo();
    const manager = new WorkspaceManager(root);
    const managed = await manager.prepare('run-undo-conflict');
    await writeFile(join(managed.workspacePath, 'sample.txt'), 'agent result\n', 'utf8');
    await manager.createChangeSet('run-undo-conflict');
    await manager.apply('run-undo-conflict');
    await writeFile(join(root, 'sample.txt'), 'later user change\n', 'utf8');

    const result = await manager.undo('run-undo-conflict');
    expect(result.kind).toBe('conflict');
    expect(await readFile(join(root, 'sample.txt'), 'utf8')).toBe('later user change\n');
  });

  it('replays a parallel patch on the latest source and requires a new review', async () => {
    const root = await fixtureRepo();
    await writeFile(join(root, 'other.txt'), 'one\n', 'utf8');
    await git(root, 'add', '.');
    await git(root, 'commit', '--quiet', '-m', 'other fixture');
    const manager = new WorkspaceManager(root);
    const managed = await manager.prepare('run-replay');
    await writeFile(join(managed.workspacePath, 'sample.txt'), 'agent\n', 'utf8');
    const original = await manager.createChangeSet('run-replay');
    await writeFile(join(root, 'other.txt'), 'two\n', 'utf8');

    const result = await manager.apply('run-replay');
    expect(result.kind).toBe('review_required');
    if (result.kind === 'review_required') expect(result.changeSet.changeSetId).not.toBe(original.changeSetId);
    expect(await readFile(join(root, 'sample.txt'), 'utf8')).toBe('before\n');
  });
});
