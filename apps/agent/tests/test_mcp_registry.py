from pathlib import Path

import pytest

from src.mcp_registry import FILESYSTEM_REGISTRATION, READ_ONLY_FILESYSTEM_TOOLS, configured_server_configs, safe_workspace_path


def test_filesystem_allowlist_has_no_write_tools():
    assert "read_file" in READ_ONLY_FILESYSTEM_TOOLS
    assert not any(token in name for name in READ_ONLY_FILESYSTEM_TOOLS for token in ("write", "move", "delete"))
    assert FILESYSTEM_REGISTRATION.tool_allowlist == READ_ONLY_FILESYSTEM_TOOLS
    assert FILESYSTEM_REGISTRATION.transport == "stdio"


def test_safe_workspace_path_rejects_escape(tmp_path: Path):
    (tmp_path / "src").mkdir()
    assert Path(safe_workspace_path(str(tmp_path), "src")).parent == tmp_path
    assert Path(safe_workspace_path(str(tmp_path), "/")) == tmp_path
    assert Path(safe_workspace_path(str(tmp_path), "/src")) == tmp_path / "src"
    assert Path(safe_workspace_path(str(tmp_path), ".")) == tmp_path
    with pytest.raises(ValueError):
        safe_workspace_path(str(tmp_path), "../outside")
    with pytest.raises(ValueError):
        safe_workspace_path(str(tmp_path), "/../../outside")
    with pytest.raises(ValueError):
        safe_workspace_path("", "README.md")


def test_configured_servers_expose_only_read_only_allowlisted_entries(tmp_path: Path, monkeypatch):
    config = tmp_path / "capabilities.json"
    config.write_text('''{"mcpServers":[
      {"id":"docs","name":"Docs","scope":"user","transport":"streamable-http","enabled":true,"url":"https://example.test/mcp","readOnly":true,"toolAllowlist":["search_docs"]},
      {"id":"writer","name":"Writer","scope":"user","transport":"streamable-http","enabled":true,"url":"https://example.test/write","readOnly":false,"toolAllowlist":["write"]}
    ]}''', encoding="utf-8")
    monkeypatch.setenv("MESHCLI_CAPABILITIES_PATH", str(config))
    configs, policies = configured_server_configs(str(tmp_path), "workspace-1")
    assert configs["docs"]["transport"] == "http"
    assert policies["docs"]["toolAllowlist"] == ["search_docs"]
    assert "writer" not in configs
