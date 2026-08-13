import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentClient } from './client';
import type { AgentEvent } from './types';

afterEach(() => vi.unstubAllGlobals());

const input = {
  workspaceId: 'workspace-1',
  threadId: '00000000-0000-4000-8000-000000000001',
  message: 'Hi',
  history: [],
  canvas: { version: 1 as const, workspaceId: 'workspace-1', revision: 0, selectedNodeIds: [], nodes: [], edges: [] },
};

describe('AgentClient', () => {
  it('sends turns through the BFF and parses validated assistant events', async () => {
    const event: AgentEvent = {
      version: 1, eventId: 'event-1', workspaceId: 'workspace-1', threadId: input.threadId,
      timestamp: 1, type: 'text_delta', payload: { delta: 'Hello' },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify(event)}\n\n`, { status: 200 })));
    const events: AgentEvent[] = [];
    await new AgentClient().sendTurn(input, 'custom', (candidate) => events.push(candidate));
    expect(fetch).toHaveBeenCalledWith('/api/assistant/turns', expect.objectContaining({
      headers: expect.objectContaining({ 'x-llm-provider': 'custom' }),
    }));
    expect(events).toEqual([event]);
  });

  it('turns an HTTP error into a visible failure event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'LangGraph unavailable' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })));
    const events: AgentEvent[] = [];
    await new AgentClient().sendTurn(input, 'custom', (candidate) => events.push(candidate));
    expect(events[0]?.type).toBe('turn_failed');
    expect(events[0]?.payload.error).toBe('LangGraph unavailable');
  });

  it('turns an invalid SSE event into a visible failure instead of silently hanging', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data: {"type":"unknown"}\n\n', { status: 200 })));
    const events: AgentEvent[] = [];
    await new AgentClient().sendTurn(input, 'custom', (candidate) => events.push(candidate));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('turn_failed');
  });
});
