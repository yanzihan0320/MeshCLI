import { describe, expect, it } from 'vitest';
import { AgentRunManager, type AdapterEvent, type AgentAdapter } from './agentGateway';
import type { ChangeSet } from '../../../packages/protocol/src/agent';

const emptyChangeSet: ChangeSet = {
  changeSetId: 'change-1',
  runId: 'pending',
  baseCommit: 'a'.repeat(40),
  files: [],
  diff: '',
  truncated: false,
  createdAt: 1,
};

class ImmediateAdapter implements AgentAdapter {
  readonly name = 'test';

  async *run(): AsyncIterable<AdapterEvent> {
    yield { type: 'run_started', payload: { adapter: this.name } };
    yield { type: 'text_delta', payload: { delta: 'Hello' } };
    yield { type: 'run_finished', payload: { summary: 'Done' } };
    yield { type: 'review_ready', payload: { fileCount: 0 } };
  }

  async apply(runId: string) {
    return {
      changeSet: { ...emptyChangeSet, runId },
      event: { type: 'patch_applied' as const, payload: { changeSetId: 'change-1' } },
    };
  }
}

class ReplayAdapter extends ImmediateAdapter {
  override async apply(runId: string) {
    const changeSet = { ...emptyChangeSet, changeSetId: 'change-2', runId };
    return {
      changeSet,
      event: { type: 'change_set_rebased' as const, payload: { changeSet } },
      requiresReview: true,
    };
  }
}

describe('AgentRunManager', () => {
  it('normalizes adapter output into ordered node-bound events', async () => {
    const manager = new AgentRunManager(new ImmediateAdapter());
    const created = manager.create({
      nodeId: 'node-1',
      workspaceId: 'workspace-1',
      prompt: 'Analyze',
      context: { topic: 'Topic', messages: [] },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const run = manager.get(created.runId);
    expect(run?.status).toBe('review_ready');
    expect(run?.events.map((event) => event.type)).toEqual([
      'run_started',
      'text_delta',
      'run_finished',
      'review_ready',
    ]);
    expect(run?.events.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
    expect(run?.events.every((event) => event.nodeId === 'node-1')).toBe(true);

    const applied = await manager.apply(created.runId);
    expect(applied?.type).toBe('patch_applied');
    expect(manager.get(created.runId)?.status).toBe('applied');
  });

  it('aborts the adapter and records cancellation', async () => {
    let adapterCancelled = false;
    const adapter: AgentAdapter = {
      name: 'cancel-test',
      async *run(_input, signal) {
        yield { type: 'run_started', payload: {} };
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      },
      async cancel() {
        adapterCancelled = true;
      },
    };
    const manager = new AgentRunManager(adapter);
    const created = manager.create({
      nodeId: 'node-1',
      workspaceId: 'workspace-1',
      prompt: 'Wait',
      context: { topic: 'Cancel', messages: [] },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(manager.cancel(created.runId)).resolves.toBe(true);
    expect(adapterCancelled).toBe(true);
    expect(manager.get(created.runId)?.events.at(-1)?.type).toBe('run_cancelled');
  });

  it('requires a second review after a parallel patch is replayed', async () => {
    const manager = new AgentRunManager(new ReplayAdapter());
    const created = manager.create({
      nodeId: 'node-1', workspaceId: 'workspace-1', prompt: 'Analyze',
      context: { topic: 'Topic', messages: [] },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const result = await manager.apply(created.runId);
    expect(result?.type).toBe('review_ready');
    expect(manager.get(created.runId)?.changeSet?.changeSetId).toBe('change-2');
    expect(manager.get(created.runId)?.events.slice(-3).map((event) => event.type)).toEqual([
      'change_set_rebased', 'change_set_created', 'review_ready',
    ]);
  });
});
