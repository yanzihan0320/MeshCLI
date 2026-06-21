"""Tests for src.runtime — graph building, LLM selection, and merge_system_messages."""

from unittest.mock import MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from src.runtime import NOOP_FALLBACK_MESSAGE, build_graph, merge_system_messages


# ---------------------------------------------------------------------------
# merge_system_messages
# ---------------------------------------------------------------------------

class TestMergeSystemMessages:
    def test_merges_scattered_system_messages(self):
        messages = [
            SystemMessage(content="sys1"),
            HumanMessage(content="hi"),
            SystemMessage(content="sys2"),
            AIMessage(content="hello"),
        ]
        result = merge_system_messages(messages)
        assert len(result) == 3
        assert isinstance(result[0], SystemMessage)
        assert result[0].content == "sys1\n\nsys2"
        assert isinstance(result[1], HumanMessage)
        assert isinstance(result[2], AIMessage)

    def test_preserves_order_of_non_system_messages(self):
        messages = [
            HumanMessage(content="first"),
            SystemMessage(content="sys"),
            AIMessage(content="second"),
            HumanMessage(content="third"),
        ]
        result = merge_system_messages(messages)
        non_system = [m for m in result if not isinstance(m, SystemMessage)]
        assert [m.content for m in non_system] == ["first", "second", "third"]

    def test_no_system_messages_returns_original(self):
        messages = [
            HumanMessage(content="hi"),
            AIMessage(content="hello"),
        ]
        result = merge_system_messages(messages)
        assert result == messages

    def test_empty_input_returns_empty(self):
        assert merge_system_messages([]) == []

    def test_non_string_content_uses_str_fallback(self):
        messages = [
            SystemMessage(content=["chunk1", "chunk2"]),
            HumanMessage(content="hi"),
        ]
        result = merge_system_messages(messages)
        assert len(result) == 2
        assert isinstance(result[0], SystemMessage)
        # str() of a list produces something like "['chunk1', 'chunk2']"
        assert "chunk1" in result[0].content
        assert "chunk2" in result[0].content


# ---------------------------------------------------------------------------
# build_graph routing
# ---------------------------------------------------------------------------

class TestBuildGraph:
    def test_noop_runtime_returns_compiled_graph(self):
        graph = build_graph("noop", tools=[], system_prompt="unused")
        # CompiledStateGraph has an .invoke method
        assert callable(getattr(graph, "invoke", None))

    def test_non_noop_delegates_to_build_react(self):
        sentinel = MagicMock()
        with patch("src.runtime._build_react", return_value=sentinel) as mock_br:
            result = build_graph("react", tools=["t"], system_prompt="sp")
        mock_br.assert_called_once_with(["t"], "sp")
        assert result is sentinel


# ---------------------------------------------------------------------------
# Noop graph execution
# ---------------------------------------------------------------------------

class TestNoopGraph:
    def test_invoke_returns_ai_message(self):
        graph = build_graph("noop", tools=[], system_prompt="")
        output = graph.invoke({"messages": [HumanMessage(content="ping")]})
        assert len(output["messages"]) == 2  # input + response
        assert isinstance(output["messages"][-1], AIMessage)

    def test_response_matches_fallback_message(self):
        graph = build_graph("noop", tools=[], system_prompt="")
        output = graph.invoke({"messages": [HumanMessage(content="anything")]})
        assert output["messages"][-1].content == NOOP_FALLBACK_MESSAGE


# ---------------------------------------------------------------------------
# _get_llm env-based selection
# ---------------------------------------------------------------------------

class TestGetLlm:
    def test_openai_key_returns_chatopenai(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)

        from src.runtime import _get_llm

        with patch("langchain_openai.ChatOpenAI", autospec=True) as MockCls:
            result = _get_llm()

        MockCls.assert_called_once()
        assert result is MockCls.return_value

    def test_anthropic_key_returns_system_merging(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)

        from src.runtime import _get_llm

        with patch("langchain_anthropic.ChatAnthropic.__init__", return_value=None):
            result = _get_llm()

        assert type(result).__name__ == "_SystemMergingAnthropic"

    def test_gemini_key_returns_google_genai(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.setenv("GEMINI_API_KEY", "gemini-test")

        from src.runtime import _get_llm

        with patch("langchain_google_genai.ChatGoogleGenerativeAI", autospec=True) as MockCls:
            result = _get_llm()

        MockCls.assert_called_once()
        assert result is MockCls.return_value

    def test_agent_temperature_forwarded(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        monkeypatch.setenv("AGENT_TEMPERATURE", "0.7")
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)

        from src.runtime import _get_llm

        with patch("langchain_openai.ChatOpenAI", autospec=True) as MockCls:
            _get_llm()

        _, kwargs = MockCls.call_args
        assert kwargs["temperature"] == 0.7
