import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeRunClient } from './nodeRunClient';
import type { AgentEvent } from '../../../packages/protocol/src/agent';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NodeRunClient', () => {
  it('creates a node-bound run', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      runId: 'run-1',
      nodeId: 'node-1',
      status: 'queued',
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new NodeRunClient().createRun({
      nodeId: 'node-1',
      workspaceId: 'workspace-1',
      prompt: 'Analyze the node',
      context: { topic: 'Topic', messages: [] },
    })).resolves.toEqual({ runId: 'run-1', nodeId: 'node-1', status: 'queued' });

    expect(fetchMock).toHaveBeenCalledWith('/api/node-runs', expect.objectContaining({ method: 'POST' }));
  });

  it('parses validated SSE events across chunks', async () => {
    const event = {
      version: 1,
      eventId: 'event-1',
      runId: 'run-1',
      nodeId: 'node-1',
      sequence: 0,
      timestamp: 100,
      type: 'run_started',
      payload: { adapter: 'mock' },
    };
    const encoded = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 20));
        controller.enqueue(encoded.slice(20));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })));

    const events: AgentEvent[] = [];
    await new NodeRunClient().streamEvents('run-1', (received) => events.push(received));
    expect(events).toEqual([event]);
  });

  it('returns the normalized event produced by a review action', async () => {
    const event = {
      version: 1,
      eventId: 'event-apply',
      runId: 'run-1',
      nodeId: 'node-1',
      sequence: 4,
      timestamp: 200,
      type: 'patch_applied',
      payload: { changeSetId: 'change-1' },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(event), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new NodeRunClient().reviewRun('run-1', 'apply', 'change-1')).resolves.toEqual(event);
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run-1/apply', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ changeSetId: 'change-1', actionId: 'review-change-1' }),
    }));
  });
});
