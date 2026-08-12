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
  it('rehydrates history only for a newly created LangGraph thread', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await new AssistantGateway('http://agent', 'default').start(input, new AbortController().signal);
    await response.text();
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
});
