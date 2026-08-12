# MeshCLI LangGraph assistant

This service orchestrates the right-side MeshCLI assistant. It owns workspace-scoped conversation memory, Skill context, canvas tool selection, and interrupt/resume. It does not mutate browser canvas state directly and does not replace the OpenHands adapter used by node Agent Mode.

From the repository root:

```bash
npm run install:agent       # macOS/Linux
npm run install:agent:win   # Windows
npm run dev:agent           # macOS/Linux
npm run dev:agent:win       # Windows
```

The browser calls only the BFF on port 4000. The BFF validates Workspace Binding and proxies to the local LangGraph Agent Server on port 8133. Copy `.env.example` to `.env` and configure a model key.

The Phase 5B filesystem MCP uses `langchain-mcp-adapters` and the official `@modelcontextprotocol/server-filesystem` package. Its root is supplied only by the BFF from the bound Git repository. The allowlist exposes read/search/tree/metadata tools; repository write, move, and delete tools are filtered out.

Without a model API key, the graph boots in noop mode so service wiring can still be checked. A pending confirmation is not yet restart-safe; reissue it after a local Agent Server restart.
