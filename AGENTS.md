# MeshCLI Repository Operating Guide

This file governs AI agents and automation working in this repository. Its purpose is to keep future changes aligned with MeshCLI and prevent old product names, prototype debt, or unverified architecture assumptions from leaking back into the project.

## 1. Repository Scope

- The only target repository is the current `MeshCLI/` directory connected to `https://github.com/yanzihan0320/MeshCLI`.
- The parent directory's `references/` tree is read-only. You may inspect it and copy small, necessary ideas or implementations, but never edit files in place.
- `references/Generative-UI-Global-Hackathon-Starter-Kit/` is a starter application and cookbook, not the main project.
- `references/BranchCLI/` is an incomplete historical prototype. Use it only to recover validated snippets, prompts, or lessons learned; do not continue development inside it.
- Do not modify projects outside this repository, move or delete user files, or merge an entire historical project into MeshCLI.

## 2. Naming

- Use **MeshCLI** for the product, repository, and all public documentation.
- Use `CaudalFlow` only when describing the technical origin of the current graph canvas. It is no longer the product name.
- Use `BranchCLI` and `BranchOS` only in migration notes or historical records. Do not introduce them into new product copy, UI, package names, or APIs.
- Use `meshcli` as the lowercase identifier in new code.
- Changes to existing npm package names, CLI commands, and publishing coordinates require a compatibility review. Do not perform a superficial global replacement.

## 3. Source-of-Truth Order

When information conflicts, use this priority order:

1. Explicit instructions from the user in the current task.
2. Facts demonstrated by executable code, tests, and configuration in this repository.
3. Product boundaries and architecture decisions documented in `README.md`.
4. Product intent and development order from the project plan.
5. Historical code and documentation under `references/`.

The project plan describes direction; it does not prove that a feature is implemented. Public documentation must clearly distinguish **Available**, **Prototype**, and **Planned** capabilities.

## 4. Product and Architecture Principles

- MeshCLI is an executable graph-based Agent workspace, not a conventional chat app, mind map, or full IDE.
- The graph organizes context, branches, merges, runs, and results. It must not degrade into a decorative presentation layer.
- Keep UI, protocol, Gateway, Orchestrator, Agent Adapter, Execution Runtime, and Tools/Safety responsibilities separate.
- LangGraph is the initial orchestration implementation, and OpenHands is a candidate first execution adapter. Neither is an irreplaceable product core.
- MCP tools must pass through one permission layer. High-risk operations must be visible, confirmable, rejectable, and auditable.
- Prefer small, stable, versioned, testable internal contracts before adapting them to AG-UI or A2UI conventions.
- Prefer SSE and SQLite for the MVP. Introduce WebSockets, PostgreSQL, or heavier infrastructure only when concrete requirements justify them.

## 5. Before Every Change

- Run `git status --short` and preserve all existing user changes.
- Read the code, tests, and documentation directly relevant to the task. Do not infer current behavior from the project plan.
- Search for old names and affected call sites before changing identifiers or contracts.
- Before copying from `references/`, confirm that the material solves the current requirement and record its origin and necessary adaptations.
- Explain migration impact before changing an API, persisted data shape, CLI command, package name, or release workflow.

## 6. Implementation Rules

- Complete the smallest useful loop for the current MVP phase. Do not introduce large dependencies from a later phase prematurely.
- Define shared event and interactive UI schemas centrally and validate them at runtime. Do not duplicate near-identical contracts across layers.
- Bind every Agent run to an explicit workspace root. Never bypass path validation, command policy, or approval checks.
- Bind approval to a specific action, parameter set, and run. Never use a reusable global boolean approval flag.
- Implement cancellation, failure, and rejection paths, not only the successful path.
- New features must include empty, loading, and error states plus accessible text fallbacks where needed.
- Never place API keys, tokens, user paths, or real sensitive data in source code, logs, documentation, or test fixtures.
- Follow the existing TypeScript, React, Zustand, and test organization unless the task explicitly requires a structural change.
- Avoid unrelated refactoring.

## 7. Documentation Rules

- Use MeshCLI consistently in all public-facing text.
- Describe a capability as current only when it is verifiable in the repository. Put unfinished capabilities in a clearly marked roadmap or planned section.
- Architecture diagrams must describe responsibilities and data flow without implying that planned components are already deployed.
- Verify commands, paths, ports, environment variables, and repository links against the current code.
- Keep repository documentation in English unless the user explicitly requests another language.

## 8. Verification and Delivery

Choose checks in proportion to the change and run at least those directly relevant:

```bash
npm run build
npm run lint
npm test
```

- For documentation changes, validate links, code fences, commands, and stale product-name references.
- For behavior changes, run the relevant tests. Bug fixes should include a regression test when practical.
- Protocol and persistence changes must test compatibility, invalid inputs, and migration behavior.
- UI changes must cover primary interactions, error states, narrow layouts, and long content.
- At handoff, state what changed, what was verified, and which capabilities remain planned rather than implemented.

## 9. Git and Change Discipline

- Never overwrite, revert, or delete existing user changes.
- Do not use destructive Git commands.
- Keep each commit focused on one intent; do not mix features, broad refactors, and formatting.
- Do not commit, push, open a pull request, or publish a package unless the user explicitly requests it.
- Respect source licenses when incorporating reference code and avoid indiscriminate copying.

## 10. Current Priority Order

Unless the user specifies otherwise, proceed in this order:

1. Stabilize the existing graph workspace, branching, node-local chat, and merging.
2. Establish the shared protocol, Agent Gateway, and persistent mock event stream.
3. Integrate the first safe execution adapter.
4. Complete the interactive result renderer and approval loop.
5. Add MCP tools, audit records, checkpoints, and recovery.
