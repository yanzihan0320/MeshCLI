"""LangGraph entry point for the CaudalFlow Copilot agent."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

from src.prompts import SYSTEM_PROMPT
from src.runtime import build_graph


AGENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = AGENT_DIR.parent.parent
LEGACY_AGENT_ENV = REPO_ROOT / "agent" / ".env"

load_dotenv(AGENT_DIR / ".env")
if LEGACY_AGENT_ENV.exists():
    load_dotenv(LEGACY_AGENT_ENV, override=False)

runtime = os.getenv("AGENT_RUNTIME", "gemini-flash-deep")
if not (
    os.getenv("GEMINI_API_KEY")
    or os.getenv("GOOGLE_API_KEY")
    or os.getenv("OPENAI_API_KEY")
    or os.getenv("ANTHROPIC_API_KEY")
):
    runtime = "noop"
    print(
        "\n[runtime] model API key missing — using noop fallback graph.\n"
        "Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY in apps/agent/.env to enable the CaudalFlow agent.\n",
        flush=True,
    )

graph = build_graph(
    runtime,
    tools=[],
    system_prompt=SYSTEM_PROMPT,
)


if __name__ == "__main__":
    import subprocess

    raise SystemExit(
        subprocess.call(
            ["langgraph", "dev", "--port", "8133"],
            cwd=os.path.dirname(__file__),
            env=os.environ.copy(),
        )
    )
