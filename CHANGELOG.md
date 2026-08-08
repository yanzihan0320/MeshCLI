# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A versioned, runtime-validated `A2UIBlock` protocol with controlled mind-map, comparison, checklist, confirmation, diff-review, task-board, process-timeline, and metric-card components
- Registry-based A2UI rendering in node conversations and agent runs, including safe fallback text for invalid blocks
- Inline explanation mind maps for five or more parallel chat points and controlled comparison-table rendering
- Agent plan-to-task-board mapping, execution timelines and metrics, and change-set review panels

### Changed

- Apply and reject requests are now bound to the exact run, change set, and review action and revalidated by the Gateway
- Change-set schemas now live in the shared protocol package for use by the frontend and Gateway
- Ordinary chat no longer generates To do / Doing / Done boards; those execution-oriented views are reserved for Agent Mode
- Model-service failures now expose the useful Gateway/upstream detail instead of a raw `API error 502` body
- Agent Mode now fills the node content area, accepts bounded text-file attachments, prioritizes visual run status, and preserves a Markdown final response in chat history
- Agent runs now snapshot uncommitted tracked and untracked files as their baseline, removing the commit-before-every-run requirement while still rejecting source changes made after a run starts
- Docker startup failures now provide concise recovery guidance instead of exposing a Python stack trace by default

## [2.0.0] - 2026-05-18

### Added

- CopilotKit AI copilot sidebar — an agent that operates the canvas, not just talks about it
- LangGraph Python agent (`apps/agent/`) with multi-LLM support (Anthropic, OpenAI, Gemini)
- BFF server (`apps/bff/`) — CopilotKit Runtime endpoint + LLM proxy with CORS support
- 12 frontend tools the agent can call: create/branch/merge/delete/update/focus nodes, append messages, highlight findings, render previews/proposals/plans/charts
- Generative UI components inline in copilot chat: branch proposals, merge plans, node previews, charts (pie/bar/line via Recharts)
- Real-time canvas-to-agent state synchronization (debounced 80 ms)
- `npm run dev:copilot` — single command to launch frontend + BFF + agent concurrently
- CI: Python test job (pytest, Python 3.11/3.12/3.13 matrix) in parallel with Node job
- Release: PyPI publishing for agent package via OIDC trusted publishing (`agent-v*` tags)
- Google Gemini LLM provider support in the agent
- Color tags and labels on chat nodes — palette picker with 8 colors and custom text labels (#16)
- Copy-to-clipboard button on chat messages (#15)

### Changed

- **Breaking:** LLM API keys are now configured via `apps/agent/.env` instead of the browser Settings panel — the BFF proxies all LLM requests
- **Breaking:** Real LLM usage requires the BFF (`npm run dev:bff` or `npm run dev:copilot`); browser-only mode is limited to the mock provider
- Architecture expanded from browser-only to client-server with BFF and agent
- CI job renamed from `build` to `node` for clarity

### Fixed

- Label badge fallback styling used Tailwind class names instead of CSS values, rendering no styles when no color was set
- Stale closure in palette click-outside handler caused trim to use outdated label value

## [1.0.1] - 2026-03-28

### Added

- Welcome popup for first-time users explaining mock mode and guiding them to configure an LLM provider in Settings

## [1.0.0] - 2026-03-28

### Added

- Infinite canvas for AI conversations with pan, zoom, and node resizing
- Branch from any selected text to explore tangents with full parent context
- Multi-node merge: Shift+drag to select 2+ nodes and synthesize insights
- Anthropic provider (Claude Sonnet, Opus, Haiku) with streaming responses
- OpenAI provider (GPT-4o, GPT-4o-mini, o1) with streaming responses
- Mock provider for development and demos
- Workspace management with localStorage persistence and JSON export/import
- Markdown rendering with syntax highlighting in chat messages
- Minimize, maximize, and collapse node states
- `npx caudalflow` CLI for running locally without cloning the repo
- GitHub Actions CI (lint + test + build on PRs, Node 20/22 matrix)
- GitHub Actions release workflow with npm Trusted Publishing (OIDC)

[2.0.0]: https://github.com/caudal-labs/caudalflow/compare/v1.0.1...v2.0.0
[1.0.1]: https://github.com/caudal-labs/caudalflow/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/caudal-labs/caudalflow/releases/tag/v1.0.0
