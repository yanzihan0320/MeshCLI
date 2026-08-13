import type {
  CanvasCommandResult,
  CanvasSnapshot,
  WorkspaceAssistantEvent,
} from '../../../packages/protocol/src/assistant';
import { WorkspaceAssistantEventSchema } from '../../../packages/protocol/src/assistant';

interface TurnInput {
  workspaceId: string;
  threadId: string;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  canvas: CanvasSnapshot;
}

interface ResolveInput {
  workspaceId: string;
  threadId: string;
  result: CanvasCommandResult;
  canvas: CanvasSnapshot;
}

export class AgentClient {
  private abortController: AbortController | null = null;

  async sendTurn(input: TurnInput, providerId: string, onEvent: (event: WorkspaceAssistantEvent) => void): Promise<void> {
    this.abortController = new AbortController();
    await this.stream('/api/assistant/turns', input, providerId, onEvent, this.abortController.signal);
  }

  async resolveAction(actionId: string, input: ResolveInput, providerId: string, onEvent: (event: WorkspaceAssistantEvent) => void): Promise<void> {
    this.abortController = new AbortController();
    await this.stream(`/api/assistant/actions/${encodeURIComponent(actionId)}/resolve`, input, providerId, onEvent, this.abortController.signal);
  }

  private async stream(
    url: string,
    body: TurnInput | ResolveInput,
    providerId: string,
    onEvent: (event: WorkspaceAssistantEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-llm-provider': providerId },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || response.statusText);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Assistant response did not contain an event stream.');
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.split('\n').find((candidate) => candidate.startsWith('data:'));
          if (!line) continue;
          const parsed = WorkspaceAssistantEventSchema.safeParse(JSON.parse(line.slice(5).trim()));
          if (parsed.success) {
            onEvent(parsed.data);
          } else {
            onEvent({
              version: 1,
              eventId: crypto.randomUUID(),
              workspaceId: body.workspaceId,
              threadId: body.threadId,
              timestamp: Date.now(),
              type: 'turn_failed',
              payload: { error: 'The assistant returned an invalid event. Please retry after restarting the local services.' },
            });
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      const workspaceId = body.workspaceId;
      const threadId = body.threadId;
      onEvent({
        version: 1,
        eventId: crypto.randomUUID(),
        workspaceId,
        threadId,
        timestamp: Date.now(),
        type: 'turn_failed',
        payload: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}

export const agentClient = new AgentClient();
