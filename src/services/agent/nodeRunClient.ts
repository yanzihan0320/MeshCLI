import {
  AgentEventSchema,
  AgentRunCreatedSchema,
  type AgentEvent,
  type AgentRunCreated,
  type AgentRunRequest,
} from '../../../packages/protocol/src/agent';

async function responseError(response: Response): Promise<string> {
  const data = await response.json().catch(() => ({})) as { error?: string };
  return data.error || response.statusText || `HTTP ${response.status}`;
}

export class NodeRunClient {
  async createRun(input: AgentRunRequest): Promise<AgentRunCreated> {
    const response = await fetch('/api/node-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await responseError(response));
    return AgentRunCreatedSchema.parse(await response.json());
  }

  async streamEvents(
    runId: string,
    onEvent: (event: AgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`, {
      headers: { Accept: 'text/event-stream' },
      signal,
    });
    if (!response.ok) throw new Error(await responseError(response));
    if (!response.body) throw new Error('Run event stream has no response body.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const parseBlock = (block: string) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) return;
      onEvent(AgentEventSchema.parse(JSON.parse(data)));
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      for (const block of blocks) parseBlock(block);
    }
    buffer += decoder.decode();
    if (buffer.trim()) parseBlock(buffer);
  }

  async cancelRun(runId: string): Promise<void> {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
    });
    if (!response.ok && response.status !== 409) throw new Error(await responseError(response));
  }
}

export const nodeRunClient = new NodeRunClient();
