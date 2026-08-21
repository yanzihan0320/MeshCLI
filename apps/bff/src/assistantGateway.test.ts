import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantGateway } from './assistantGateway';

afterEach(() => vi.unstubAllGlobals());

const input = {
  workspaceId: 'workspace-1',
  threadId: '00000000-0000-4000-8000-000000000001',
  message: 'new turn',
  history: [{ role: 'user' as const, content: 'old question' }, { role: 'assistant' as const, content: 'old answer' }],
  canvas: { version: 1 as const, workspaceId: 'workspace-1', revision: 2, selectedNodeIds: [], nodes: [], edges: [] },
  workspaceRoot: 'D:\\repo',
  activatedSkills: [],
};

describe('AssistantGateway', () => {
  it('uses caller cancellation without imposing a fixed total timeout', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await new AssistantGateway('http://agent', 'default').start(input, controller.signal);
    await response.text();

    expect(fetchMock.mock.calls[1][1].signal).toBe(controller.signal);
  });

  it('rehydrates history only for a newly created LangGraph thread', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await new AssistantGateway('http://agent', 'default').start(input, new AbortController().signal);
    const stream = await response.text();
    expect(stream).toContain('"orchestrator":"LangGraph"');
    expect(stream).toContain('"graphId":"default"');
    const body = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(body.input.messages).toEqual([...input.history, { role: 'user', content: 'new turn' }]);
  });

  it('buffers a canvas action until the upstream interrupt run has ended', async () => {
    const custom = { type: 'canvas_command', payload: { command: { actionId: 'action-1' } } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(`event: custom\r\ndata: ${JSON.stringify(custom)}\r\n\r\n`, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await new AssistantGateway('http://agent', 'default').start(input, new AbortController().signal);
    const text = await response.text();
    expect(text).toContain('canvas_command');
    expect(text).not.toContain('turn_finished');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.input.messages).toEqual([{ role: 'user', content: 'new turn' }]);
  });

  it('translates LangGraph message tuples without dropping the assistant text', async () => {
    const chunk = { type: 'AIMessageChunk', content: 'Created the node.' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(`event: messages\ndata: ${JSON.stringify([chunk, { langgraph_node: 'agent' }])}\n\n`, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await new AssistantGateway('http://agent', 'default').start(input, new AbortController().signal);
    const text = await response.text();
    expect(text).toContain('text_delta');
    expect(text).toContain('Created the node.');
  });

  it('normalizes cumulative provider chunks into true text deltas', async () => {
    const chunks = ['我来', '我来分两步', '我来分两步完成'];
    const upstream = chunks.map((content) => `event: messages\ndata: ${JSON.stringify([
      { type: 'AIMessageChunk', id: 'message-1', content },
      { langgraph_node: 'agent', langgraph_step: 1 },
    ])}`).join('\n\n') + '\n\n';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(upstream, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await new AssistantGateway('http://agent', 'default').start(input, new AbortController().signal);
    const events = (await response.text()).split('\n\n').filter(Boolean).map((frame) => {
      const line = frame.split('\n').find((candidate) => candidate.startsWith('data:'))!;
      return JSON.parse(line.slice(5).trim()) as { type: string; payload: { delta?: string } };
    });
    expect(events.filter((event) => event.type === 'text_delta').map((event) => event.payload.delta).join(''))
      .toBe('我来分两步完成');
  });

  it('turns an upstream LangGraph error into a failed turn', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('event: error\ndata: {"message":"model rejected parameters"}\n\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await new AssistantGateway('http://agent', 'default').start(input, new AbortController().signal);
    const text = await response.text();
    expect(text).toContain('turn_failed');
    expect(text).not.toContain('turn_finished');
  });

  it('replaces generic internal errors with a safe actionable quota message', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(`event: error\ndata: ${JSON.stringify({
        message: 'An internal error occurred',
        error: '429 exceeded_current_quota_error: insufficient balance for org-secret',
      })}\n\n`, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await new AssistantGateway('http://agent', 'default').start(input, new AbortController().signal);
    const text = await response.text();
    expect(text).toContain('Model account quota is exhausted');
    expect(text).not.toContain('org-secret');
  });

  it('filters the replayed canvas event when resuming a LangGraph interrupt', async () => {
    const replay = { type: 'canvas_command', payload: { command: { actionId: 'action-1', type: 'create_node' } } };
    const chunk = { type: 'AIMessageChunk', content: 'Node created.' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response([
        `event: custom\ndata: ${JSON.stringify(replay)}`,
        `event: messages\ndata: ${JSON.stringify([chunk, {}])}`,
        '',
      ].join('\n\n'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await new AssistantGateway('http://agent', 'default').resume({
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      canvas: input.canvas,
      workspaceRoot: input.workspaceRoot,
      result: { actionId: 'action-1', status: 'applied' },
    }, new AbortController().signal);
    const frames = (await response.text()).split('\n\n').filter(Boolean).map((frame) => {
      const line = frame.split('\n').find((candidate) => candidate.startsWith('data:'))!;
      return JSON.parse(line.slice(5).trim()) as { type: string };
    });
    expect(frames.map((event) => event.type)).toEqual(['turn_started', 'text_delta', 'turn_finished']);
  });
});
