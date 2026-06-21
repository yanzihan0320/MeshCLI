# CaudalFlow Copilot Agent

Local LangGraph agent used by the Vite app through the CopilotKit BFF.
This app lives under `apps/agent` to mirror the starter-kit architecture.

Run from the repository root:

```bash
npm run install:agent
npm run dev:copilot
```

This project uses a local Python virtual environment instead of `uv`.
`npm run install:agent` creates `apps/agent/.venv` and installs the package in editable mode.
`npm run dev:agent` prefers that venv, then falls back to the previous
`agent/.venv` if it still exists locally.

If you already installed `langgraph` globally or started the agent another way, you can use:

```bash
npm run dev:agent:global
```

Create `apps/agent/.env` with:

```bash
OPENAI_API_KEY=...
```

During the transition from the previous root-level layout, `agent/.env` is also
loaded as a fallback if it exists.

Without a model API key, the graph boots in a noop fallback mode so the frontend
and runtime wiring can still be verified.
