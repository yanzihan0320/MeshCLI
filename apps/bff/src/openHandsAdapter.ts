import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { AgentRunRequest, ChangeSet } from '../../../packages/protocol/src/agent';
import { TaskBoardBlockSchema, createChangeSetReviewBlocks, type TaskBoardBlock } from '../../../packages/protocol/src/a2ui';
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

export function planTaskBoard(runId: string, plan: unknown): TaskBoardBlock | undefined {
  const record = typeof plan === 'object' && plan !== null ? plan as Record<string, unknown> : undefined;
  const candidates = Array.isArray(plan)
    ? plan
    : Array.isArray(record?.tasks)
      ? record.tasks
      : Array.isArray(record?.task_list)
        ? record.task_list
        : Array.isArray(record?.todos)
          ? record.todos
          : [];
  const items = candidates.flatMap((candidate, index) => {
    if (typeof candidate === 'string' && candidate.trim()) {
      return [{ id: `plan-${index}`, title: candidate.trim(), status: 'todo' as const }];
    }
    if (typeof candidate !== 'object' || candidate === null) return [];
    const item = candidate as Record<string, unknown>;
    const label = String(item.title ?? item.task ?? item.content ?? item.description ?? '').trim();
    if (!label) return [];
    const status = String(item.status ?? '').toLowerCase();
    const normalizedStatus = status === 'done' || status === 'completed' || item.completed === true
      ? 'done'
      : ['doing', 'in_progress', 'in-progress', 'active', 'running', 'current'].includes(status)
        ? 'doing'
        : 'todo';
    return [{
      id: String(item.id ?? `plan-${index}`),
      title: label,
      description: typeof item.description === 'string' && item.description !== label ? item.description : undefined,
      status: normalizedStatus,
    }];
  });
  if (!items.length) return undefined;
  const parsed = TaskBoardBlockSchema.safeParse({
    version: 1,
    id: `agent-plan-${runId}`,
    type: 'task_board',
    title: 'Agent task flow',
    fallbackText: `Agent task flow with ${items.length} tasks.`,
    columns: [
      { id: 'todo', title: 'To do', tasks: items.filter((item) => item.status === 'todo') },
      { id: 'doing', title: 'Doing', tasks: items.filter((item) => item.status === 'doing') },
      { id: 'done', title: 'Done', tasks: items.filter((item) => item.status === 'done') },
    ].map((column) => ({
      ...column,
      tasks: column.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        priority: 'medium',
        sourceNodeIds: [],
        dependencies: [],
      })),
    })),
  });
  return parsed.success ? parsed.data : undefined;
}

export function formatAgentPrompt(input: AgentRunRequest): string {
  const attachments = input.context.attachments ?? [];
  if (!attachments.length) return input.prompt;
  const references = attachments.map((attachment) => (
    `\n--- Attached reference: ${attachment.name} (${attachment.mediaType ?? 'text/plain'}) ---\n${attachment.content}\n--- End attachment ---`
  )).join('\n');
  return `${input.prompt}\n\nUse the following user-attached files as read-only reference context.${references}`;
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
      prompt: formatAgentPrompt(input),
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
      if (parsed.type === 'plan_updated') {
        const block = planTaskBoard(context.runId, parsed.payload.plan);
        if (block) yield { type: 'a2ui_block', payload: { block } };
      }
    }
    const exitCode = child.exitCode ?? await new Promise<number | null>((resolveExit) => child.once('close', resolveExit));
    this.processes.delete(context.runId);
    this.containers.delete(context.runId);
    if (signal.aborted) return;
    if (exitCode !== 0) {
      const errorLines = stderr.join('').trim().split(/\r?\n/);
      const detail = errorLines.slice(-12).join('\n') || `exit code ${exitCode}`;
      if (detail.includes('Docker is not available')) {
        throw new Error('Docker Desktop is not running. Start Docker Desktop and wait until the engine is ready, then retry the Agent run. Local mode is available only by explicitly setting AGENT_WORKSPACE_MODE=local because it provides weaker isolation.');
      }
      throw new Error(`OpenHands runtime failed: ${detail}`);
    }

    const changeSet = await this.workspaces.createChangeSet(context.runId, signal);
    yield {
      type: 'change_set_created',
      payload: { changeSet },
    };
    for (const block of createChangeSetReviewBlocks(changeSet)) {
      yield {
        type: 'a2ui_block',
        payload: { block },
      };
    }
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
