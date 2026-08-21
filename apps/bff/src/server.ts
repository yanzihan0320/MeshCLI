import { Hono } from 'hono';
import { z } from 'zod';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { publicLLMConfig, resolveLLMConfig } from './llmConfig';
import {
  AgentReviewDecisionSchema,
  AgentRunRequestSchema,
  isTerminalAgentEvent,
} from '../../../packages/protocol/src/agent';
import { AgentRunManager, MockAgentAdapter } from './agentGateway';
import { OpenHandsAdapter } from './openHandsAdapter';
import { workspaceBindingRegistry } from './workspaceBindingRegistry';
import { AssistantActionResolveSchema, AssistantTurnRequestSchema } from '../../../packages/protocol/src/assistant';
import { assistantGateway } from './assistantGateway';
import { skillRegistry } from './skillRegistry';
import { mcpCapabilityRegistry } from './mcpCapabilityRegistry';
import { SupervisedAgentAdapter } from './supervisedAgentAdapter';

const app = new Hono();
const executionAdapter = (process.env.AGENT_ADAPTER ?? 'openhands') === 'mock'
  ? new MockAgentAdapter()
  : new OpenHandsAdapter();
const configuredAdapter = process.env.AGENT_LANGGRAPH_SUPERVISOR === 'false'
  ? executionAdapter
  : new SupervisedAgentAdapter(executionAdapter);
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

function agentModelConfig() {
  const config = resolveLLMConfig('openai');
  const configuredDefault = config?.model?.trim();
  const explicit = (process.env.AGENT_ALLOWED_MODELS ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  const allowed = new Set(explicit.length ? explicit : configuredDefault ? [configuredDefault] : []);
  if (configuredDefault) allowed.add(configuredDefault);
  return { config, configuredDefault, allowed };
}

function providerFromRequest(c: { req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined } }) {
  return c.req.header('x-llm-provider') || c.req.query('provider');
}

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    return `${error.message}: ${cause.message}`;
  }
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    return `${error.message} (${String((cause as { code?: unknown }).code)})`;
  }
  return error.message;
}

function publicSkill(skill: Awaited<ReturnType<typeof skillRegistry.list>>[number]) {
  return {
    name: skill.name,
    description: skill.description,
    source: skill.source,
    enabled: skill.enabled,
    error: skill.error,
    overriddenBy: skill.overriddenBy,
    shadows: skill.shadows,
    lastActivatedAt: skill.lastActivatedAt,
  };
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

app.get('/api/agent/models', async (c) => {
  const { config, configuredDefault, allowed } = agentModelConfig();
  if (!config || !configuredDefault || !config.apiKey) {
    return c.json({ error: 'The Agent model is not configured.' }, 502);
  }

  let upstreamIds: string[] = [];
  let warning: string | undefined;
  if (process.env.AGENT_ALLOWED_MODELS?.trim() && config.modelsEndpoint) {
    try {
      const upstream = await fetch(config.modelsEndpoint, {
        headers: config.authHeaders,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      const data = await upstream.json().catch(() => ({})) as { data?: Array<{ id?: string }> };
      if (!upstream.ok) throw new Error(`Upstream error ${upstream.status}`);
      upstreamIds = (data.data ?? []).map((item) => item.id ?? '').filter(Boolean);
    } catch (error) {
      warning = `Model discovery failed; using the configured allowlist. ${errorMessage(error)}`;
    }
  }

  const discovered = new Set(upstreamIds);
  const models = [...allowed]
    .filter((id) => id === configuredDefault || discovered.size === 0 || discovered.has(id))
    .map((id) => ({ id, name: id }));
  return c.json({ defaultModelId: configuredDefault, models, warning });
});

app.get('/api/workspace-bindings/:workspaceId', async (c) => {
  try {
    return c.json(await workspaceBindingRegistry.resolve(c.req.param('workspaceId')));
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 404);
  }
});

app.post('/api/workspace-bindings/:workspaceId/pick', async (c) => {
  try {
    const binding = await workspaceBindingRegistry.pickAndBind(c.req.param('workspaceId'));
    if (!binding) return c.json({ cancelled: true });
    return c.json(binding);
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
});

app.post('/api/workspace-bindings/:workspaceId/bind', async (c) => {
  const body = await c.req.json<{ path?: string }>().catch(() => ({}));
  if (!body.path?.trim()) return c.json({ error: 'A workspace path is required.' }, 400);
  try {
    return c.json(await workspaceBindingRegistry.bindPath(c.req.param('workspaceId'), body.path));
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
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

  const serializedBody = JSON.stringify({
    ...requestBody,
    model: cfg.model,
    ...(/^kimi-k3(?:$|-)/i.test(cfg.model) ? { temperature: 1 } : {}),
  });
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

app.post('/api/agent', (c) => c.json({ error: 'Use /api/assistant/turns. The direct-model assistant route has been retired.' }, 410));

const SkillToggleSchema = z.object({
  workspaceId: z.string().min(1),
  enabled: z.boolean(),
});
const SkillValidateSchema = z.object({ skillMd: z.string().min(1).max(500 * 1024) });
const SkillInstallSchema = z.object({
  workspaceId: z.string().min(1),
  scope: z.enum(['global', 'workspace']),
  overwrite: z.boolean().default(false),
  files: z.array(z.object({ path: z.string().min(1).max(300), content: z.string().max(500 * 1024) })).min(1).max(100),
});
const MCPToggleSchema = z.object({ enabled: z.boolean() });

app.get('/api/capabilities/skills', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) return c.json({ error: 'workspaceId is required.' }, 400);
  try {
    return c.json({ skills: (await skillRegistry.list(workspaceId)).map(publicSkill), usage: await skillRegistry.usage(workspaceId) });
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
});

app.patch('/api/capabilities/skills/:name', async (c) => {
  const parsed = SkillToggleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'workspaceId and enabled are required.' }, 400);
  try {
    return c.json({ skill: publicSkill(await skillRegistry.setEnabled(parsed.data.workspaceId, c.req.param('name'), parsed.data.enabled)) });
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
});

app.post('/api/capabilities/skills/validate', async (c) => {
  const parsed = SkillValidateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ valid: false, error: 'skillMd is required and must be at most 500KB.' }, 400);
  try {
    return c.json({ valid: true, skill: skillRegistry.validate(parsed.data.skillMd) });
  } catch (error) {
    return c.json({ valid: false, error: errorMessage(error) }, 400);
  }
});

app.post('/api/capabilities/skills/install', async (c) => {
  const parsed = SkillInstallSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid Skill bundle.', issues: parsed.error.issues }, 400);
  try {
    return c.json({ skill: publicSkill(await skillRegistry.install(
      parsed.data.workspaceId,
      parsed.data.scope,
      parsed.data.files,
      parsed.data.overwrite,
    )) }, 201);
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
});

app.delete('/api/capabilities/skills/:name', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) return c.json({ error: 'workspaceId is required.' }, 400);
  try {
    await skillRegistry.remove(workspaceId, c.req.param('name'));
    return c.json({ removed: true });
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
});

app.get('/api/capabilities/mcp', async (c) => {
  try {
    return c.json({ servers: await mcpCapabilityRegistry.list(c.req.query('workspaceId')) });
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
});

app.patch('/api/capabilities/mcp/:id', async (c) => {
  const parsed = MCPToggleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'enabled is required.' }, 400);
  try {
    return c.json({ server: await mcpCapabilityRegistry.setEnabled(c.req.param('id'), parsed.data.enabled) });
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
});

app.post('/api/capabilities/mcp/:id/test', async (c) => {
  const body = await c.req.json<{ workspaceId?: string }>().catch(() => ({}));
  try {
    return c.json(await mcpCapabilityRegistry.test(c.req.param('id'), body.workspaceId));
  } catch (error) {
    return c.json({ success: false, error: errorMessage(error), tools: [] }, 400);
  }
});

app.get('/api/assistant/skills', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) return c.json({ error: 'workspaceId is required.' }, 400);
  try {
    const skills = await skillRegistry.list(workspaceId);
    return c.json({ skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      enabled: skill.enabled,
      error: skill.error,
    })) });
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
});

app.get('/api/assistant/mcp/status', async (c) => {
  return c.json({ servers: await mcpCapabilityRegistry.list(c.req.query('workspaceId')) });
});

app.post('/api/assistant/turns', async (c) => {
  const parsed = AssistantTurnRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid assistant turn.', issues: parsed.error.issues }, 400);
  if (parsed.data.canvas.workspaceId !== parsed.data.workspaceId) return c.json({ error: 'Canvas workspace does not match the assistant workspace.' }, 409);
  try {
    const binding = await workspaceBindingRegistry.resolve(parsed.data.workspaceId).catch(() => undefined);
    const [activatedSkills, mcpCatalog] = await Promise.all([
      skillRegistry.activate(parsed.data.workspaceId, parsed.data.message, 'assistant'),
      mcpCapabilityRegistry.list(parsed.data.workspaceId),
    ]);
    return await assistantGateway.start({ ...parsed.data, workspaceRoot: binding?.sourceRoot ?? '', activatedSkills, mcpCatalog }, c.req.raw.signal);
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 502);
  }
});

app.post('/api/assistant/actions/:actionId/resolve', async (c) => {
  const parsed = AssistantActionResolveSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid assistant action result.', issues: parsed.error.issues }, 400);
  if (parsed.data.result.actionId !== c.req.param('actionId')) return c.json({ error: 'Action result does not match the route.' }, 409);
  if (parsed.data.workspaceId !== parsed.data.canvas.workspaceId || parsed.data.workspaceId !== parsed.data.result.workspaceId) {
    return c.json({ error: 'Action, canvas, and assistant workspace must match.' }, 409);
  }
  try {
    const binding = await workspaceBindingRegistry.resolve(parsed.data.workspaceId).catch(() => undefined);
    return await assistantGateway.resume({ ...parsed.data, workspaceRoot: binding?.sourceRoot ?? '' }, c.req.raw.signal);
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 502);
  }
});

// Node execution gateway. OpenHands runs against an isolated managed copy and
// the Gateway alone may apply an approved patch to the real project.
app.post('/api/node-runs', async (c) => {
  const parsed = AgentRunRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid node run request', issues: parsed.error.issues }, 400);
  }
  const { configuredDefault, allowed } = agentModelConfig();
  const agentModelId = parsed.data.agentModelId ?? configuredDefault;
  if (!agentModelId || !allowed.has(agentModelId)) {
    return c.json({ error: `Agent model is not allowed: ${agentModelId ?? 'none'}` }, 400);
  }
  try {
    await workspaceBindingRegistry.resolve(parsed.data.workspaceId);
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
  return c.json(agentRuns.create({ ...parsed.data, agentModelId }), 202);
});

app.get('/api/runs/:runId/events', async (c) => {
  const runId = c.req.param('runId');
  const run = agentRuns.get(runId) ?? await agentRuns.restore(runId);
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
  return c.json(cancelled);
});

app.post('/api/runs/:runId/apply', async (c) => {
  const runId = c.req.param('runId');
  const run = agentRuns.get(runId) ?? await agentRuns.restore(runId);
  if (!run) return c.json({ error: 'Run not found' }, 404);
  const parsedDecision = AgentReviewDecisionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsedDecision.success) {
    return c.json({ error: 'A valid review decision is required' }, 400);
  }
  const decision = parsedDecision.data;
  if (decision.changeSetId !== run.changeSet?.changeSetId) {
    return c.json({ error: 'Review decision is not bound to the active change set' }, 409);
  }
  if (decision.actionId !== `review-${decision.changeSetId}`) {
    return c.json({ error: 'Invalid review action' }, 400);
  }
  const event = await agentRuns.apply(runId);
  if (!event) return c.json({ error: 'Run is not ready to apply' }, 409);
  return c.json(event, event.type === 'patch_conflict' ? 409 : event.type === 'review_ready' ? 202 : 200);
});

app.post('/api/runs/:runId/reject', async (c) => {
  const runId = c.req.param('runId');
  const run = agentRuns.get(runId) ?? await agentRuns.restore(runId);
  if (!run) return c.json({ error: 'Run not found' }, 404);
  const parsedDecision = AgentReviewDecisionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsedDecision.success) {
    return c.json({ error: 'A valid review decision is required' }, 400);
  }
  const decision = parsedDecision.data;
  if (decision.changeSetId !== run.changeSet?.changeSetId) {
    return c.json({ error: 'Review decision is not bound to the active change set' }, 409);
  }
  if (decision.actionId !== `review-${decision.changeSetId}`) {
    return c.json({ error: 'Invalid review action' }, 400);
  }
  const event = await agentRuns.reject(runId);
  if (!event) return c.json({ error: 'Run is not ready to reject' }, 409);
  return c.json(event);
});

app.post('/api/runs/:runId/undo', async (c) => {
  const runId = c.req.param('runId');
  const run = agentRuns.get(runId) ?? await agentRuns.restore(runId);
  if (!run) return c.json({ error: 'Run not found' }, 404);
  const parsedDecision = AgentReviewDecisionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsedDecision.success) return c.json({ error: 'A valid undo decision is required' }, 400);
  const decision = parsedDecision.data;
  if (decision.changeSetId !== run.changeSet?.changeSetId) {
    return c.json({ error: 'Undo is not bound to the applied change set' }, 409);
  }
  if (decision.actionId !== `undo-${decision.changeSetId}`) {
    return c.json({ error: 'Invalid undo action' }, 400);
  }
  const event = await agentRuns.undo(runId);
  if (!event) return c.json({ error: 'Run is not available for undo' }, 409);
  return c.json(event, event.type === 'undo_conflict' ? 409 : 200);
});

const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port }, () => {
  console.log(`BFF ready at http://localhost:${port}`);
  console.log(`LLM proxy: http://localhost:${port}/api/llm`);
  console.log(`Workspace assistant: http://localhost:${port}/api/assistant/turns`);
  console.log(`Node runs: http://localhost:${port}/api/node-runs`);
  console.log(`Execution adapter: ${configuredAdapter.name}`);
});
