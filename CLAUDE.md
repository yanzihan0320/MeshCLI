# CaudalFlow

Visual canvas for AI conversations — branch, explore in parallel, merge insights.

## Build & Run

```bash
# Frontend only (mock provider)
npm run dev            # Dev server at http://localhost:5173

# Full stack (frontend + BFF + LangGraph agent)
npm run dev:copilot    # Launches all three concurrently

# Individual services
npm run dev:ui         # Frontend only (alias for vite)
npm run dev:bff        # BFF server at http://localhost:4000
npm run dev:agent      # LangGraph agent at http://localhost:8133

# Quality
npm run build          # Type-check + production build (tsc -b && vite build)
npm run lint           # ESLint
npm test               # Vitest — run all unit tests
npm run test:watch     # Vitest in watch mode
```

### Agent Setup (first time)

```bash
npm run install:agent  # Creates .venv and installs Python deps
# Configure apps/agent/.env with API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY)
```

## Tech Stack

### Frontend
- React 19, TypeScript 5.9, Vite 8
- @xyflow/react 12 for the canvas (nodes, edges, selection, viewport)
- Zustand 5 for state (flowStore, chatStore, settingsStore, workspaceStore)
- CopilotKit v2 for agent sidebar integration
- Recharts 3 for generative UI charts
- Tailwind CSS 4 for styling
- Vitest for testing

### Backend
- Hono server (BFF) — CopilotKit Runtime endpoint + LLM proxy
- LangGraph Python agent with multi-LLM support (Anthropic, OpenAI, Gemini)

## Project Structure

```
src/                             # Frontend React app
├── components/
│   ├── canvas/                  # Canvas, CanvasControls, MergeSelectionPopup
│   ├── copilot/                 # Agent integration layer
│   │   ├── CanvasCopilotBridge  # Registers 12 frontend tools for the agent
│   │   ├── canvasAgentState     # Serializes canvas state for agent sync
│   │   ├── canvasHandlers       # Tool implementations (create/branch/merge/delete/update)
│   │   ├── BranchProposalCard   # Generative UI: branch suggestions
│   │   ├── ChartRenderer        # Generative UI: pie/bar/line charts
│   │   └── CopilotKitProviderShell  # CopilotKit provider config
│   ├── nodes/                   # ChatNode, ChatMessage, ChatInput, SelectionPopup
│   ├── edges/                   # TopicEdge (custom edge renderer)
│   └── ui/                      # SettingsPanel, HelpGuide, WorkspaceSelector, WelcomePopup
├── hooks/
│   ├── useChatNode              # Chat logic (used during branching/merging)
│   ├── useNodeCopilotChat       # Copilot-aware chat with agent context sync
│   ├── usePersistence           # localStorage auto-save
│   ├── useAutoScroll            # Scroll-to-bottom on new messages
│   └── useTextSelection         # Text selection for branching
├── stores/                      # flowStore, chatStore, settingsStore, workspaceStore
├── services/
│   ├── llm.ts                   # Streaming orchestrator
│   └── providers/               # LLM providers: mock, openai, anthropic
├── types/                       # chat.ts, flow.ts, workspace.ts
└── utils/                       # systemPrompts.ts, nodeLayout.ts, image.ts

apps/
├── agent/                       # LangGraph Python agent
│   ├── main.py                  # Entry point — loads env, selects runtime
│   ├── src/
│   │   ├── prompts.py           # System prompt with canvas state shape & tool docs
│   │   └── runtime.py           # Agent factory (Anthropic, OpenAI, Gemini)
│   └── tests/
├── bff/                         # Backend-for-Frontend
│   └── src/server.ts            # Hono: /api/copilotkit + /api/llm proxy
└── mcp/                         # MCP server (stub, not yet implemented)
```

## Architecture

### Client-Server Overview

```
Browser (React)  ──►  BFF (Hono :4000)  ──►  LangGraph Agent (:8133)
       │                    │
       │                    └──► LLM APIs (Anthropic/OpenAI — proxied)
       │
       └──► CopilotKit sidebar ◄──► Agent via BFF /api/copilotkit
```

- **Frontend** — React canvas + CopilotKit sidebar. Registers 12 frontend tools the agent can call.
- **BFF** — Hono server that hosts the CopilotKit Runtime (connects to LangGraph) and proxies LLM requests with server-side API keys.
- **Agent** — LangGraph Python agent that receives canvas state and can manipulate it through frontend tools.

### State Management — 4 Zustand stores

- **flowStore** — nodes, edges, graph mutations (addChatNode, removeNode, addEdge, toggleCollapseSmart)
- **chatStore** — messages per node, streaming state, activeNodeContext (tracks which node the user is chatting in)
- **settingsStore** — LLM config, UI preferences (persisted to localStorage; API keys now in BFF)
- **workspaceStore** — multi-workspace management

### Agent System (CopilotKit + LangGraph)

The agent operates the canvas through 12 frontend tools registered via `CanvasCopilotBridge`:
- **Canvas mutations:** createChatNode, createBranchFromNode, mergeChatNodes, deleteChatNode, updateChatNode, focusChatNode
- **Messages:** appendNodeMessage
- **Insights:** highlightWorkspaceFinding
- **Generative UI:** renderNodePreview, renderMergePlan, renderBranchProposal, renderChart

Canvas state is serialized and synced to the agent every 80ms (debounced) via `canvasAgentState.ts`. The agent's system prompt (`apps/agent/src/prompts.py`) documents the full state shape and all tool signatures.

The Python agent (`apps/agent/src/runtime.py`) auto-detects the configured LLM from `AGENT_RUNTIME` env var and supports Anthropic, OpenAI, and Gemini.

### LLM Provider System (Frontend)

Every provider implements `LLMProvider` interface (`services/providers/types.ts`):
- `id`, `name`, `streamChat(messages, config, callbacks, signal)`
- Registered in `services/providers/registry.ts`
- Providers use raw `fetch` with SSE streaming — no SDKs
- Real LLM requests are proxied through the BFF (API keys stored server-side in `apps/agent/.env`)

### Key Patterns

- Branching: select text in a conversation, creates child node with parent context
- Merging: Shift+drag to select 2+ nodes, creates merge node synthesizing all parent contexts
- System prompts built in `utils/systemPrompts.ts` (root, branch, merge)
- Node positioning calculated in `utils/nodeLayout.ts`
- Color tags and labels on nodes — palette picker with 8 colors and custom text
- All workspace data persisted to localStorage with debounced auto-save

## Code Style

- Functional components only, no class components
- Explicit TypeScript types for function params and return values
- `interface` over `type` for object shapes
- One component per file, named after the component
- Hooks in `hooks/`, stores in `stores/`, types in `types/`, utilities in `utils/`
- Tailwind classes using `surface-*`, `neutral-*`, `accent-*` color tokens
- Keep components under ~200 lines — split when they grow

## Testing

- Vitest with `globals: true`, `environment: 'node'`
- Test files in `__tests__/` directories next to the module: `<module>.test.ts`
- Reset Zustand store state in `beforeEach` to avoid test interference
- Focus on behavior (inputs/outputs), not implementation details
- All stores, utils, and services should have unit tests
- Bug fixes should include a regression test

## Adding a New LLM Provider (Frontend)

4 files, zero changes to branching/merging/streaming logic:

1. `src/services/providers/yourprovider.ts` — implement `LLMProvider`
2. `src/services/providers/registry.ts` — register it
3. `src/components/ui/SettingsPanel.tsx` — add config UI section
4. `src/stores/settingsStore.ts` — add default endpoint/model

Also add proxy config in `apps/bff/src/server.ts` if the provider needs server-side API keys.

## Adding a New Agent LLM Runtime

1. `apps/agent/src/runtime.py` — add detection logic in `_get_llm()` and a new runtime name
2. `apps/agent/.env` — add the new API key env var
3. `apps/bff/src/server.ts` — add proxy config if the frontend also needs direct access

## Git Conventions

- Branch naming: `feature/short-description`, `fix/issue-short-description`, `docs/what-changed`
- Concise commit messages focused on "why" not "what"
- PRs must pass: `npm run build`, `npm run lint`, `npm test`

## Releasing

Tag-based release flow — CI handles everything:

```bash
npm version patch   # or minor / major — bumps package.json + creates git tag
git push origin main --tags   # triggers release workflow → npm publish + GitHub Release
```

**First publish (manual, one-time):**

```bash
npm run build
npm login
npm publish --access public
```

**Then configure Trusted Publishing:** go to `https://www.npmjs.com/package/caudalflow/access` → Trusted Publishers → GitHub Actions → set org: `caudal-labs`, repo: `caudalflow`, workflow: `release.yml`.

All subsequent releases use OIDC — no tokens, no secrets. The release workflow runs lint + test + build before publishing with `--provenance` (links the package to the exact commit and Actions run).

### Agent (PyPI)

Agent has its own version in `apps/agent/pyproject.toml`. Tag with `agent-v*` to trigger PyPI publishing via OIDC trusted publishing.

## Environment Variables

### `apps/agent/.env` (required for real LLM usage)

```
ANTHROPIC_API_KEY=sk-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
AGENT_RUNTIME=gemini-flash-deep  # or: openai, anthropic, noop
AGENT_TEMPERATURE=0
```

### BFF (optional overrides)

- `PORT` — default 4000
- `FRONTEND_ORIGIN` — CORS origin, default `http://localhost:5173`
- `LANGGRAPH_DEPLOYMENT_URL` — default `http://localhost:8133`

### Frontend (optional)

- `VITE_COPILOT_CLOUD_PUBLIC_API_KEY` — CopilotKit Cloud API key (skips local BFF)
