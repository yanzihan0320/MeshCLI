import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

    await expect(manager.apply('run-3')).rejects.toThrow('changed after this Agent run started');
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
});
