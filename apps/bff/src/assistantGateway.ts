import type { CanvasSnapshot, WorkspaceAssistantEvent } from '../../../packages/protocol/src/assistant';
import type { ActivatedSkill } from './skillRegistry';
import type { MCPServerStatus } from './mcpCapabilityRegistry';

interface StartInput {
  workspaceId: string;
  threadId: string;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  canvas: CanvasSnapshot;
  workspaceRoot: string;
  activatedSkills: ActivatedSkill[];
  mcpCatalog?: MCPServerStatus[];
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

function publicAssistantError(error: unknown): string {
  const detail = String(error ?? 'LangGraph execution failed.');
  if (/insufficient balance|exceeded_current_quota|quota.*exhaust/i.test(detail)) {
    return 'Model account quota is exhausted. Recharge the configured provider account or switch models, then retry.';
  }
  if (/429|rate[_ -]?limit|max (?:organization )?concurrency|max rpm/i.test(detail)) {
    const retry = detail.match(/after\s+(\d+(?:\.\d+)?)\s+seconds?/i)?.[1];
    return `Model service is temporarily rate-limited.${retry ? ` Retry after about ${retry} seconds.` : ' Please retry shortly.'}`;
  }
  return detail;
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
        mcp_catalog: (input.mcpCatalog ?? []).filter((server) => server.enabled).map((server) => ({
          id: server.id,
          transport: server.transport,
          readOnly: server.readOnly,
          tools: server.tools,
        })),
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
    const graphId = this.graphId;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(asEvent(input, 'turn_started', {
          orchestrator: 'LangGraph',
          graphId,
          threadId: input.threadId,
        }))}\n\n`));
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const pendingActions: WorkspaceAssistantEvent[] = [];
        const streamedText = new Map<string, string>();
        let upstreamFailed = false;
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
                if (event.type === 'turn_failed') upstreamFailed = true;
                if (event.type === 'text_delta') {
                  const chunk = String(event.payload.delta ?? '');
                  const streamId = String(event.payload.streamId ?? 'default');
                  const previous = streamedText.get(streamId) ?? '';
                  // Some OpenAI-compatible providers emit the full text so far
                  // rather than a true delta. Normalize it before forwarding.
                  const cumulative = Boolean(previous) && chunk.startsWith(previous);
                  const delta = cumulative ? chunk.slice(previous.length) : chunk;
                  streamedText.set(streamId, cumulative ? chunk : previous + chunk);
                  if (!delta) continue;
                  event.payload = { delta };
                }
                if (event.type === 'canvas_command' || event.type === 'permission_required') {
                  const command = event.payload.command as { actionId?: unknown } | undefined;
                  const resolved = 'result' in input
                    ? input.result as { actionId?: unknown } | undefined
                    : undefined;
                  // interrupt() replays its node on resume, including custom
                  // events emitted before the interrupt. Ignore the replay of
                  // the action whose result is currently being resumed.
                  if (!resolved || command?.actionId !== resolved.actionId) pendingActions.push(event);
                } else {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                }
              }
            }
          }
          if (upstreamFailed) {
            // The translated upstream error has already been emitted.
          } else if (pendingActions.length > 1) {
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
    const customPayload = Array.isArray(data) && data.length === 2 ? data[1] : data;
    if (eventName?.includes('custom') && customPayload && typeof customPayload === 'object' && 'type' in customPayload) {
      const custom = customPayload as { type: WorkspaceAssistantEvent['type']; payload?: Record<string, unknown> };
      return [asEvent(input, custom.type, custom.payload ?? {})];
    }
    if (eventName?.includes('error')) {
      const errorPayload = customPayload as { error?: unknown; message?: unknown } | string | undefined;
      const message = typeof errorPayload === 'string' ? errorPayload : String(errorPayload?.message ?? '');
      const upstreamError = typeof errorPayload === 'string' ? '' : String(errorPayload?.error ?? '');
      const detail = /internal error occurred/i.test(message) && upstreamError
        ? upstreamError
        : message || upstreamError || 'LangGraph execution failed.';
      return [asEvent(input, 'turn_failed', { error: publicAssistantError(detail) })];
    }
    if (eventName?.includes('messages')) {
      // LangGraph's messages mode is normally [messageChunk, metadata]. Do
      // not apply the custom-event namespace unwrapping above: doing so picks
      // metadata and silently drops every assistant text chunk.
      const message = Array.isArray(data) ? data[0] : data;
      const metadata = Array.isArray(data) && data.length > 1 && data[1] && typeof data[1] === 'object'
        ? data[1] as Record<string, unknown>
        : {};
      if (message && typeof message === 'object') {
        const candidate = message as { content?: unknown; type?: string; id?: unknown };
        if ((candidate.type === 'AIMessageChunk' || candidate.type === 'ai') && typeof candidate.content === 'string' && candidate.content) {
          const streamId = String(candidate.id
            ?? `${metadata.langgraph_checkpoint_ns ?? ''}:${metadata.langgraph_step ?? ''}:${metadata.langgraph_node ?? 'agent'}`);
          return [asEvent(input, 'text_delta', { delta: candidate.content, streamId })];
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
