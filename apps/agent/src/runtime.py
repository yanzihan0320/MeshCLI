"""Runtime factory for the MeshCLI workspace assistant graph."""

from __future__ import annotations

import json
import os
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


NOOP_FALLBACK_MESSAGE = (
    "Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY in apps/agent/.env "
    "to enable the MeshCLI workspace assistant."
)


def _get_llm():
    if os.getenv("OPENAI_API_KEY"):
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"), temperature=0)
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

    def prepare_context(state: AssistantState) -> dict[str, Any]:
        skills = state.get("activated_skills", [])
        writer = get_stream_writer()
        for skill in skills:
            writer({"type": "skill_activated", "payload": {"name": skill.get("name"), "source": skill.get("source")}})
        skill_text = "\n\n".join(skill.get("content", "") for skill in skills)
        canvas = json.dumps(state.get("canvas", {}), ensure_ascii=False)
        return {"prepared_context": f"CURRENT CANVAS SNAPSHOT:\n{canvas}\n\nACTIVATED SKILLS:\n{skill_text}"}

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
        system = SystemMessage(content=f"{system_prompt}\n\n{state.get('prepared_context', '')}")
        response = model.invoke([system, *state.get("messages", [])])
        return {"messages": [response]}

    graph = StateGraph(AssistantState)
    graph.add_node("prepare_context", prepare_context)
    graph.add_node("agent", call_agent)
    graph.add_node("tools", ToolNode(all_tools))
    graph.add_edge(START, "prepare_context")
    graph.add_edge("prepare_context", "agent")
    graph.add_conditional_edges("agent", tools_condition, {"tools": "tools", "__end__": END})
    graph.add_edge("tools", "agent")
    return graph.compile()
