# MeshCLI

**Turn linear AI conversations into executable, graph-based agent workflows.**

MeshCLI is a visual Agent workspace built on the CaudalFlow canvas. It lets users branch useful parts of a conversation into independent nodes, continue each line of thought with local context, merge several nodes, and eventually run real agent tasks from the graph with visible progress and explicit approval for risky actions.

> MeshCLI is not just a chat UI or a mind map. Its product boundary is a graph-based workspace in which ideas can become traceable, reviewable, and executable work.

## Project status

MeshCLI is under active development. The repository contains a working CaudalFlow-derived conversation canvas, an early CopilotKit/LangGraph integration, and the first sandboxed execution adapter. Capabilities still marked planned below are architecture targets rather than implemented behavior.

| Capability | Status | Notes |
| --- | --- | --- |
| Infinite graph canvas | Available | Create, connect, move, collapse, and organize conversation nodes |
| Branch from selected text | Available | Creates a child node with inherited context |
| Multi-node merge | Available | Synthesizes several conversation paths into a new node |
| Node-local conversations | Available | Each node keeps its own messages and context |
| Multi-workspace persistence | Available | Browser persistence plus JSON/Markdown export |
| Canvas copilot | Prototype | CopilotKit + LangGraph can inspect and operate canvas state |
| Agent Gateway and normalized events | Available | Versioned node-run contract, OpenHands adapter, cancellation, and replayable SSE stream |
| AG-UI-compatible run viewer | Available | Chat/Agent modes, command and file events, Changed Files, unified diff, Apply All, and Reject All |
| Executable agent adapter | Available | OpenHands SDK + DockerWorkspace; the adapter contract remains vendor-neutral |
| A2UI-style interactive blocks | Planned | Checklist, confirmation, diff review, form, task board, comparison |
| MCP tools and permission manager | Planned | Filesystem, GitHub, and browser/search integrations first |
| Audit log, checkpoints, rollback | Planned | Required before broad autonomous execution |

## The problem

Linear chats are good at answering one question at a time, but poor at preserving parallel reasoning. Exploring a tangent buries the original thread; comparing alternatives requires manual copying; and turning a conclusion into real work usually means leaving the conversation and losing its context.

MeshCLI treats a conversation as a graph:

1. Ask a question in the main conversation.
2. Select a useful passage and branch it into a node.
3. Continue the discussion inside that node with inherited and local context.
4. Run an agent from the node when the idea is ready to become work.
5. Review streamed activity, commands, proposed file changes, and permission requests.
6. Merge related nodes into a decision, implementation plan, or task board.

The graph is not decoration. It is the durable structure for context, decisions, execution, and results.

## Product scope

### MVP includes

- A CaudalFlow-based graph canvas and a right-side primary conversation
- Branching from selected AI output
- Node-local follow-up conversations and explicit context inheritance
- Multi-node merge with summaries and next actions
- Running an agent from a node against a selected workspace
- Streaming run events to the node UI
- Interactive checklist, confirmation, diff, form, task-board, and comparison blocks
- Filesystem, GitHub, and browser/search tools through MCP-compatible connectors
- Workspace sandboxing, scoped file access, permission prompts, audit records, and cancellation
- An adapter boundary so MeshCLI is not coupled to one model or agent runtime

### Explicitly out of scope for the MVP

- A full IDE replacement
- Real-time multiplayer collaboration
- A complex 3D canvas or social network
- Unattended control of the user's computer
- Running destructive or high-risk actions without explicit approval
- Making Codex, Claude Code, OpenHands, or any other single runtime the permanent core

## Experience model

### Branch

Selecting text in a response creates a connected child node. The child receives a deliberate context package: the selected source text, a parent summary, relevant messages, and its own future local messages. Context inheritance should be explicit and inspectable rather than an accidental dump of every upstream token.

### Explore

Every node is a focused conversation and potential unit of work. A user can ask follow-up questions, attach a workspace, inspect the context used by the agent, and start or cancel a run.

### Execute

An execution run produces normalized events such as:

```text
run_started -> text_delta/tool_started -> command_output/file_change
            -> permission_required -> approved|rejected
            -> run_finished|run_failed|run_cancelled
```

Plain text appears as chat, command output as a collapsible log, file changes as diffs, approval requests as confirmation panels, and completion as a summary card.

### Merge

Merging nodes collects their selected source text, summaries, local messages, and run results. The new node should produce a synthesis, decision summary, unresolved conflicts, and next actions. When useful, it may render those actions as an interactive task board.

## Target architecture

```text
MeshCLI Graph UI (CaudalFlow foundation)
        |
        +-- A2UI-style block renderer
        +-- AG-UI-compatible event viewer
        |
Agent Gateway
        |
Workflow Orchestrator (LangGraph initially)
        |
Agent Adapter Layer
        |
Execution Runtime (OpenHands adapter first, replaceable)
        |
MCP Tools / Skills / Workspace Sandbox
```

### Responsibility boundaries

| Layer | Owns | Does not own |
| --- | --- | --- |
| Graph UI | Nodes, edges, conversations, run presentation, user decisions | Direct filesystem or shell execution |
| UI protocols | Event display and interactive result schemas | Agent planning or tool implementation |
| Agent Gateway | API entry, context assembly, run lifecycle, event normalization | Vendor-specific execution logic |
| Orchestrator | Branch/merge/run/approval workflows, persistence, retry and resume | Direct low-level file edits or shell commands |
| Agent adapters | One stable interface over different agent runtimes | Product-specific graph rendering |
| Execution runtime | Reading, editing, commands, tests, observations | Canvas state and product navigation |
| Tool and safety layer | MCP connections, sandbox, policy, approvals, audit | User-facing reasoning structure |

### Deliberate architecture decisions

- **SSE first:** the MVP should prefer Server-Sent Events for one-way run streaming. WebSockets can be added only when bidirectional runtime traffic is genuinely needed.
- **SQLite first:** local development and the MVP should use a simple persistent store. PostgreSQL is a deployment option, not an early requirement.
- **Protocols are internal contracts first:** `AgentEvent` and `A2UIBlock` should be small, versioned MeshCLI schemas that can map to AG-UI/A2UI conventions without blocking development on full protocol coverage.
- **OpenHands is an adapter, not the product core:** it is a practical first execution engine, but all runtimes implement the same capability-based adapter contract.
- **Permission checks are server-side:** UI confirmation is part of the experience, but enforcement must occur at the gateway/tool boundary.

## Core contracts

The adapter boundary is intentionally small:

```ts
interface AgentAdapter {
  name: string;
  capabilities: AgentCapability[];
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
}
```

The first interactive block set is also intentionally constrained:

```ts
type A2UIBlock =
  | { type: "checklist"; title: string; items: ChecklistItem[] }
  | { type: "diff_review"; files: DiffFile[] }
  | { type: "confirmation"; title: string; description: string; actions: Action[] }
  | { type: "form"; title: string; fields: FormField[] }
  | { type: "task_board"; columns: TaskColumn[] }
  | { type: "comparison_table"; columns: string[]; rows: string[][] };
```

The run and event contracts live in `packages/protocol`; future A2UI contracts should join them so the UI, gateway, adapters, and tests do not invent incompatible shapes.

## Safety model

Safety is a core subsystem, not a final polish step.

- Every run is bound to an explicit workspace root.
- File access is denied outside allowed paths.
- Commands are evaluated against policy before execution.
- Reads may be allowed by policy; writes, deletes, shell commands, pushes, external side effects, and sensitive-path access require risk-aware handling.
- Proposed file changes are shown as diffs before protected writes.
- Approval and rejection are recorded against the exact pending action.
- Runs can be cancelled; long-running workflows must support pause/resume.
- Executed actions produce an audit trail. Checkpoint and rollback support follows before broader autonomy.

The UI must never imply that a click alone is the security boundary. The backend must revalidate the workspace, action, parameters, and approval token.

## MVP delivery plan

### Phase 1 — Graph workspace baseline

Keep the working canvas, formalize node data, retain branch and merge, add the main conversation and node-local conversations, and expose a disabled/previewable **Run Agent** action.

**Done when:** selected text can create a node, a node can continue its own conversation, and multiple nodes can merge predictably.

### Phase 2 — Gateway and run events

**Status: complete for the mock-execution milestone.**

Define versioned run/event schemas, create the Agent Gateway, stream events with SSE, persist events to the correct node, and render a basic run log.

**Done when:** a mock run visibly produces `run_started`, incremental output, and `run_finished` events that survive reload.

### Phase 3 — First execution adapter

**Status: complete for the OpenHands DockerWorkspace MVP.**

The OpenHands adapter maps messages, plans, commands, observations, and file changes into MeshCLI events. Every run clones a clean Git project into a managed copy, mounts only that copy into Docker, creates a binary-safe patch, and waits for Apply All or Reject All before the Gateway can touch the real project.

**Done when:** a node can analyze a real repository and propose a change without silently applying protected operations.

### Phase 4 — Interactive result renderer

**Status: partial. Changed Files and whole-change-set review are available.**

Implement confirmation, diff review, checklist, form, task board, and comparison blocks with schema validation and accessible fallback text.

**Done when:** protected actions can pause for confirmation and merge results can render as a task board.

### Phase 5 — MCP tools and hardening

Add filesystem, GitHub, and browser/search connectors behind the same permission manager; then add audit, cancellation, checkpoints, and failure recovery.

**Done when:** external tool calls are inspectable, policy-controlled, and confirmable or rejectable.

## Demo scenario

1. The user asks: “Analyze how this repository should be refactored.”
2. They branch “refactor frontend state management” into one node.
3. Inside that node they request a concrete, repository-aware plan.
4. MeshCLI streams file reads and analysis events from the execution adapter.
5. A proposed command or edit pauses and displays a confirmation panel and diff.
6. The user creates another node for “improve the Agent Gateway.”
7. They merge both nodes into “final refactoring plan.”
8. MeshCLI renders the synthesis as a task board with decisions, dependencies, and next actions.

## Current repository layout

```text
src/                  React graph workspace
  components/         Canvas, nodes, copilot bridge, and UI
  hooks/              Chat, persistence, selection, and interaction hooks
  stores/             Flow, chat, settings, and workspace state
  services/           LLM streaming and provider adapters
  types/              Frontend domain types
  utils/              Prompts, layout, and helpers
apps/
  agent/              Current Python LangGraph agent prototype
  bff/                Current Hono backend-for-frontend
  mcp/                Reserved MCP integration area
packages/
  protocol/           Shared, runtime-validated run and event contracts
bin/                  CLI entry point
```

The repository will likely evolve toward `apps/web`, `apps/gateway`, and `packages/protocol`; that reorganization should happen only when the shared runtime contracts exist, not as a cosmetic move.

## Local development

### Requirements

- Node.js 20.12 or newer
- npm
- Python for the optional LangGraph agent

```bash
git clone https://github.com/yanzihan0320/MeshCLI.git
cd MeshCLI
npm install
```

Frontend only:

```bash
npm run dev
```

Full current prototype stack on macOS/Linux:

```bash
npm run install:agent
npm run dev:copilot
```

On Windows, install the agent with `npm run install:agent:win`, then start `dev:ui`, `dev:bff`, and `dev:agent:win` in three terminals. The current `dev:copilot` script invokes the POSIX agent command.

Individual services:

```bash
npm run dev:ui
npm run dev:bff
npm run dev:agent           # macOS/Linux
npm run dev:agent:win       # Windows
```

Quality checks:

```bash
npm run build
npm run lint
npm test
```

Copy `apps/agent/.env.example` to `apps/agent/.env` and configure real model credentials there. For OpenAI-compatible providers, set `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `OPENAI_MODEL`; the local BFF keeps these values out of the browser. Never commit API keys or place secrets in documentation, browser storage, or test fixtures.

## Contributing

Read [AGENTS.md](./AGENTS.md) before making changes and [CONTRIBUTING.md](./CONTRIBUTING.md) for the existing contribution workflow. In particular:

- Preserve the distinction between implemented and planned capabilities.
- Keep the graph, protocol, orchestration, execution, and permission boundaries explicit.
- Add regression tests for behavior changes.
- Treat `../references/` as read-only source material, not as code to edit in place.

## License

[MIT](./LICENSE)
