# MeshCLI OpenHands Runtime

This package isolates the Python OpenHands SDK dependency from the existing
LangGraph canvas assistant. The Agent Gateway launches this runtime and
translates its JSON Lines output into MeshCLI `AgentEvent` records.

Install the locked environment from the repository root:

```powershell
uv sync --project apps/openhands --python 3.12
```

The runtime reads the existing `apps/agent/.env` configuration. Secrets stay in
the local environment and are never written to events or logs.
