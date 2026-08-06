import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { publicLLMConfig, resolveLLMConfig } from './llmConfig';
import { AgentRunRequestSchema, isTerminalAgentEvent } from '../../../packages/protocol/src/agent';
import { AgentRunManager, MockAgentAdapter } from './agentGateway';
import { OpenHandsAdapter } from './openHandsAdapter';

const app = new Hono();
const configuredAdapter = (process.env.AGENT_ADAPTER ?? 'openhands') === 'mock'
  ? new MockAgentAdapter()
  : new OpenHandsAdapter();
const agentRuns = new AgentRunManager(configuredAdapter);

app.use(
  '*',
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
    allowHeaders: ['Content-Type', 'Authorization', 'x-llm-provider'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

const MAX_LLM_BODY_BYTES = 10 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 180_000;

function providerFromRequest(c: { req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined } }) {
  return c.req.header('x-llm-provider') || c.req.query('provider');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

app.get('/api/llm/config', (c) => {
  const provider = providerFromRequest(c);
  const config = resolveLLMConfig(provider);
  if (!config) return c.json({ error: `Unknown provider: ${provider ?? 'none'}` }, 400);
  return c.json(publicLLMConfig(config));
});

app.get('/api/llm/models', async (c) => {
  const provider = providerFromRequest(c);
  const config = resolveLLMConfig(provider);
  if (!config) return c.json({ error: `Unknown provider: ${provider ?? 'none'}` }, 400);
  if (!config.apiKey) return c.json({ error: `Missing ${config.envKey}` }, 502);
  if (!config.modelsEndpoint) {
    return c.json({ error: `${config.displayName} does not expose an OpenAI-compatible models endpoint.` }, 400);
  }

  try {
    const upstream = await fetch(config.modelsEndpoint, {
      headers: config.authHeaders,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return c.json({ error: (data as { error?: { message?: string } }).error?.message || `Upstream error ${upstream.status}` }, upstream.status as 400);
    }
    return c.json(data);
  } catch (error) {
    return c.json({ error: `Unable to fetch models: ${errorMessage(error)}` }, 502);
  }
});

app.post('/api/llm/test', async (c) => {
  const provider = providerFromRequest(c);
  const config = resolveLLMConfig(provider);
  if (!config) return c.json({ success: false, message: `Unknown provider: ${provider ?? 'none'}` }, 400);
  if (!config.apiKey || !config.model) {
    return c.json({ success: false, message: `Configure ${config.envKey} and the server-side model first.` }, 502);
  }

  const body = config.provider === 'anthropic'
    ? { model: config.model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 8, stream: false }
    : { model: config.model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 8, stream: false };

  try {
    const upstream = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...config.authHeaders },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (upstream.ok) return c.json({ success: true, message: 'Connection successful' });
    const data = await upstream.json().catch(() => ({}));
    return c.json({
      success: false,
      message: (data as { error?: { message?: string } }).error?.message || `Upstream error ${upstream.status}`,
    }, 502);
  } catch (error) {
    return c.json({ success: false, message: `Connection failed: ${errorMessage(error)}` }, 502);
  }
});

// LLM proxy endpoint (for direct node chat)
app.post('/api/llm', async (c) => {
  const provider = providerFromRequest(c);
  const cfg = resolveLLMConfig(provider);

  if (!provider || !cfg) {
    return c.json({ error: `Unknown provider: ${provider ?? 'none'}` }, 400);
  }

  if (!cfg.apiKey || !cfg.model) {
    return c.json({ error: `Missing server-side model configuration. Set ${cfg.envKey} and the provider model environment variable.` }, 502);
  }

  const contentLength = Number(c.req.header('content-length') || 0);
  if (contentLength > MAX_LLM_BODY_BYTES) {
    return c.json({ error: 'LLM request body is too large.' }, 413);
  }

  let requestBody: Record<string, unknown>;
  try {
    requestBody = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'Invalid JSON request body.' }, 400);
  }

  const serializedBody = JSON.stringify({ ...requestBody, model: cfg.model });
  if (Buffer.byteLength(serializedBody, 'utf8') > MAX_LLM_BODY_BYTES) {
    return c.json({ error: 'LLM request body is too large.' }, 413);
  }

  try {
    const upstream = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...cfg.authHeaders,
      },
      body: serializedBody,
      signal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'text/event-stream',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
    return c.json({ error: `Upstream request failed: ${errorMessage(error)}` }, 502);
  }
});

// Agent endpoint
app.post('/api/agent', async (c) => {
  const provider = providerFromRequest(c);
  const cfg = resolveLLMConfig(provider);
  if (!provider || !cfg) {
    return c.json({ error: `Unknown assistant provider: ${provider ?? 'none'}` }, 400);
  }
  if (!cfg.apiKey || !cfg.model) {
    return c.json({ error: `Assistant provider is not configured. Set ${cfg.envKey} and its model environment variable.` }, 502);
  }

  const { message, canvasState } = await c.req.json<{
    message?: string;
    canvasState?: { nodes?: unknown[]; edges?: unknown[] };
  }>();
  if (!message?.trim()) return c.json({ error: 'Assistant message is required.' }, 400);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let model: any;

  if (cfg.provider === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey: cfg.apiKey,
      baseURL: cfg.endpoint.replace(/\/messages$/, ''),
    });
    model = anthropic(cfg.model);
  } else {
    const openai = createOpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.endpoint.replace(/\/chat\/completions$/, ''),
    });
    model = openai.chat(cfg.model);
  }

  // Build system prompt with canvas state
  const nodeCount = canvasState?.nodes?.length ?? 0;
  const edgeCount = canvasState?.edges?.length ?? 0;
  
  const systemPrompt = `You are the MeshCLI workspace assistant, helping users understand and organize their conversation canvas.

Current canvas state:
- ${nodeCount} nodes
- ${edgeCount} edges

Current capability boundary:
- You can answer questions and propose node, branch, merge, focus, or visualization plans.
- No canvas mutation tools are connected in this build.
- You cannot actually create, delete, connect, merge, focus, or update nodes.
- Never claim that a canvas action has completed.
- When asked to change the canvas, label the response as a proposed action and clearly say that execution is not available yet.`;

  const encoder = new TextEncoder();
  const event = (type: string, data: Record<string, unknown>) =>
    encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`);

  const result = streamText({
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: message }],
    abortSignal: c.req.raw.signal,
  });

  const eventStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(event('message_start', { provider: cfg.provider, model: cfg.model }));
      try {
        for await (const delta of result.textStream) {
          controller.enqueue(event('text_delta', { delta }));
        }
        controller.enqueue(event('message_end', {}));
      } catch (error) {
        controller.enqueue(event('error', { error: errorMessage(error) }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(eventStream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
    },
  });
});

// Node execution gateway. OpenHands runs against an isolated managed copy and
// the Gateway alone may apply an approved patch to the real project.
app.post('/api/node-runs', async (c) => {
  const parsed = AgentRunRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid node run request', issues: parsed.error.issues }, 400);
  }
  return c.json(agentRuns.create(parsed.data), 202);
});

app.get('/api/runs/:runId/events', (c) => {
  const run = agentRuns.get(c.req.param('runId'));
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const encoder = new TextEncoder();
  const encode = (event: unknown) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        controller.close();
      };
      const unsubscribe = agentRuns.subscribe(run.runId, (event) => {
        if (closed) return;
        controller.enqueue(encode(event));
        if (isTerminalAgentEvent(event.type)) close();
      });

      for (const event of run.events) controller.enqueue(encode(event));
      const lastEvent = run.events.at(-1);
      if (lastEvent && isTerminalAgentEvent(lastEvent.type)) close();
      c.req.raw.signal.addEventListener('abort', close, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
    },
  });
});

app.post('/api/runs/:runId/cancel', async (c) => {
  if (!agentRuns.get(c.req.param('runId'))) return c.json({ error: 'Run not found' }, 404);
  const cancelled = await agentRuns.cancel(c.req.param('runId'));
  if (!cancelled) return c.json({ error: 'Run is already complete' }, 409);
  return c.json({ status: 'cancelled' });
});

app.post('/api/runs/:runId/apply', async (c) => {
  if (!agentRuns.get(c.req.param('runId'))) return c.json({ error: 'Run not found' }, 404);
  const event = await agentRuns.apply(c.req.param('runId'));
  if (!event) return c.json({ error: 'Run is not ready to apply' }, 409);
  return c.json(event, event.type === 'patch_conflict' ? 409 : 200);
});

app.post('/api/runs/:runId/reject', async (c) => {
  if (!agentRuns.get(c.req.param('runId'))) return c.json({ error: 'Run not found' }, 404);
  const event = await agentRuns.reject(c.req.param('runId'));
  if (!event) return c.json({ error: 'Run is not ready to reject' }, 409);
  return c.json(event);
});

const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port }, () => {
  console.log(`BFF ready at http://localhost:${port}`);
  console.log(`LLM proxy: http://localhost:${port}/api/llm`);
  console.log(`Agent: http://localhost:${port}/api/agent`);
  console.log(`Node runs: http://localhost:${port}/api/node-runs`);
  console.log(`Execution adapter: ${configuredAdapter.name}`);
});
