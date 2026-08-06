import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { AgentRunRequest, ChangeSet } from '../../../packages/protocol/src/agent';
import type { AdapterEvent, AgentAdapter, AgentRunContext } from './agentGateway';
import { WorkspaceManager } from './workspaceManager';

const EVENT_PREFIX = 'MESHCLI_EVENT ';
const CONTROL_PREFIX = 'MESHCLI_CONTROL ';
const MAX_STDERR_CHARS = 16_000;
const execFileAsync = promisify(execFile);

interface RunnerEvent {
  type: AdapterEvent['type'];
  payload: Record<string, unknown>;
}

export class OpenHandsAdapter implements AgentAdapter {
  readonly name = 'openhands';
  private readonly processes = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly containers = new Map<string, string>();

  constructor(private readonly workspaces = new WorkspaceManager()) {}

  async *run(
    input: AgentRunRequest,
    signal: AbortSignal,
    context: AgentRunContext,
  ): AsyncIterable<AdapterEvent> {
    yield {
      type: 'run_started',
      payload: { adapter: this.name, message: `Preparing an isolated run for ${input.context.topic}` },
    };
    const managed = await this.workspaces.prepare(context.runId, signal);
    const child = this.spawnRunner(context.runId);
    const stderr: string[] = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr.push(chunk);
      const size = stderr.reduce((total, item) => total + item.length, 0);
      while (size > MAX_STDERR_CHARS && stderr.length > 1) stderr.shift();
    });
    child.stdin.end(JSON.stringify({
      prompt: input.prompt,
      workspacePath: managed.workspacePath,
      persistencePath: managed.persistencePath,
      mode: process.env.AGENT_WORKSPACE_MODE ?? 'docker',
      dockerImage: process.env.OPENHANDS_AGENT_SERVER_IMAGE
        ?? 'ghcr.io/openhands/agent-server:1.36.1-python',
      dockerHealthTimeout: Number(process.env.AGENT_DOCKER_HEALTH_TIMEOUT ?? 180),
      maxIterations: Number(process.env.AGENT_MAX_ITERATIONS ?? 60),
    }));

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.startsWith(CONTROL_PREFIX)) {
        const control = JSON.parse(line.slice(CONTROL_PREFIX.length)) as { containerId?: string };
        if (control.containerId && /^[a-f0-9]{12,64}$/i.test(control.containerId)) {
          this.containers.set(context.runId, control.containerId);
        }
        continue;
      }
      if (!line.startsWith(EVENT_PREFIX)) continue;
      const parsed = JSON.parse(line.slice(EVENT_PREFIX.length)) as RunnerEvent;
      yield { type: parsed.type, payload: parsed.payload };
    }
    const exitCode = child.exitCode ?? await new Promise<number | null>((resolveExit) => child.once('close', resolveExit));
    this.processes.delete(context.runId);
    this.containers.delete(context.runId);
    if (signal.aborted) return;
    if (exitCode !== 0) {
      const errorLines = stderr.join('').trim().split(/\r?\n/);
      const detail = errorLines.slice(-12).join('\n') || `exit code ${exitCode}`;
      throw new Error(`OpenHands runtime failed: ${detail}`);
    }

    const changeSet = await this.workspaces.createChangeSet(context.runId, signal);
    yield {
      type: 'change_set_created',
      payload: { changeSet },
    };
    yield {
      type: 'review_ready',
      payload: {
        changeSetId: changeSet.changeSetId,
        fileCount: changeSet.files.length,
        message: changeSet.files.length ? 'Review the proposed changes.' : 'Run completed with no file changes.',
      },
    };
  }

  async apply(runId: string): Promise<{ changeSet: ChangeSet; event: AdapterEvent }> {
    const changeSet = await this.workspaces.apply(runId);
    return {
      changeSet,
      event: {
        type: 'patch_applied',
        payload: {
          changeSetId: changeSet.changeSetId,
          fileCount: changeSet.files.length,
          message: changeSet.files.length ? 'Changes applied to the real project.' : 'No changes to apply.',
        },
      },
    };
  }

  async reject(runId: string): Promise<{ changeSet: ChangeSet; event: AdapterEvent }> {
    const changeSet = await this.workspaces.reject(runId);
    return {
      changeSet,
      event: {
        type: 'patch_rejected',
        payload: {
          changeSetId: changeSet.changeSetId,
          message: 'Proposed changes discarded; the real project was not modified.',
        },
      },
    };
  }

  async cancel(runId: string): Promise<void> {
    const child = this.processes.get(runId);
    let containerId = this.containers.get(runId);
    const deadline = Date.now() + 15_000;
    while (child && !containerId && child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
      containerId = this.containers.get(runId);
    }
    if (containerId && /^[a-f0-9]{12,64}$/i.test(containerId)) {
      await execFileAsync('docker', ['stop', '--time', '5', containerId], {
        windowsHide: true,
        timeout: 15_000,
      }).catch(() => undefined);
    }
    this.containers.delete(runId);
    if (child && !child.killed) child.kill('SIGTERM');
    this.processes.delete(runId);
    await this.workspaces.cancel(runId);
  }

  private spawnRunner(runId: string): ChildProcessWithoutNullStreams {
    const python = resolve(
      process.env.OPENHANDS_PYTHON
        ?? 'apps/openhands/.venv/Scripts/python.exe',
    );
    const child = spawn(python, ['-m', 'meshcli_openhands.runner'], {
      cwd: process.cwd(),
      env: { ...process.env, OPENHANDS_SUPPRESS_BANNER: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.processes.set(runId, child);
    return child;
  }
}
