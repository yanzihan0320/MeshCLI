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
npm run install:openhands
npm run dev:bff
```

Docker Desktop must be running for the default `AGENT_WORKSPACE_MODE=docker`.
`AGENT_WORKSPACE_ROOT` must point to a Git working tree. The Gateway snapshots
tracked and untracked user changes into the isolated run baseline, so a commit is
not required before every run. The Gateway clones
that repository per run; the real directory is never mounted into the Agent
container.

The frontend proxies `/api/llm` to this service during local development.

- `POST /api/llm` streams a model response.
- `POST /api/assistant/turns` validates the Workspace/Canvas snapshot and proxies a LangGraph turn over SSE.
- `POST /api/assistant/actions/:actionId/resolve` resumes an interrupted canvas action with the real frontend result.
- `GET /api/assistant/skills?workspaceId=...` lists the merged Skill catalog without exposing local paths.
- `GET /api/assistant/mcp/status` reports the server-side MCP registry without commands, roots, or secrets.
- `GET /api/capabilities/skills?workspaceId=...` returns the sanitized Skill catalog and actual usage history.
- `PATCH /api/capabilities/skills/:name` enables or disables the effective Skill for a Workspace.
- `POST /api/capabilities/skills/validate` validates an uploaded `SKILL.md` without installing it.
- `POST /api/capabilities/skills/install` installs a bounded, script-free UI bundle into user or Workspace scope.
- `DELETE /api/capabilities/skills/:name?workspaceId=...` removes a non-built-in Skill.
- `GET /api/capabilities/mcp?workspaceId=...` returns sanitized multi-server status and allowlisted tool names.
- `PATCH /api/capabilities/mcp/:id` enables or disables an existing trusted CLI registration.
- `POST /api/capabilities/mcp/:id/test` probes an existing registration without accepting a browser command or root.
- `POST /api/agent` is retired and returns `410 Gone`.
- `POST /api/node-runs` creates a node-bound LangGraph-supervised OpenHands execution run.
- `GET /api/runs/:runId/events` replays and streams normalized run events over SSE.
- `POST /api/runs/:runId/cancel` cancels an active run.
- `POST /api/runs/:runId/apply` validates and applies the run's patch.
- `POST /api/runs/:runId/reject` discards the managed copy without changing the real project.
- `GET /api/llm/config` returns non-secret configuration status.
- `POST /api/llm/test` verifies the configured provider.
- `GET /api/llm/models` proxies an OpenAI-compatible model list.

Run the isolated Docker end-to-end check with:

```bash
npm run smoke:openhands
```
