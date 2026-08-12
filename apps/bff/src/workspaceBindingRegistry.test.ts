import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceBindingRegistry } from './workspaceBindingRegistry';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'meshcli-binding-'));
  roots.push(root);
  await execFileAsync('git', ['init', '--quiet'], { cwd: root });
  await mkdir(join(root, 'packages', 'app'), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('WorkspaceBindingRegistry', () => {
  it('binds a Git subdirectory to its root and persists the relative cwd', async () => {
    const root = await fixture();
    const registryPath = join(root, 'registry.json');
    const registry = new WorkspaceBindingRegistry(registryPath);
    const binding = await registry.bindPath('workspace-1', join(root, 'packages', 'app'));
    expect(binding.sourceRoot).toBe(root);
    expect(binding.defaultWorkingDirectory).toBe('packages/app');

    const restored = await new WorkspaceBindingRegistry(registryPath).get('workspace-1');
    expect(restored).toMatchObject({ sourceRoot: root, defaultWorkingDirectory: 'packages/app' });
    expect(JSON.parse(await readFile(registryPath, 'utf8')).version).toBe(1);
  });

  it('rejects a directory outside Git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meshcli-not-git-'));
    roots.push(root);
    const registry = new WorkspaceBindingRegistry(join(root, 'registry.json'));
    await expect(registry.bindPath('workspace-1', root)).rejects.toThrow('not inside a Git');
  });
});
