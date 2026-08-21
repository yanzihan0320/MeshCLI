import asyncio

from src import canvas_tools


def test_workspace_tree_lists_only_one_directory_level(monkeypatch):
    called = {}

    async def fake_safe_path(_state, path):
        return f"safe:{path}"

    async def fake_mcp(_state, name, arguments):
        called.update(name=name, arguments=arguments)
        return "ok"

    monkeypatch.setattr(canvas_tools, "_safe_path", fake_safe_path)
    monkeypatch.setattr(canvas_tools, "_mcp", fake_mcp)

    result = asyncio.run(canvas_tools.workspace_tree.coroutine(".", {"workspace_root": "unused"}))

    assert result == "ok"
    assert called == {"name": "list_directory", "arguments": {"path": "safe:."}}


def test_mcp_results_remain_bounded(monkeypatch):
    monkeypatch.setattr(canvas_tools, "MAX_MCP_RESULT_CHARS", 12)
    result = canvas_tools._bounded_mcp_result("abcdefghijklmnopqrstuvwxyz")
    assert result.startswith("abcdefghijkl")
    assert "truncated by MeshCLI" in result
