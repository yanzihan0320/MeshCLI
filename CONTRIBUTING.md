# Contributing to CaudalFlow

First off, thank you for considering contributing to CaudalFlow! Every contribution helps make this tool better for everyone exploring the frontiers of conversational AI.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Architecture Decisions](#architecture-decisions)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Style Guide](#style-guide)
- [Adding a New LLM Provider](#adding-a-new-llm-provider)

## Code of Conduct

This project follows a simple rule: **be kind and constructive**. We're building something exciting together. Treat every contributor with respect, assume good intentions, and focus on the work.

## How Can I Contribute?

### Reporting Bugs

- Open an issue with a clear title and description
- Include steps to reproduce, expected vs. actual behavior
- Add screenshots if it's a UI issue
- Mention your browser and OS

### Suggesting Features

- Open an issue tagged `enhancement`
- Describe the use case — *why* before *what*
- Bonus: sketch a rough UI or flow if it helps

### Code Contributions

- Bug fixes, new features, performance improvements — all welcome
- Check open issues for `good first issue` or `help wanted` labels
- For large changes, open an issue first to discuss the approach

## Development Setup

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9 (or pnpm/yarn)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/caudal-labs/caudalflow.git
cd caudalflow

# Install dependencies
npm install

# Start development server
npm run dev
```

The app runs at `http://localhost:5173` with hot module replacement.

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with HMR |
| `npm run build` | Type-check + production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm test` | Run all unit tests once |
| `npm run test:watch` | Run tests in watch mode |

### Testing with Mock Provider

By default, CaudalFlow uses the **Mock** provider — no API key needed. It simulates LLM streaming with pre-written responses, perfect for UI development and testing.

To test with a real provider, open Settings and switch to **OpenAI** or **Anthropic**, then configure your API key.

## Project Structure

```
src/
├── components/
│   ├── canvas/          # Flow canvas, controls, merge popup
│   ├── nodes/           # Chat node, messages, input, selection
│   ├── edges/           # Custom edge rendering
│   └── ui/              # Settings panel, help guide, workspace selector
├── hooks/               # Custom React hooks
├── stores/              # Zustand state stores
├── services/
│   ├── llm.ts           # Streaming orchestrator
│   └── providers/       # LLM provider implementations
├── types/               # TypeScript type definitions
└── utils/               # Layout calculations, system prompts
```

### Key Files

| File | What it does |
|------|-------------|
| `stores/flowStore.ts` | Manages the node/edge graph state |
| `stores/chatStore.ts` | Manages conversations per node |
| `hooks/useChatNode.ts` | Core hook for sending messages with context |
| `services/providers/` | Pluggable LLM provider implementations |
| `utils/systemPrompts.ts` | Builds context-aware system prompts |

## Architecture Decisions

### Why Zustand over Redux/Context?

Minimal boilerplate, excellent performance with selective subscriptions, and seamless persistence via middleware. Each concern gets its own small store.

### Why @xyflow/react?

Battle-tested graph visualization with built-in support for dragging, resizing, selection, minimap, and viewport controls. Saved us from reinventing complex canvas interactions.

### Why raw `fetch` instead of SDKs?

Zero additional dependencies, full control over streaming, and the ability to work with any OpenAI-compatible endpoint (local models, proxies, etc.).

### Why localStorage?

Immediate persistence with zero infrastructure. Users own their data. For a canvas-based exploration tool, the simplicity-to-value ratio is unbeatable.

## Testing

We use [Vitest](https://vitest.dev/) for unit testing. Tests live alongside the code in `__tests__/` directories.

### Running Tests

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode — re-runs on file changes
```

### What to Test

- **Utilities** (`utils/`) — pure functions like system prompt builders, layout calculations
- **Stores** (`stores/`) — Zustand store actions and state transitions
- **Services** (`services/`) — provider registry, provider behavior

### Writing Tests

- Place test files in a `__tests__/` directory next to the module being tested
- Name them `<module>.test.ts`
- Reset store state in `beforeEach` to avoid test interference
- Test behavior, not implementation — focus on inputs and outputs

### Test Expectations for PRs

- **Bug fixes** should include a test that reproduces the bug and verifies the fix
- **New utilities, store actions, or services** should include unit tests
- **UI components** don't require tests yet, but shouldn't break existing tests

All tests must pass before a PR can be merged.

## Submitting Changes

### Branch Naming

```
feature/short-description
fix/issue-number-short-description
docs/what-changed
```

### Commit Messages

Write clear, concise commit messages:

```
Add multi-node merge with context synthesis

- Enable Shift+drag marquee selection
- Create merge popup with quick actions
- Build system prompt from all parent conversations
```

### Pull Request Process

1. Fork the repo and create your branch from `main`
2. Make your changes with clear, focused commits
3. Ensure `npm run build` passes with no errors
4. Update documentation if you changed behavior
5. Open a PR with a clear description of **what** and **why**
6. Link related issues

### PR Checklist

- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] New logic includes unit tests (stores, utils, services)
- [ ] No unnecessary files committed
- [ ] New features include relevant documentation updates

## Style Guide

### TypeScript

- Use explicit types for function parameters and return values
- Prefer `interface` over `type` for object shapes
- Use the existing patterns — check similar files before adding new ones

### React

- Functional components only
- Hooks for shared logic (`use*.ts` in `hooks/`)
- Zustand stores for global state (`stores/`)
- Keep components focused — split when they exceed ~200 lines

### CSS / Tailwind

- Use the existing design tokens (colors, spacing)
- Follow the `surface-*`, `neutral-*`, `accent-*` color convention
- Match existing component styling patterns

### File Organization

- One component per file, named after the component
- Colocate related files (`ChatNode.tsx`, `ChatNodeHeader.tsx`, `ChatInput.tsx`)
- Types in `types/`, utilities in `utils/`, hooks in `hooks/`

## Adding a New LLM Provider

CaudalFlow has a pluggable provider system. Here's how to add one:

### 1. Create the provider file

```typescript
// src/services/providers/yourprovider.ts
import type { LLMProvider, StreamCallbacks } from './types';
import type { ChatMessage, LLMConfig } from '../../types/chat';

export const YourProvider: LLMProvider = {
  id: 'yourprovider',
  name: 'Your Provider',

  async streamChat(
    messages: ChatMessage[],
    config: LLMConfig,
    callbacks: StreamCallbacks,
    signal: AbortSignal
  ) {
    // Implement streaming here
    // Call callbacks.onToken(text) for each chunk
    // Call callbacks.onDone() when complete
    // Call callbacks.onError(error) on failure
  },
};
```

### 2. Register it

```typescript
// src/services/providers/registry.ts
import { YourProvider } from './yourprovider';
register(YourProvider);
```

### 3. Add settings UI

Add a conditional section in `src/components/ui/SettingsPanel.tsx` for your provider's configuration fields.

### 4. Add default config

Update `src/stores/settingsStore.ts` to include default endpoint/model values when switching to your provider.

That's it — four files, and your provider works with branching, merging, and all node types automatically.

---

Questions? Open an issue or start a discussion. We're happy to help you get started.
