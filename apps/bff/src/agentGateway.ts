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
  requiresReview?: boolean;
}

export interface RestoredAdapterRun {
  runId: string;
  nodeId: string;
  workspaceId: string;
  status: AgentRunStatus;
  createdAt: number;
  changeSet?: ChangeSet;
  events: AgentEvent[];
}

export interface AgentAdapter {
  readonly name: string;
  run(input: AgentRunRequest, signal: AbortSignal, context: AgentRunContext): AsyncIterable<AdapterEvent>;
  apply?(runId: string): Promise<AdapterReviewResult>;
  undo?(runId: string): Promise<AdapterReviewResult>;
  reject?(runId: string): Promise<AdapterReviewResult>;
  cancel?(runId: string): Promise<void>;
  fail?(runId: string): Promise<void>;
  restoreRun?(runId: string): Promise<RestoredAdapterRun | undefined>;
  persistEvent?(runId: string, event: AgentEvent): Promise<void>;
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

function publicAgentError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (/insufficient balance|exceeded_current_quota|quota.*exhaust/i.test(detail)) {
    return 'Model account quota is exhausted. Recharge the configured provider account or switch models, then retry.';
  }
  if (/429|rate[_ -]?limit|max (?:organization )?concurrency|max rpm/i.test(detail)) {
    const retry = detail.match(/after\s+(\d+(?:\.\d+)?)\s+seconds?/i)?.[1];
    return `Model service is temporarily rate-limited.${retry ? ` Retry after about ${retry} seconds.` : ' Please retry shortly.'}`;
  }
  return detail;
}

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

  async cancel(runId: string): Promise<AgentEvent | undefined> {
    const run = this.runs.get(runId);
    if (!run || ['applied', 'rejected', 'conflicted', 'finished', 'failed', 'cancelled'].includes(run.status)) {
      return undefined;
    }
    run.controller.abort();
    // Publish cancellation before potentially slow OpenHands/Docker cleanup so
    // every SSE subscriber and Stop button responds immediately.
    const event = this.append(run, 'run_cancelled', { reason: 'Cancelled by user' });
    void this.adapter.cancel?.(runId).catch(() => undefined);
    return event;
  }

  async apply(runId: string): Promise<AgentEvent | undefined> {
    const run = await this.ensureRun(runId);
    if (!run || run.status !== 'review_ready' || !this.adapter.apply) return undefined;
    run.status = 'applying';
    try {
      const result = await this.adapter.apply(runId);
      run.changeSet = result.changeSet;
      const event = this.append(run, result.event.type, result.event.payload);
      if (result.requiresReview) {
        this.append(run, 'change_set_created', { changeSet: result.changeSet });
        return this.append(run, 'review_ready', {
          changeSetId: result.changeSet.changeSetId,
          fileCount: result.changeSet.files.length,
          message: 'The project changed. Review the replayed patch before applying it.',
        });
      }
      return event;
    } catch (error) {
      return this.append(run, 'patch_conflict', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async reject(runId: string): Promise<AgentEvent | undefined> {
    const run = await this.ensureRun(runId);
    if (!run || run.status !== 'review_ready' || !this.adapter.reject) return undefined;
    const result = await this.adapter.reject(runId);
    run.changeSet = result.changeSet;
    return this.append(run, result.event.type, result.event.payload);
  }

  async undo(runId: string): Promise<AgentEvent | undefined> {
    const run = await this.ensureRun(runId);
    if (!run || run.status !== 'applied' || !this.adapter.undo) return undefined;
    const result = await this.adapter.undo(runId);
    run.changeSet = result.changeSet;
    return this.append(run, result.event.type, result.event.payload);
  }

  async restore(runId: string): Promise<boolean> {
    return Boolean(await this.ensureRun(runId));
  }

  private async execute(run: StoredRun, input: AgentRunRequest): Promise<void> {
    try {
      for await (const event of this.adapter.run(input, run.controller.signal, { runId: run.runId })) {
        if (run.controller.signal.aborted) break;
        this.append(run, event.type, event.payload);
      }
    } catch (error) {
      if (!run.controller.signal.aborted) {
        await this.adapter.fail?.(run.runId).catch(() => undefined);
        this.append(run, 'run_failed', {
          error: publicAgentError(error),
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
      'patch_reverted',
      'undo_conflict',
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
    void this.adapter.persistEvent?.(run.runId, event).catch(() => undefined);
    return event;
  }

  private async ensureRun(runId: string): Promise<StoredRun | undefined> {
    const existing = this.runs.get(runId);
    if (existing) return existing;
    const restored = await this.adapter.restoreRun?.(runId);
    if (!restored) return undefined;
    const run: StoredRun = {
      ...restored,
      controller: new AbortController(),
      subscribers: new Set(),
    };
    this.runs.set(runId, run);
    return run;
  }

  private trimRetainedRuns(): void {
    if (this.runs.size <= MAX_RETAINED_RUNS) return;
    const terminalRuns = [...this.runs.values()]
      .filter((run) => ['applied', 'rejected', 'conflicted', 'reverted', 'finished', 'failed', 'cancelled'].includes(run.status))
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const run of terminalRuns) {
      if (this.runs.size <= MAX_RETAINED_RUNS) break;
      this.runs.delete(run.runId);
    }
  }
}
