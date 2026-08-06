import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  AgentEventType,
  AgentRunCreated,
  AgentRunRequest,
  AgentRunStatus,
  ChangeSet,
} from '../../../packages/protocol/src/agent';
import { ChangeSetSchema, isTerminalAgentEvent, statusAfterEvent } from '../../../packages/protocol/src/agent';

export interface AdapterEvent {
  type: AgentEventType;
  payload: Record<string, unknown>;
}

export interface AgentRunContext {
  runId: string;
}

export interface AdapterReviewResult {
  changeSet: ChangeSet;
  event: AdapterEvent;
}

export interface AgentAdapter {
  readonly name: string;
  run(input: AgentRunRequest, signal: AbortSignal, context: AgentRunContext): AsyncIterable<AdapterEvent>;
  apply?(runId: string): Promise<AdapterReviewResult>;
  reject?(runId: string): Promise<AdapterReviewResult>;
  cancel?(runId: string): Promise<void>;
}

const delay = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(new DOMException('Run cancelled', 'AbortError'));
  }, { once: true });
});

export class MockAgentAdapter implements AgentAdapter {
  readonly name = 'mock';

  async *run(input: AgentRunRequest, signal: AbortSignal): AsyncIterable<AdapterEvent> {
    yield {
      type: 'run_started',
      payload: { adapter: this.name, message: `Started agent run for ${input.context.topic}` },
    };

    const text = `I am analyzing “${input.context.topic}”. Phase 2 is using a deterministic mock executor; a real execution adapter will replace it in Phase 3.`;
    const chunks = text.match(/.{1,28}(?:\s|$)/g) ?? [text];

    for (const delta of chunks) {
      await delay(120, signal);
      yield { type: 'text_delta', payload: { delta } };
    }

    await delay(120, signal);
    yield {
      type: 'run_finished',
      payload: { adapter: this.name, summary: 'Mock run completed successfully.' },
    };
    yield {
      type: 'review_ready',
      payload: { fileCount: 0, message: 'Mock run completed with no file changes.' },
    };
  }
}

interface StoredRun {
  runId: string;
  nodeId: string;
  workspaceId: string;
  status: AgentRunStatus;
  events: AgentEvent[];
  changeSet?: ChangeSet;
  controller: AbortController;
  subscribers: Set<(event: AgentEvent) => void>;
  createdAt: number;
}

const MAX_RETAINED_RUNS = 100;

export class AgentRunManager {
  private readonly runs = new Map<string, StoredRun>();

  constructor(private readonly adapter: AgentAdapter) {}

  create(input: AgentRunRequest): AgentRunCreated {
    const runId = randomUUID();
    const run: StoredRun = {
      runId,
      nodeId: input.nodeId,
      workspaceId: input.workspaceId,
      status: 'queued',
      events: [],
      controller: new AbortController(),
      subscribers: new Set(),
      createdAt: Date.now(),
    };
    this.runs.set(runId, run);
    this.trimRetainedRuns();
    void this.execute(run, input);
    return { runId, nodeId: input.nodeId, status: 'queued' };
  }

  get(runId: string): StoredRun | undefined {
    return this.runs.get(runId);
  }

  subscribe(runId: string, subscriber: (event: AgentEvent) => void): (() => void) | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    run.subscribers.add(subscriber);
    return () => run.subscribers.delete(subscriber);
  }

  async cancel(runId: string): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run || ['applied', 'rejected', 'conflicted', 'finished', 'failed', 'cancelled'].includes(run.status)) {
      return false;
    }
    run.controller.abort();
    await this.adapter.cancel?.(runId).catch(() => undefined);
    this.append(run, 'run_cancelled', { reason: 'Cancelled by user' });
    return true;
  }

  async apply(runId: string): Promise<AgentEvent | undefined> {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'review_ready' || !this.adapter.apply) return undefined;
    run.status = 'applying';
    try {
      const result = await this.adapter.apply(runId);
      run.changeSet = result.changeSet;
      return this.append(run, result.event.type, result.event.payload);
    } catch (error) {
      return this.append(run, 'patch_conflict', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async reject(runId: string): Promise<AgentEvent | undefined> {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'review_ready' || !this.adapter.reject) return undefined;
    const result = await this.adapter.reject(runId);
    run.changeSet = result.changeSet;
    return this.append(run, result.event.type, result.event.payload);
  }

  private async execute(run: StoredRun, input: AgentRunRequest): Promise<void> {
    try {
      for await (const event of this.adapter.run(input, run.controller.signal, { runId: run.runId })) {
        if (run.controller.signal.aborted) break;
        this.append(run, event.type, event.payload);
      }
    } catch (error) {
      if (!run.controller.signal.aborted) {
        this.append(run, 'run_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private append(run: StoredRun, type: AgentEventType, payload: Record<string, unknown>): AgentEvent {
    const lastType = run.events.at(-1)?.type;
    const finalTypes: AgentEventType[] = [
      'patch_applied',
      'patch_rejected',
      'patch_conflict',
      'run_failed',
      'run_cancelled',
    ];
    if (isTerminalAgentEvent(type) && lastType && finalTypes.includes(lastType)) {
      return run.events.at(-1)!;
    }
    const event: AgentEvent = {
      version: 1,
      eventId: randomUUID(),
      runId: run.runId,
      nodeId: run.nodeId,
      sequence: run.events.length,
      timestamp: Date.now(),
      type,
      payload,
    };
    run.status = statusAfterEvent(type);
    if (type === 'change_set_created') {
      const parsed = ChangeSetSchema.safeParse(payload.changeSet);
      if (parsed.success) run.changeSet = parsed.data;
    }
    run.events.push(event);
    for (const subscriber of run.subscribers) subscriber(event);
    return event;
  }

  private trimRetainedRuns(): void {
    if (this.runs.size <= MAX_RETAINED_RUNS) return;
    const terminalRuns = [...this.runs.values()]
      .filter((run) => ['applied', 'rejected', 'conflicted', 'finished', 'failed', 'cancelled'].includes(run.status))
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const run of terminalRuns) {
      if (this.runs.size <= MAX_RETAINED_RUNS) break;
      this.runs.delete(run.runId);
    }
  }
}
