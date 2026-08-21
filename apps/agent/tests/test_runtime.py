"""Tests for the MeshCLI LangGraph runtime."""

from unittest.mock import Mock, patch

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
            "execution_request": {"nodeId": "node-1"},
            "mcp_catalog": [{"id": "workspace-filesystem"}],
        })
        assert isinstance(output["messages"][-1], AIMessage)
        assert output["messages"][-1].content == NOOP_FALLBACK_MESSAGE
        assert "CURRENT CANVAS SNAPSHOT" in output["prepared_context"]
        assert "NODE EXECUTION REQUEST" in output["prepared_context"]
        assert "AVAILABLE MCP SERVERS" in output["prepared_context"]


class TestGetLlm:
    def test_openai_key_returns_chatopenai(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        from src.runtime import _get_llm
        with patch("langchain_openai.ChatOpenAI", autospec=True) as cls:
            result = _get_llm()
        assert result is cls.return_value
        assert "temperature" not in cls.call_args.kwargs
    def test_anthropic_key_returns_chatanthropic(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        from src.runtime import _get_llm
        with patch("langchain_anthropic.ChatAnthropic", autospec=True) as cls:
            result = _get_llm()
        assert result is cls.return_value


class TestModelPacing:
    def test_default_interval_does_not_throttle_kimi(self, monkeypatch):
        monkeypatch.delenv("LANGGRAPH_MODEL_MIN_INTERVAL_SECONDS", raising=False)
        monkeypatch.setenv("OPENAI_BASE_URL", "https://api.moonshot.cn/v1")
        monkeypatch.setenv("OPENAI_MODEL", "kimi-k3")
        from src.runtime import _model_min_interval_seconds
        assert _model_min_interval_seconds() == 0.0

    def test_explicit_interval_is_preserved(self, monkeypatch):
        monkeypatch.setenv("LANGGRAPH_MODEL_MIN_INTERVAL_SECONDS", "2.5")
        from src.runtime import _model_min_interval_seconds
        assert _model_min_interval_seconds() == 2.5

    def test_zero_interval_does_not_take_global_lock(self, monkeypatch):
        monkeypatch.setenv("LANGGRAPH_MODEL_MIN_INTERVAL_SECONDS", "0")
        model = Mock()
        model.invoke.return_value = "ok"

        class FailingLock:
            def __enter__(self):
                raise AssertionError("zero pacing must not serialize model calls")

            def __exit__(self, *_args):
                return False

        from src import runtime
        monkeypatch.setattr(runtime, "_MODEL_INVOKE_LOCK", FailingLock())
        assert runtime._invoke_with_rate_limit(model, ["hello"]) == "ok"
        model.invoke.assert_called_once_with(["hello"])
