import type { CanvasState, AgentEvent } from './types';

const AGENT_API_URL = '/api/agent';

export class AgentClient {
  private abortController: AbortController | null = null;

  async sendMessage(
    message: string,
    canvasState: CanvasState,
    threadId: string,
    providerId: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    this.abortController = new AbortController();

    try {
      const response = await fetch(AGENT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-llm-provider': providerId,
        },
        body: JSON.stringify({
          message,
          canvasState,
          threadId,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = (data as { error?: string }).error || response.statusText;
        throw new Error(`Agent error: ${message}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              onEvent(event);
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      onEvent({
        type: 'error',
        data: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}

export const agentClient = new AgentClient();
