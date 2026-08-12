import type { CanvasSnapshot, WorkspaceAssistantEvent } from '../../../packages/protocol/src/assistant';
import type { ActivatedSkill } from './skillRegistry';

interface StartInput {
  workspaceId: string;
  threadId: string;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  canvas: CanvasSnapshot;
  workspaceRoot: string;
  activatedSkills: ActivatedSkill[];
}

interface ResumeInput {
  workspaceId: string;
  threadId: string;
  canvas: CanvasSnapshot;
  workspaceRoot: string;
  result: unknown;
}

const encoder = new TextEncoder();

function asEvent(input: StartInput | ResumeInput, type: WorkspaceAssistantEvent['type'], payload: Record<string, unknown>): WorkspaceAssistantEvent {
  return { version: 1, eventId: crypto.randomUUID(), workspaceId: input.workspaceId, threadId: input.threadId, timestamp: Date.now(), type, payload };
}

export class AssistantGateway {
  constructor(
    private readonly baseUrl = process.env.LANGGRAPH_URL ?? 'http://127.0.0.1:8133',
    private readonly graphId = process.env.LANGGRAPH_GRAPH_ID ?? 'default',
  ) {}

  start(input: StartInput, signal: AbortSignal): Promise<Response> {
    return this.proxy(input, signal, (created) => ({
      assistant_id: this.graphId,
      input: {
        messages: [
          ...(created ? input.history.filter((message) => message.content.trim()) : []),
          { role: 'user', content: input.message },
        ],
        workspace_id: input.workspaceId,
        canvas: input.canvas,
        workspace_root: input.workspaceRoot,
        activated_skills: input.activatedSkills.map(({ name, description, source, content }) => ({ name, description, source, content })),
      },
      stream_mode: ['custom', 'messages', 'updates'],
    }));
  }

  resume(input: ResumeInput, signal: AbortSignal): Promise<Response> {
    return this.proxy(input, signal, {
      assistant_id: this.graphId,
      command: { resume: { result: input.result, canvas: input.canvas, workspace_root: input.workspaceRoot } },
      stream_mode: ['custom', 'messages', 'updates'],
    });
  }

  private async proxy(
    input: StartInput | ResumeInput,
    signal: AbortSignal,
    body: Record<string, unknown> | ((created: boolean) => Record<string, unknown>),
  ): Promise<Response> {
    const created = await this.ensureThread(input.threadId, input.workspaceId, signal);
    const requestBody = typeof body === 'function' ? body(created) : body;
    const upstream = await fetch(`${this.baseUrl}/threads/${encodeURIComponent(input.threadId)}/runs/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
    });
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      throw new Error(`LangGraph Agent Server returned ${upstream.status}: ${detail.slice(0, 500)}`);
    }

    const translate = this.translate.bind(this);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(asEvent(input, 'turn_started', {}))}\n\n`));
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const pendingActions: WorkspaceAssistantEvent[] = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            buffer = buffer.replaceAll('\r\n', '\n');
            const frames = buffer.split('\n\n');
            buffer = frames.pop() ?? '';
            for (const frame of frames) {
              const eventName = frame.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim();
              const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
              if (!dataLine) continue;
              let data: unknown;
              try { data = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
              const translated = translate(input, eventName, data);
              for (const event of translated) {
                if (event.type === 'canvas_command' || event.type === 'permission_required') {
                  pendingActions.push(event);
                } else {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                }
              }
            }
          }
          if (pendingActions.length > 1) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(asEvent(input, 'turn_failed', { error: 'The agent requested multiple concurrent canvas actions; replan one action at a time.' }))}\n\n`));
          } else if (pendingActions.length > 0) {
            for (const event of pendingActions) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(asEvent(input, 'turn_finished', {}))}\n\n`));
          }
        } catch (error) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(asEvent(input, 'turn_failed', { error: error instanceof Error ? error.message : String(error) }))}\n\n`));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' } });
  }

  private translate(input: StartInput | ResumeInput, eventName: string | undefined, data: unknown): WorkspaceAssistantEvent[] {
    const payload = Array.isArray(data) && data.length === 2 ? data[1] : data;
    if (eventName?.includes('custom') && payload && typeof payload === 'object' && 'type' in payload) {
      const custom = payload as { type: WorkspaceAssistantEvent['type']; payload?: Record<string, unknown> };
      return [asEvent(input, custom.type, custom.payload ?? {})];
    }
    if (eventName?.includes('messages')) {
      const message = Array.isArray(payload) ? payload[0] : payload;
      if (message && typeof message === 'object') {
        const candidate = message as { content?: unknown; type?: string };
        if ((candidate.type === 'AIMessageChunk' || candidate.type === 'ai') && typeof candidate.content === 'string' && candidate.content) {
          return [asEvent(input, 'text_delta', { delta: candidate.content })];
        }
      }
    }
    return [];
  }

  private async ensureThread(threadId: string, workspaceId: string, signal: AbortSignal): Promise<boolean> {
    const existing = await fetch(`${this.baseUrl}/threads/${encodeURIComponent(threadId)}`, { signal });
    if (existing.ok) return false;
    if (existing.status !== 404) throw new Error(`Unable to inspect LangGraph thread (${existing.status}).`);
    const response = await fetch(`${this.baseUrl}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId, metadata: { workspace_id: workspaceId } }),
      signal,
    });
    if (response.ok) return true;
    if (response.status === 409) return false;
    throw new Error(`Unable to create LangGraph thread (${response.status}).`);
  }
}

export const assistantGateway = new AssistantGateway();
