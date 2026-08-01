import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentClient } from './client';
import type { AgentEvent } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AgentClient', () => {
  it('sends the selected assistant provider and parses SSE agent events', async () => {
    const body = [
      'data: {"type":"message_start","data":{}}',
      '',
      'data: {"type":"text_delta","data":{"delta":"Hello"}}',
      '',
      'data: {"type":"message_end","data":{}}',
      '',
    ].join('\n');
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const events: AgentEvent[] = [];
    await new AgentClient().sendMessage(
      'Hi',
      { nodes: [], edges: [], conversations: {} },
      'thread-1',
      'custom',
      (event) => events.push(event),
    );

    expect(fetchMock).toHaveBeenCalledWith('/api/agent', expect.objectContaining({
      headers: expect.objectContaining({ 'x-llm-provider': 'custom' }),
    }));
    expect(events.map((event) => event.type)).toEqual([
      'message_start',
      'text_delta',
      'message_end',
    ]);
    expect(events[1]?.data).toEqual({ delta: 'Hello' });
  });

  it('turns an HTTP error into a visible agent error event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Provider is not configured' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )));

    const events: AgentEvent[] = [];
    await new AgentClient().sendMessage(
      'Hi',
      { nodes: [], edges: [], conversations: {} },
      'thread-1',
      'custom',
      (event) => events.push(event),
    );

    expect(events).toEqual([{
      type: 'error',
      data: { error: 'Agent error: Provider is not configured' },
    }]);
  });
});
