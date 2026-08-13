import type { AgentRunRequest } from '../../../packages/protocol/src/agent';
import type { ActivatedSkill } from './skillRegistry';
import type { MCPServerStatus } from './mcpCapabilityRegistry';

interface SupervisorInput {
  runId: string;
  request: AgentRunRequest;
  workspaceRoot: string;
  activatedSkills: ActivatedSkill[];
  mcpCatalog: MCPServerStatus[];
}

export interface NodeSupervisorResult {
  brief: string;
  mcpCalls: Array<{ serverId: string; tool: string; status: 'started' | 'finished' | 'failed' }>;
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : '').join('');
}

export class NodeSupervisorGateway {
  constructor(
    private readonly baseUrl = process.env.LANGGRAPH_URL ?? 'http://127.0.0.1:8133',
    private readonly graphId = process.env.LANGGRAPH_NODE_GRAPH_ID ?? 'node-supervisor',
  ) {}

  async prepare(input: SupervisorInput, signal: AbortSignal): Promise<NodeSupervisorResult> {
    await this.ensureThread(input.runId, input.request.workspaceId, signal);
    const response = await fetch(`${this.baseUrl}/threads/${encodeURIComponent(input.runId)}/runs/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistant_id: this.graphId,
        input: {
          messages: [{ role: 'user', content: input.request.prompt }],
          workspace_id: input.request.workspaceId,
          workspace_root: input.workspaceRoot,
          execution_request: {
            nodeId: input.request.nodeId,
            topic: input.request.context.topic,
            workingDirectory: input.request.workingDirectory ?? '.',
            references: (input.request.context.references ?? []).map((reference) => ({ nodeId: reference.nodeId, title: reference.title })),
            attachments: (input.request.context.attachments ?? []).map((attachment) => attachment.name),
          },
          activated_skills: input.activatedSkills.map(({ name, description, source, content }) => ({ name, description, source, content })),
          mcp_catalog: input.mcpCatalog.filter((server) => server.enabled).map((server) => ({
            id: server.id,
            transport: server.transport,
            readOnly: server.readOnly,
            tools: server.tools,
          })),
        },
        stream_mode: ['messages', 'updates', 'custom'],
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
    });
    if (!response.ok || !response.body) {
      throw new Error(`LangGraph node supervisor returned ${response.status}: ${(await response.text().catch(() => '')).slice(0, 500)}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let brief = '';
    const mcpCalls = new Map<string, NodeSupervisorResult['mcpCalls'][number]>();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replaceAll('\r\n', '\n');
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const eventName = frame.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim() ?? '';
        const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        try {
          const raw = JSON.parse(dataLine.slice(5).trim()) as unknown;
          if (eventName.includes('custom')) {
            const customPayload = Array.isArray(raw) && raw.length === 2 ? raw[1] : raw;
            if (customPayload && typeof customPayload === 'object' && 'type' in customPayload) {
              const custom = customPayload as { type?: string; payload?: Record<string, unknown> };
              if (custom.type?.startsWith('mcp_')) {
                const serverId = String(custom.payload?.serverId ?? 'MCP');
                const tool = String(custom.payload?.tool ?? 'tool');
                const status = custom.type === 'mcp_failed' ? 'failed' : custom.type === 'mcp_finished' ? 'finished' : 'started';
                mcpCalls.set(`${serverId}:${tool}`, { serverId, tool, status });
              }
            }
            continue;
          }
          if (!eventName.includes('messages')) continue;
          const payload = Array.isArray(raw) && raw.length === 2 ? raw[0] : raw;
          const message = Array.isArray(payload) ? payload[0] : payload;
          if (message && typeof message === 'object') {
            const candidate = message as { type?: string; content?: unknown };
            if (candidate.type === 'AIMessageChunk' || candidate.type === 'ai') brief += messageText(candidate.content);
          }
        } catch { /* ignore malformed upstream frames */ }
      }
    }
    if (!brief.trim()) throw new Error('LangGraph node supervisor returned no execution brief.');
    return { brief: brief.trim(), mcpCalls: [...mcpCalls.values()] };
  }

  private async ensureThread(threadId: string, workspaceId: string, signal: AbortSignal): Promise<void> {
    const existing = await fetch(`${this.baseUrl}/threads/${encodeURIComponent(threadId)}`, { signal });
    if (existing.ok) return;
    if (existing.status !== 404) throw new Error(`Unable to inspect LangGraph node thread (${existing.status}).`);
    const created = await fetch(`${this.baseUrl}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId, metadata: { workspace_id: workspaceId, agent_type: 'node-agent' } }),
      signal,
    });
    if (!created.ok && created.status !== 409) throw new Error(`Unable to create LangGraph node thread (${created.status}).`);
  }
}

export const nodeSupervisorGateway = new NodeSupervisorGateway();
