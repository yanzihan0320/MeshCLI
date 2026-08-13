import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeSupervisorGateway } from './nodeSupervisorGateway';

afterEach(() => vi.unstubAllGlobals());

describe('NodeSupervisorGateway', () => {
  it('returns the execution brief together with actual MCP call receipts', async () => {
    const frames = [
      `event: custom\ndata: ${JSON.stringify({ type: 'mcp_started', payload: { serverId: 'workspace-filesystem', tool: 'read_text_file' } })}`,
      `event: custom\ndata: ${JSON.stringify({ type: 'mcp_finished', payload: { serverId: 'workspace-filesystem', tool: 'read_text_file' } })}`,
      `event: messages\ndata: ${JSON.stringify([{ type: 'AIMessageChunk', content: 'Inspect the repository safely.' }, {}])}`,
      '',
    ].join('\n\n');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(frames, { status: 200 })));

    const result = await new NodeSupervisorGateway('http://agent', 'node-supervisor').prepare({
      runId: 'run-1',
      request: {
        nodeId: 'node-1', workspaceId: 'workspace-1', prompt: 'Inspect',
        context: { topic: 'Topic', messages: [] },
      },
      workspaceRoot: 'D:\\repo',
      activatedSkills: [],
      mcpCatalog: [],
    }, new AbortController().signal);

    expect(result.brief).toBe('Inspect the repository safely.');
    expect(result.mcpCalls).toEqual([{
      serverId: 'workspace-filesystem', tool: 'read_text_file', status: 'finished',
    }]);
  });
});
