# MeshCLI LangGraph assistant

This service exposes two graphs: the workspace canvas assistant and the node Agent supervisor. It owns workspace-scoped conversation memory, Skill context, read-only MCP tool selection, canvas tool selection, and interrupt/resume. It does not mutate browser canvas or repository state directly. In node Agent Mode it prepares the execution brief; OpenHands remains the isolated code worker behind the BFF Gateway.

From the repository root:

```bash
npm run install:agent       # macOS/Linux
npm run install:agent:win   # Windows
npm run dev:agent           # macOS/Linux
npm run dev:agent:win       # Windows
```

The browser calls only the BFF on port 4000. The BFF validates Workspace Binding and proxies to the local LangGraph Agent Server on port 8133. Copy `.env.example` to `.env` and configure a model key.

The Phase 5B MCP host uses `langchain-mcp-adapters`. The built-in official filesystem server receives its root only from the BFF-bound Git repository. Additional CLI registrations are loaded from the local capability registry, but an Agent sees them only when they are enabled, marked read-only, and have an explicit tool allowlist. Repository write, move, and delete tools remain filtered out.

Without a model API key, the graph boots in noop mode so service wiring can still be checked. A pending confirmation is not yet restart-safe; reissue it after a local Agent Server restart.
