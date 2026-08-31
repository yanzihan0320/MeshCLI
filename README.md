# MeshCLI

**Branch conversations. Connect ideas. Turn decisions into agent tasks.**

MeshCLI is a local-first AI workspace on an infinite canvas. Explore a question in parallel, branch a useful response into a new conversation, merge different directions, and run repository-aware agents without losing the context behind the work.

[Features](#features) · [Quick start](#quick-start) · [Usage](#usage) · [Skills and MCP](#skills-and-mcp) · [Deployment](#deployment) · [Contributing](#contributing)

> **Early access:** MeshCLI currently targets local, single-user use. The full backend is not ready to be exposed to anonymous internet users. See [Deployment](#deployment) before hosting it for others.

## Features

- **Conversation canvas** — create, connect, move, collapse, and organize nodes; branch from selected text and merge related conversations.
- **Workspace assistant** — a LangGraph-powered assistant that reads canvas context and performs native canvas actions with real execution receipts, revision checks, confirmation for deletion, and transaction Undo.
- **Node Agent Mode** — LangGraph supervises the task; OpenHands executes code in an isolated Docker workspace. Inspect progress, cancel a run, and review file changes before applying them.
- **Reviewable changes** — unified diffs, Apply/Reject, conflict detection, and conditional Undo for applied repository changes.
- **Skills and MCP** — discover reusable Skills and connect allowlisted, read-only external tools through a shared capability registry.
- **Structured results** — controlled comparison tables, mind maps, task boards, timelines, metrics, and confirmation panels.
- **Local workspaces** — multiple workspaces, browser-persisted conversations, JSON import/export, Markdown export, light/dark themes, and English/Chinese UI.

## Quick start

### Requirements

| Requirement | Used for |
| --- | --- |
| Node.js 22.12+ and npm | Frontend, BFF, and CLI |
| Git | Installation and repository-backed Agent runs |
| Python 3.12 recommended | LangGraph assistant; the assistant alone supports Python 3.11+ |
| uv and a running Docker daemon | Optional: OpenHands code execution |

Python 3.12 is required by the current OpenHands runtime. Model providers may charge for API usage.

### 1. Get the source

```bash
git clone https://github.com/yanzihan0320/MeshCLI.git
cd MeshCLI
npm ci
```

### 2. Try the canvas without an API key

```bash
npm run dev
```

Open `http://localhost:5173`. The default Mock provider lets you explore the canvas and node conversations without a backend. Real model calls, the workspace assistant, MCP, and Agent execution require the services below.

### 3. Enable model calls and the workspace assistant

Copy the configuration template.

macOS / Linux:

```bash
cp apps/agent/.env.example apps/agent/.env
```

Windows PowerShell:

```powershell
Copy-Item apps/agent/.env.example apps/agent/.env
```

Edit `apps/agent/.env` and configure an OpenAI-compatible provider:

```dotenv
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=your-model-id
```

Use a model that supports tool calling for the assistant. The [configuration template](apps/agent/.env.example) also documents the optional providers and runtime settings. Keep real credentials in the local `.env` file, never in source code or browser-side environment variables.

Install the assistant and start the stack:

```bash
npm run install:agent
npm run dev:copilot
```

These scripts work on Windows, macOS, and Linux. Stop the frontend-only process first if it is already using port 5173.

| Service | Default address |
| --- | --- |
| Frontend | `http://localhost:5173` |
| BFF | `http://localhost:4000` |
| LangGraph Agent Server | `http://127.0.0.1:8133` |

In Settings, choose your configured provider and model. The browser sends requests through the BFF; server model credentials are not returned to the browser.

### 4. Enable code execution (optional)

Install uv, start Docker, and install the isolated OpenHands runtime:

```bash
npm run install:openhands
```

The template selects `AGENT_ADAPTER=openhands` and `AGENT_WORKSPACE_MODE=docker`. In MeshCLI, bind a workspace to a Git repository, then switch a node from Chat to Agent mode.

The repository must exist on the machine running the BFF. The native folder picker is currently Windows-only; other systems use the manual path fallback. A web browser does not upload its local repository through this control.

## Usage

1. **Start a conversation.** Ask a question in a canvas node.
2. **Branch an idea.** Select a useful passage in a response and create a child node with its own context.
3. **Explore alternatives.** Continue several conversations independently, then select related nodes to merge.
4. **Ask the workspace assistant.** For example: “Create three frontend refactoring directions, one node per direction.” Check the activity records for actual canvas actions.
5. **Use repository evidence.** Bind a repository and ask: “Use the read-only filesystem MCP to read README.md and organize three findings on the canvas.”
6. **Run an Agent.** Give a node a coding task, follow its events and response, then review the proposed diff before Apply.

Canvas Undo reverses assistant canvas transactions. Code Undo reverses an applied repository change only while the recorded repository state still matches. They are separate histories; a read-only run has no code change to undo.

## Skills and MCP

### Skills

Skills use a `SKILL.md` file containing a name, description, and instructions. Discovery priority is:

```text
bound-repository/.meshcli/skills/
    > ~/.meshcli/skills/
    > built-in Skills
```

Settings shows the discovered Skills, their sources, validation errors, enabled state, and recorded usage. Select a Skill explicitly with `$skill-name`, or let the agent activate it from its description. Full content is loaded only after activation.

Manage Skills from a source checkout:

```bash
node bin/cli.js skill validate ./my-skill
node bin/cli.js skill add ./my-skill --scope workspace --workspace .
node bin/cli.js skill list
```

The current loader reads instructions, references, and assets. It does not execute Skill scripts, and rejects symlinks and directory traversal.

### MCP

MeshCLI acts as an MCP host: register focused servers rather than building a universal proxy server. The current runtime exposes only enabled, read-only registrations with an explicit tool allowlist.

```bash
node bin/cli.js mcp list
node bin/cli.js mcp test workspace-filesystem --workspace-root .
```

To register your own read-only HTTP server, replace the example URL and tool names:

```bash
node bin/cli.js mcp add docs --transport streamable-http --url https://example.com/mcp --read-only --allow-tools search_docs,read_doc
```

The built-in filesystem MCP gets its root from the validated workspace binding. Settings shows sanitized status and available tools; server commands and credentials stay server-side. Only install servers you trust: a read-only tool allowlist does not make an arbitrary server process safe.

## Configuration

All local service settings are documented in [apps/agent/.env.example](apps/agent/.env.example).

| Group | Main settings |
| --- | --- |
| Models | `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`; optional Anthropic and Gemini configuration |
| Services | `FRONTEND_ORIGIN`, `PORT`, `LANGGRAPH_URL` |
| Agent execution | `AGENT_ADAPTER`, `AGENT_WORKSPACE_MODE`, `AGENT_ALLOWED_MODELS`, iteration/retry limits |
| Storage | `AGENT_RUNS_DIR`, run retention, count, and size limits |
| Capabilities | `MESHCLI_CAPABILITIES_PATH`, built-in filesystem MCP settings |
| Tracing | `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` |

LangSmith tracing is optional and disabled in the template. If enabled, prompts, tool inputs, canvas context, and repository-derived content may be sent to LangSmith.

The assistant uses port 8133 by default. To override the launch port, set `LANGGRAPH_PORT` in the launching shell; `LANGGRAPH_URL` must point to the same port.

## Architecture

```text
React canvas and conversations
             |
             v
       Hono BFF / Gateway
          /         \
         v           v
Canvas assistant   Node supervisor
      LangGraph + shared Skills / read-only MCP
         |           |
CanvasCommand     OpenHands / Docker
         |           |
Frontend checks   Proposed repository diff
and applies       -> review -> Apply / Undo
```

Canvas actions are native commands executed by the frontend, not MCP filesystem writes. LangGraph coordinates the assistant and node supervisor; Skills supply instructions; MCP supplies external tools; OpenHands handles isolated code execution.

```text
src/                 React canvas, conversations, state, and UI
apps/bff/            API proxy, workspace bindings, and Agent Gateway
apps/agent/          LangGraph graphs, Skills, and MCP integration
apps/openhands/      Isolated code-execution runtime
packages/protocol/   Runtime-validated shared event and action schemas
bin/                 Frontend launcher and capability CLI
scripts/             Local installation and startup helpers
```

## Data and privacy

- Canvas nodes, edges, node conversations, workspace metadata, and assistant history are stored in browser-local storage. They are not account-synced.
- JSON workspace export includes canvas data and node conversations. It is not a full backup of assistant history, server bindings, credentials, or execution artifacts.
- Repository bindings, capability configuration, run artifacts, and LangGraph development state live on the machine running the services.
- Changing the site origin or clearing browser storage can make previous local workspaces unavailable. Export important canvas work before moving between installations.
- Local-first does not mean offline: model calls and enabled remote MCP servers receive the context needed for their requests. Optional tracing adds another external destination.

## Deployment

**Source checkout and local use are the supported starting point.** For a public website, distinguish a canvas demo from a full Agent service:

- **Canvas-only demo:** build with `npm run build` and serve `dist/` as a static site. Use the Mock provider; live assistant and Agent features need a backend.
- **Full hosted service:** requires a separately deployed BFF, LangGraph service, Docker-capable execution workers, and durable storage. The frontend must route `/api/*` to the BFF.

Do not expose the current full backend directly to the public internet. It does not yet provide user authentication, per-user resource ownership, tenant isolation, or usage quotas; repository binding and capability-management routes assume a trusted local user. CORS is not authentication.

The checked-in `vercel.json` does not provision a complete production Agent stack. The local `langgraph dev` launcher is for development, and `npm run preview` only previews the frontend build. See the official [LangGraph local server guide](https://docs.langchain.com/oss/python/langgraph/local-server) and [Vite static deployment guide](https://vite.dev/guide/static-deploy).

The current CLI launcher serves the built frontend and provides capability commands; it does not install or start the full backend stack. Use the source-checkout instructions above for all features.

## Development

```bash
npm run dev:ui           # Frontend
npm run dev:bff          # BFF (separate terminal)
npm run dev:agent        # LangGraph (separate terminal)

npm run lint
npm test
npm run build
```

Python tests, after installing the corresponding runtimes:

```bash
# From apps/agent, with its .venv activated:
python -m pytest

# From the repository root:
npm run test:openhands
```

## Contributing

Bug reports, documentation improvements, tests, and pull requests are welcome. Please include reproduction steps, your OS/browser, and relevant errors with secrets removed. Discuss large changes in an issue before implementing them.

Preserve existing canvas interactions, add regression tests for behavior changes, and run the relevant checks before submitting. Contributors using coding agents should also read [AGENTS.md](AGENTS.md).

## Acknowledgements

The canvas foundation originates from **CaudalFlow** by **Caudal Labs**. MeshCLI builds on that interaction model with agent orchestration, repository execution, Skills, and MCP. The original copyright notice is retained.

## License

[MIT](LICENSE).
