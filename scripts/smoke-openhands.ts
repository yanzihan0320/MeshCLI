import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AgentRunManager } from '../apps/bff/src/agentGateway';
import { OpenHandsAdapter } from '../apps/bff/src/openHandsAdapter';
import { WorkspaceManager } from '../apps/bff/src/workspaceManager';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]) {
  await execFileAsync('git', args, { cwd });
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'meshcli-openhands-smoke-'));
  try {
    await git(root, 'init', '--quiet');
    await git(root, 'config', 'user.name', 'MeshCLI Smoke');
    await git(root, 'config', 'user.email', 'meshcli@example.invalid');
    await git(root, 'config', 'core.autocrlf', 'false');
    await writeFile(join(root, '.gitignore'), '.meshcli/\n', 'utf8');
    await writeFile(join(root, 'TARGET.txt'), 'gateway-before\n', 'utf8');
    await git(root, 'add', '.');
    await git(root, 'commit', '--quiet', '-m', 'smoke fixture');

    process.env.AGENT_WORKSPACE_MODE = 'docker';
    process.env.AGENT_MAX_ITERATIONS = '8';
    const manager = new AgentRunManager(new OpenHandsAdapter(new WorkspaceManager(root)));
    const created = manager.create({
      nodeId: 'smoke-node',
      workspaceId: 'smoke-workspace',
      prompt: 'Edit TARGET.txt so its entire content is exactly gateway-after followed by one newline.',
      context: { topic: 'OpenHands smoke test', messages: [] },
    });

    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      const run = manager.get(created.runId);
      if (run?.status === 'review_ready') {
        if (!run.changeSet?.files.some((file) => file.path === 'TARGET.txt')) {
          throw new Error('Change set did not contain TARGET.txt');
        }
        if (await readFile(join(root, 'TARGET.txt'), 'utf8') !== 'gateway-before\n') {
          throw new Error('Real fixture changed before approval');
        }
        const applied = await manager.apply(created.runId);
        if (applied?.type !== 'patch_applied') {
          throw new Error(`Patch was not applied: ${String(applied?.payload.error ?? 'unknown conflict')}`);
        }
        if (await readFile(join(root, 'TARGET.txt'), 'utf8') !== 'gateway-after\n') {
          throw new Error('Applied file content was unexpected');
        }
        console.log(`events=${run.events.map((event) => event.type).join(',')}`);
        console.log(`change_set_files=${run.changeSet.files.length}`);
        console.log('gateway_openhands_smoke=passed');
        return;
      }
      if (run && ['failed', 'cancelled', 'conflicted'].includes(run.status)) {
        const error = run.events.findLast((event) => event.type === 'run_failed')?.payload.error;
        throw new Error(`Run ended as ${run.status}: ${String(error ?? '')}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Timed out waiting for OpenHands review state');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
