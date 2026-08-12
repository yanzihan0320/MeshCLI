from pathlib import Path

import pytest

from src.mcp_registry import FILESYSTEM_REGISTRATION, READ_ONLY_FILESYSTEM_TOOLS, safe_workspace_path


def test_filesystem_allowlist_has_no_write_tools():
    assert "read_file" in READ_ONLY_FILESYSTEM_TOOLS
    assert not any(token in name for name in READ_ONLY_FILESYSTEM_TOOLS for token in ("write", "move", "delete"))
    assert FILESYSTEM_REGISTRATION.tool_allowlist == READ_ONLY_FILESYSTEM_TOOLS
    assert FILESYSTEM_REGISTRATION.transport == "stdio"


def test_safe_workspace_path_rejects_escape(tmp_path: Path):
    (tmp_path / "src").mkdir()
    assert Path(safe_workspace_path(str(tmp_path), "src")).parent == tmp_path
    with pytest.raises(ValueError):
        safe_workspace_path(str(tmp_path), "../outside")
    with pytest.raises(ValueError):
        safe_workspace_path("", "README.md")
