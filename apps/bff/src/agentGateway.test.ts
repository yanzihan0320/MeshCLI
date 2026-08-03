import { describe, expect, it } from 'vitest';
import { AgentRunManager, type AdapterEvent, type AgentAdapter } from './agentGateway';

class ImmediateAdapter implements AgentAdapter {
  readonly name = 'test';

  async *run(): AsyncIterable<AdapterEvent> {
    yield { type: 'run_started', payload: { adapter: this.name } };
    yield { type: 'text_delta', payload: { delta: 'Hello' } };
    yield { type: 'run_finished', payload: { summary: 'Done' } };
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
    expect(run?.status).toBe('finished');
    expect(run?.events.map((event) => event.type)).toEqual([
      'run_started',
      'text_delta',
      'run_finished',
    ]);
    expect(run?.events.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(run?.events.every((event) => event.nodeId === 'node-1')).toBe(true);
  });
});
