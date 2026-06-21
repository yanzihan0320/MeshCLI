"""Runtime factory for the CaudalFlow Copilot LangGraph agent."""

from __future__ import annotations

import os

from langgraph.graph.state import CompiledStateGraph


NOOP_FALLBACK_MESSAGE = (
    "Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY in apps/agent/.env to enable the CaudalFlow Copilot agent. "
    "The frontend and runtime wiring are installed."
)


def build_graph(
    runtime: str,
    *,
    tools: list,
    system_prompt: str,
) -> CompiledStateGraph:
    if runtime == "noop":
        return _build_noop(NOOP_FALLBACK_MESSAGE)
    return _build_react(tools, system_prompt)


from langgraph.graph.message import add_messages as _add_messages
from typing_extensions import Annotated as _Annotated, TypedDict as _TypedDict


class _NoopState(_TypedDict):
    messages: _Annotated[list, _add_messages]


def _build_noop(message: str) -> CompiledStateGraph:
    from langchain_core.messages import AIMessage
    from langgraph.graph import END, START, StateGraph

    def _respond(_state: _NoopState) -> dict:
        return {"messages": [AIMessage(content=message, id="noop-fallback")]}

    graph = StateGraph(_NoopState)
    graph.add_node("respond", _respond)
    graph.add_edge(START, "respond")
    graph.add_edge("respond", END)
    return graph.compile()


def merge_system_messages(messages: list) -> list:
    """Consolidate all system messages into one at the front.

    CopilotKit injects extra system messages that get interleaved
    with user/assistant turns. The Anthropic API rejects
    non-consecutive system messages, so we pull them all out and
    merge them into a single leading SystemMessage.
    """
    from langchain_core.messages import SystemMessage

    system_parts: list[str] = []
    other: list = []
    for msg in messages:
        if isinstance(msg, SystemMessage):
            text = msg.content if isinstance(msg.content, str) else str(msg.content)
            if text:
                system_parts.append(text)
        else:
            other.append(msg)
    if system_parts:
        return [SystemMessage(content="\n\n".join(system_parts))] + other
    return other


def _get_llm():
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key:
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            temperature=float(os.getenv("AGENT_TEMPERATURE", "0")),
        )

    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    if anthropic_key:
        from langchain_anthropic import ChatAnthropic

        class _SystemMergingAnthropic(ChatAnthropic):
            """ChatAnthropic subclass that merges scattered system messages."""

            def _get_request_payload(self, messages: list, **kwargs) -> dict:
                return super()._get_request_payload(
                    merge_system_messages(messages), **kwargs
                )

        return _SystemMergingAnthropic(
            model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
            temperature=float(os.getenv("AGENT_TEMPERATURE", "0")),
        )

    from langchain_google_genai import ChatGoogleGenerativeAI

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "stub"
    return ChatGoogleGenerativeAI(
        model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
        temperature=float(os.getenv("AGENT_TEMPERATURE", "0")),
        api_key=api_key,
    )


def _build_react(tools: list, system_prompt: str) -> CompiledStateGraph:
    from copilotkit import CopilotKitMiddleware
    from langchain.agents import create_agent

    return create_agent(
        model=_get_llm(),
        tools=tools,
        system_prompt=system_prompt,
        middleware=[CopilotKitMiddleware()],
    )
