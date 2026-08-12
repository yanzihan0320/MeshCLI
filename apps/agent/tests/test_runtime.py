"""Tests for the MeshCLI LangGraph runtime."""

from unittest.mock import patch

from langchain_core.messages import AIMessage, HumanMessage

from src.runtime import NOOP_FALLBACK_MESSAGE, build_graph


class TestBuildGraph:
    def test_noop_runtime_has_prepare_context_and_agent_nodes(self):
        graph = build_graph("noop", tools=[], system_prompt="unused")
        assert {"prepare_context", "agent"}.issubset(graph.get_graph().nodes)

    def test_noop_graph_preserves_workspace_context_and_responds(self):
        graph = build_graph("noop", tools=[], system_prompt="")
        output = graph.invoke({
            "messages": [HumanMessage(content="ping")],
            "workspace_id": "workspace-1",
            "workspace_root": ".",
            "canvas": {"version": 1, "revision": 2, "nodes": [], "edges": []},
            "activated_skills": [],
        })
        assert isinstance(output["messages"][-1], AIMessage)
        assert output["messages"][-1].content == NOOP_FALLBACK_MESSAGE
        assert "CURRENT CANVAS SNAPSHOT" in output["prepared_context"]


class TestGetLlm:
    def test_openai_key_returns_chatopenai(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        from src.runtime import _get_llm
        with patch("langchain_openai.ChatOpenAI", autospec=True) as cls:
            result = _get_llm()
        assert result is cls.return_value
    def test_anthropic_key_returns_chatanthropic(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        from src.runtime import _get_llm
        with patch("langchain_anthropic.ChatAnthropic", autospec=True) as cls:
            result = _get_llm()
        assert result is cls.return_value
