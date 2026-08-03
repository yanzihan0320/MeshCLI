# MeshCLI BFF

This app keeps model credentials out of the browser and proxies streaming LLM
requests from the Vite frontend. OpenAI-compatible providers are configured
with the same server-side variables:

```bash
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_API_KEY=replace-with-your-key
OPENAI_MODEL=deepseek-chat
```

Copy `apps/agent/.env.example` to `apps/agent/.env`, update the values, and never
commit that file. The BFF exposes only the configured provider name, model, and
endpoint host; it never returns the API key to the browser.

Run it from the repository root:

```bash
npm run dev:bff
```

The frontend proxies `/api/llm` to this service during local development.

- `POST /api/llm` streams a model response.
- `POST /api/agent` streams canvas-aware assistant events with the selected provider.
- `POST /api/node-runs` creates a node-bound execution run (mock adapter in Phase 2).
- `GET /api/runs/:runId/events` replays and streams normalized run events over SSE.
- `POST /api/runs/:runId/cancel` cancels an active run.
- `GET /api/llm/config` returns non-secret configuration status.
- `POST /api/llm/test` verifies the configured provider.
- `GET /api/llm/models` proxies an OpenAI-compatible model list.
