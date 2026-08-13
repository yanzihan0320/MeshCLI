import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { AgentEvent, AgentRunRequest, ChangeSet } from '../../../packages/protocol/src/agent';
import { TaskBoardBlockSchema, createChangeSetReviewBlocks, type TaskBoardBlock } from '../../../packages/protocol/src/a2ui';
import type { AdapterEvent, AdapterReviewResult, AgentAdapter, AgentRunContext, RestoredAdapterRun } from './agentGateway';
import { WorkspaceManager } from './workspaceManager';
import { WorkspaceBindingRegistry, workspaceBindingRegistry } from './workspaceBindingRegistry';

const EVENT_PREFIX = 'MESHCLI_EVENT ';
const CONTROL_PREFIX = 'MESHCLI_CONTROL ';
const MAX_STDERR_CHARS = 16_000;
const execFileAsync = promisify(execFile);
const MAX_AGENT_CONTEXT_BYTES = 500_000;
const TARGET_AGENT_CONTEXT_BYTES = 450_000;

function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.byteLength <= maxBytes) return value;
  return `${encoded.subarray(0, Math.max(0, maxBytes - 80)).toString('utf8')}\n[...context truncated by MeshCLI...]`;
}

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
  const sections: string[] = [];
  let usedBytes = 0;
  let omittedSections = 0;
  const append = (value: string, perSectionLimit = 120_000) => {
    const bounded = truncateUtf8(value, perSectionLimit);
    const bytes = Buffer.byteLength(bounded, 'utf8') + 1;
    if (usedBytes + bytes > TARGET_AGENT_CONTEXT_BYTES) {
      omittedSections += 1;
      return;
    }
    sections.push(bounded);
    usedBytes += bytes;
  };

  append(input.prompt, 260_000);
  if (input.context.topic) append(`\n--- Current node: ${input.context.topic} ---`, 12_000);
  if (input.context.sourceText) append(input.context.sourceText, 60_000);

  // User attachments are explicit run inputs, so retain them before older chat
  // history while still applying the shared context budget.
  const attachments = input.context.attachments ?? [];
  if (attachments.length) append('\nUse the following user-attached files as read-only reference context.');
  for (const attachment of attachments) {
    append(`\n--- Attached reference: ${attachment.name} (${attachment.mediaType ?? 'text/plain'}) ---\n${attachment.content}\n--- End attachment ---`, 140_000);
  }
  for (const reference of input.context.references ?? []) {
    append(`\n--- Referenced node: ${reference.title} (${reference.nodeId}) ---\n${reference.content}\n--- End referenced node ---`, 80_000);
  }
  if (input.context.messages.length) {
    const retained: string[] = [];
    for (const message of [...input.context.messages].reverse()) {
      const line = truncateUtf8(`${message.role}: ${message.content}`, 40_000);
      if (Buffer.byteLength(retained.join('\n'), 'utf8') + Buffer.byteLength(line, 'utf8') > 120_000) {
        omittedSections += 1;
        break;
      }
      retained.unshift(line);
    }
    append(`\n--- Recent current-node conversation ---\n${retained.join('\n')}\n--- End current-node conversation ---`, 130_000);
  }
  if (omittedSections) append(`\n[MeshCLI omitted or truncated ${omittedSections} older context section(s) to stay within the 500 KB Agent budget.]`, 1_000);
  const prompt = sections.join('\n');
  if (Buffer.byteLength(prompt, 'utf8') > MAX_AGENT_CONTEXT_BYTES) {
    throw new Error('Agent context exceeds the 500 KB limit. Remove attachments or referenced nodes.');
  }
  return prompt;
}

export class OpenHandsAdapter implements AgentAdapter {
  readonly name = 'openhands';
  private readonly processes = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly containers = new Map<string, string>();

  private readonly ready: Promise<void>;

  constructor(
    private readonly workspaces = new WorkspaceManager(),
    private readonly bindings: WorkspaceBindingRegistry = workspaceBindingRegistry,
  ) {
    this.ready = this.workspaces.initialize();
  }

  async *run(
    input: AgentRunRequest,
    signal: AbortSignal,
    context: AgentRunContext,
  ): AsyncIterable<AdapterEvent> {
    yield {
      type: 'run_started',
      payload: { adapter: this.name, message: `Preparing an isolated run for ${input.context.topic}` },
    };
    await this.ready;
    const binding = await this.bindings.resolve(input.workspaceId);
    const managed = await this.workspaces.create(context.runId, signal, {
      nodeId: input.nodeId,
      workspaceId: input.workspaceId,
      sourceRoot: binding.sourceRoot,
      workingDirectory: input.workingDirectory ?? binding.defaultWorkingDirectory,
    });
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
      workingDirectory: managed.workingDirectory,
      model: input.agentModelId || process.env.OPENAI_MODEL,
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

    const changeSet = await this.workspaces.diff(context.runId, signal);
    yield {
      type: 'change_set_created',
      payload: { changeSet },
    };
    if (changeSet.files.length === 0) {
      yield {
        type: 'patch_applied',
        payload: {
          changeSetId: changeSet.changeSetId,
          fileCount: 0,
          undoAvailable: false,
          message: 'Read-only run completed. The real project was not modified.',
        },
      };
      return;
    }
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

  async apply(runId: string): Promise<AdapterReviewResult> {
    const result = await this.workspaces.apply(runId);
    if (result.kind === 'conflict') {
      return {
        changeSet: result.changeSet,
        event: { type: 'patch_conflict', payload: { error: result.error } },
      };
    }
    if (result.kind === 'review_required') {
      return {
        changeSet: result.changeSet,
        requiresReview: true,
        event: {
          type: 'change_set_rebased',
          payload: { changeSet: result.changeSet, message: 'Patch replayed on the latest workspace.' },
        },
      };
    }
    const changeSet = result.changeSet;
    return {
      changeSet,
      event: {
        type: 'patch_applied',
        payload: {
          changeSetId: changeSet.changeSetId,
          fileCount: changeSet.files.length,
          undoAvailable: changeSet.files.length > 0,
          ...(changeSet.files.length > 0 ? { undoExpiresAt: result.undoExpiresAt } : {}),
          message: changeSet.files.length ? 'Changes applied to the real project.' : 'No changes to apply.',
        },
      },
    };
  }

  async undo(runId: string) {
    const result = await this.workspaces.undo(runId);
    return {
      changeSet: result.changeSet,
      event: result.kind === 'reverted'
        ? {
            type: 'patch_reverted' as const,
            payload: { changeSetId: result.changeSet.changeSetId, message: 'Applied changes were undone.' },
          }
        : {
            type: 'undo_conflict' as const,
            payload: { changeSetId: result.changeSet.changeSetId, error: result.error },
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
    // Stop the runner before any asynchronous cleanup. Waiting for Docker to
    // report its container ID kept the old LLM request alive for up to 15s,
    // so an immediate retry could exceed providers with concurrency=1.
    if (child && !child.killed) child.kill('SIGTERM');
    const containerId = this.containers.get(runId);
    if (containerId && /^[a-f0-9]{12,64}$/i.test(containerId)) {
      await execFileAsync('docker', ['stop', '--time', '5', containerId], {
        windowsHide: true,
        timeout: 15_000,
      }).catch(() => undefined);
    }
    this.containers.delete(runId);
    this.processes.delete(runId);
    await this.workspaces.cancel(runId);
  }

  async fail(runId: string): Promise<void> {
    await this.workspaces.fail(runId);
  }

  async restoreRun(runId: string): Promise<RestoredAdapterRun | undefined> {
    await this.ready;
    const managed = await this.workspaces.restore(runId);
    if (!managed) return undefined;
    return {
      runId,
      nodeId: managed.nodeId,
      workspaceId: managed.workspaceId,
      status: managed.status,
      createdAt: managed.createdAt,
      changeSet: managed.changeSet,
      events: await this.workspaces.readEvents(runId),
    };
  }

  async persistEvent(runId: string, event: AgentEvent): Promise<void> {
    await this.workspaces.appendEvent(runId, event);
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
