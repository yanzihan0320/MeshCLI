"""Runtime factory for the MeshCLI workspace assistant graph."""

from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any

from langgraph.graph.message import add_messages
from typing_extensions import Annotated, TypedDict


class AssistantState(TypedDict, total=False):
    messages: Annotated[list, add_messages]
    workspace_id: str
    workspace_root: str
    canvas: dict[str, Any]
    activated_skills: list[dict[str, Any]]
    prepared_context: str
    execution_request: dict[str, Any]
    mcp_catalog: list[dict[str, Any]]


NOOP_FALLBACK_MESSAGE = (
    "Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY in apps/agent/.env "
    "to enable the MeshCLI workspace assistant."
)

_MODEL_INVOKE_LOCK = threading.Lock()
_last_model_invoke_at = 0.0


def _model_min_interval_seconds() -> float:
    explicit = os.getenv("LANGGRAPH_MODEL_MIN_INTERVAL_SECONDS")
    if explicit is not None and explicit.strip():
        return max(0.0, float(explicit))
    # Provider limits vary by account tier. Do not impose the old development-
    # account pacing on upgraded accounts; operators can opt into a positive
    # interval through LANGGRAPH_MODEL_MIN_INTERVAL_SECONDS when needed.
    return 0.0


def _invoke_with_retries(model: Any, messages: list[Any]) -> Any:
    for attempt in range(4):
        try:
            return model.invoke(messages)
        except Exception as error:
            detail = str(error)
            if "429" not in detail and "rate_limit" not in detail.lower():
                raise
            if attempt == 3:
                raise
            match = re.search(r"after\s+(\d+(?:\.\d+)?)\s+seconds?", detail, re.IGNORECASE)
            delay = float(match.group(1)) if match else min(8.0, 2.0 ** attempt)
            time.sleep(max(1.0, delay) + 0.25)


def _invoke_with_rate_limit(model: Any, messages: list[Any]) -> Any:
    global _last_model_invoke_at
    interval = _model_min_interval_seconds()
    if interval <= 0:
        # With pacing disabled, allow the provider account's configured
        # concurrency instead of serializing every LangGraph run globally.
        return _invoke_with_retries(model, messages)
    with _MODEL_INVOKE_LOCK:
        remaining = interval - (time.monotonic() - _last_model_invoke_at)
        if remaining > 0:
            time.sleep(remaining)
        response = _invoke_with_retries(model, messages)
        _last_model_invoke_at = time.monotonic()
        return response


def _get_llm():
    if os.getenv("OPENAI_API_KEY"):
        from langchain_openai import ChatOpenAI
        # Some OpenAI-compatible models (for example Kimi K3) reject any
        # temperature other than 1. Omitting the optional parameter lets each
        # provider apply its supported default instead of forcing OpenAI's
        # commonly used deterministic value onto every compatible endpoint.
        return ChatOpenAI(model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
    if os.getenv("ANTHROPIC_API_KEY"):
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"), temperature=0)
    from langchain_google_genai import ChatGoogleGenerativeAI
    return ChatGoogleGenerativeAI(
        model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
        temperature=0,
        api_key=os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "stub",
    )


def build_graph(runtime: str, *, tools: list, system_prompt: str):
    from langchain_core.messages import AIMessage, SystemMessage
    from langgraph.graph import END, START, StateGraph
    from langgraph.prebuilt import ToolNode, tools_condition
    from langgraph.config import get_stream_writer

    all_tools = tools

    def tool_error_message(error: Exception) -> str:
        return (
            f"Tool failed with {type(error).__name__}: {error}. "
            "Correct the tool arguments and retry; use '.' or '/' for the workspace root."
        )

    def prepare_context(state: AssistantState) -> dict[str, Any]:
        skills = state.get("activated_skills", [])
        writer = get_stream_writer()
        for skill in skills:
            writer({"type": "skill_activated", "payload": {"name": skill.get("name"), "source": skill.get("source")}})
        skill_text = "\n\n".join(skill.get("content", "") for skill in skills)
        canvas = json.dumps(state.get("canvas", {}), ensure_ascii=False)
        execution = json.dumps(state.get("execution_request", {}), ensure_ascii=False)
        mcp_catalog = json.dumps(state.get("mcp_catalog", []), ensure_ascii=False)
        return {"prepared_context": (
            f"CURRENT CANVAS SNAPSHOT:\n{canvas}\n\n"
            f"NODE EXECUTION REQUEST:\n{execution}\n\n"
            f"AVAILABLE MCP SERVERS:\n{mcp_catalog}\n\n"
            f"ACTIVATED SKILLS:\n{skill_text}"
        )}

    if runtime == "noop":
        def respond(_state: AssistantState) -> dict[str, Any]:
            return {"messages": [AIMessage(content=NOOP_FALLBACK_MESSAGE)]}
        graph = StateGraph(AssistantState)
        graph.add_node("prepare_context", prepare_context)
        graph.add_node("agent", respond)
        graph.add_edge(START, "prepare_context")
        graph.add_edge("prepare_context", "agent")
        graph.add_edge("agent", END)
        return graph.compile()

    model = _get_llm().bind_tools(all_tools)

    def call_agent(state: AssistantState) -> dict[str, Any]:
        # Canvas tools update state after every interrupt/resume. Re-inject the
        # latest snapshot on every model step rather than relying only on the
        # turn-start prepared context, which may contain an older revision.
        latest_canvas = json.dumps(state.get("canvas", {}), ensure_ascii=False)
        system = SystemMessage(content=(
            f"{system_prompt}\n\n{state.get('prepared_context', '')}\n\n"
            f"LATEST CANVAS SNAPSHOT (supersedes earlier snapshot):\n{latest_canvas}"
        ))
        response = _invoke_with_rate_limit(model, [system, *state.get("messages", [])])
        return {"messages": [response]}

    graph = StateGraph(AssistantState)
    graph.add_node("prepare_context", prepare_context)
    graph.add_node("agent", call_agent)
    graph.add_node("tools", ToolNode(all_tools, handle_tool_errors=tool_error_message))
    graph.add_edge(START, "prepare_context")
    graph.add_edge("prepare_context", "agent")
    graph.add_conditional_edges("agent", tools_condition, {"tools": "tools", "__end__": END})
    graph.add_edge("tools", "agent")
    return graph.compile()
