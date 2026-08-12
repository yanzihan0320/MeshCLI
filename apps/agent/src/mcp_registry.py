"""Server-side MCP registry. Browser input never controls commands or roots."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


READ_ONLY_FILESYSTEM_TOOLS = frozenset(
    {
        "read_file",
        "read_text_file",
        "read_multiple_files",
        "list_directory",
        "directory_tree",
        "search_files",
        "get_file_info",
        "list_allowed_directories",
    }
)


@dataclass(frozen=True)
class MCPServerRegistration:
    server_id: str
    transport: str
    enabled: bool
    tool_allowlist: frozenset[str]


FILESYSTEM_REGISTRATION = MCPServerRegistration(
    server_id="workspace-filesystem",
    transport="stdio",
    enabled=os.getenv("MESHCLI_FILESYSTEM_MCP_ENABLED", "true").lower() != "false",
    tool_allowlist=READ_ONLY_FILESYSTEM_TOOLS,
)


def _safe_root(root: str) -> Path:
    if not root.strip():
        raise ValueError("This MeshCLI workspace is not bound to a repository.")
    value = Path(root).resolve(strict=True)
    if not value.is_dir():
        raise ValueError("Workspace MCP root must be a directory.")
    return value


def safe_workspace_path(root: str, requested: str) -> str:
    workspace = _safe_root(root)
    target = (workspace / requested).resolve(strict=False)
    try:
        target.relative_to(workspace)
    except ValueError as error:
        raise ValueError("MCP path escapes the bound workspace.") from error
    return str(target)


def filesystem_server_config(root: str) -> dict[str, dict[str, Any]]:
    workspace = _safe_root(root)
    if os.getenv("MESHCLI_FILESYSTEM_MCP_ENABLED", "true").lower() == "false":
        return {}
    command = os.getenv("MESHCLI_FILESYSTEM_MCP_COMMAND", "npx")
    package = os.getenv(
        "MESHCLI_FILESYSTEM_MCP_PACKAGE",
        "@modelcontextprotocol/server-filesystem",
    )
    return {
        "workspace-filesystem": {
            "transport": "stdio",
            "command": command,
            "args": ["-y", package, str(workspace)],
        }
    }


async def call_filesystem_tool(root: str, name: str, arguments: dict[str, Any]) -> Any:
    if name not in READ_ONLY_FILESYSTEM_TOOLS:
        raise PermissionError(f"MCP tool is not on the read-only allowlist: {name}")
    registry = MCPRegistry(root)
    tools = await registry.get_tools()
    selected = next((candidate for candidate in tools if candidate.name == name), None)
    if selected is None:
        raise LookupError(f"Filesystem MCP tool is unavailable: {name}")
    return await selected.ainvoke(arguments)


class MCPRegistry:
    """One adapter-backed registry for tools, resources, and prompts."""

    def __init__(self, workspace_root: str):
        self.workspace_root = workspace_root

    def _client(self):
        from langchain_mcp_adapters.client import MultiServerMCPClient
        config = filesystem_server_config(self.workspace_root)
        if not config:
            raise RuntimeError("The workspace filesystem MCP server is disabled.")
        return MultiServerMCPClient(config)

    async def get_tools(self) -> list[Any]:
        tools = await self._client().get_tools()
        return [tool for tool in tools if tool.name in FILESYSTEM_REGISTRATION.tool_allowlist]

    async def get_resources(self) -> list[Any]:
        """Return resources exposed by registered servers (filesystem normally exposes none)."""
        return await self._client().get_resources(FILESYSTEM_REGISTRATION.server_id)

    async def get_prompt(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        """Load an MCP prompt without exposing server configuration to the browser."""
        return await self._client().get_prompt(
            FILESYSTEM_REGISTRATION.server_id,
            name,
            arguments=arguments,
        )
