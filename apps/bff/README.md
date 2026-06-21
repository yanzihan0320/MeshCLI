# CaudalFlow CopilotKit BFF

This app hosts the CopilotKit Runtime endpoint used by the Vite frontend.

Run it from the repository root:

```bash
npm run dev:bff
```

The frontend proxies `/api/copilotkit` to this service during local development.
The BFF talks to the LangGraph agent at `LANGGRAPH_DEPLOYMENT_URL`, defaulting to
`http://localhost:8133`.
