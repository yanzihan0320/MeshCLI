"""Server-side MCP registry. Browser input never controls commands or roots."""

from __future__ import annotations

import asyncio
import os
import json
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
    # Models commonly use POSIX-style `/` for "the current workspace root".
    # Treat leading separators as workspace-relative, while the resolved-path
    # containment check below still rejects `../` and Windows drive escapes.
    normalized = requested.strip()
    if normalized in {"", ".", "/", "\\"}:
        normalized = "."
    elif normalized.startswith(("/", "\\")):
        normalized = normalized.lstrip("/\\") or "."
    target = (workspace / normalized).resolve(strict=False)
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


def _capabilities_path() -> Path:
    explicit = os.getenv("MESHCLI_CAPABILITIES_PATH")
    if explicit:
        return Path(explicit)
    local = os.getenv("LOCALAPPDATA")
    if local:
        return Path(local) / "MeshCLI" / "capabilities.json"
    return Path.home() / ".meshcli" / "capabilities.json"


def _stored_servers() -> list[dict[str, Any]]:
    try:
        payload = json.loads(_capabilities_path().read_text(encoding="utf-8"))
        servers = payload.get("mcpServers", [])
        return servers if isinstance(servers, list) else []
    except (OSError, ValueError, TypeError):
        return []


def configured_server_configs(root: str, workspace_id: str = "") -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Return adapter configs and trusted policy metadata for enabled read-only servers."""
    configs = filesystem_server_config(root)
    policies: dict[str, dict[str, Any]] = {
        FILESYSTEM_REGISTRATION.server_id: {
            "readOnly": True,
            "toolAllowlist": list(READ_ONLY_FILESYSTEM_TOOLS),
        }
    } if configs else {}
    for server in _stored_servers():
        server_id = str(server.get("id", ""))
        if not server_id or not server.get("enabled", True):
            if server_id == FILESYSTEM_REGISTRATION.server_id:
                configs.pop(server_id, None)
                policies.pop(server_id, None)
            continue
        if server.get("scope") == "workspace" and server.get("workspaceId") != workspace_id:
            continue
        if server_id == FILESYSTEM_REGISTRATION.server_id:
            if not server.get("enabled", True):
                configs.pop(server_id, None)
                policies.pop(server_id, None)
            continue
        # Write-capable MCP servers remain catalogued in the UI but are not exposed
        # to an Agent until the shared permission manager supports their actions.
        if not server.get("readOnly"):
            continue
        allowlist = [str(name) for name in server.get("toolAllowlist", []) if str(name)]
        if not allowlist:
            continue
        transport = server.get("transport")
        if transport == "stdio":
            command = str(server.get("command", "")).strip()
            if not command:
                continue
            args = [str(arg).replace("{workspaceRoot}", str(_safe_root(root))) for arg in server.get("args", [])]
            configs[server_id] = {"transport": "stdio", "command": command, "args": args}
        elif transport == "streamable-http":
            url = str(server.get("url", "")).strip()
            if not url:
                continue
            headers: dict[str, str] = {}
            for header, env_name in (server.get("headersFromEnv") or {}).items():
                value = os.getenv(str(env_name))
                if value:
                    headers[str(header)] = value
            configs[server_id] = {"transport": "http", "url": url, "headers": headers}
        else:
            continue
        policies[server_id] = {"readOnly": True, "toolAllowlist": allowlist}
    return configs, policies


async def call_filesystem_tool(root: str, name: str, arguments: dict[str, Any]) -> Any:
    if name not in READ_ONLY_FILESYSTEM_TOOLS:
        raise PermissionError(f"MCP tool is not on the read-only allowlist: {name}")
    registry = MCPRegistry(root)
    tools = await registry.get_tools(FILESYSTEM_REGISTRATION.server_id)
    selected = next((candidate for candidate in tools if candidate.name == name), None)
    if selected is None:
        raise LookupError(f"Filesystem MCP tool is unavailable: {name}")
    return await selected.ainvoke(arguments)


class MCPRegistry:
    """One adapter-backed registry for tools, resources, and prompts."""

    def __init__(self, workspace_root: str, workspace_id: str = ""):
        self.workspace_root = workspace_root
        self.workspace_id = workspace_id

    def _configuration(self) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
        return configured_server_configs(self.workspace_root, self.workspace_id)

    @staticmethod
    def _client(config: dict[str, dict[str, Any]]):
        from langchain_mcp_adapters.client import MultiServerMCPClient
        if not config:
            raise RuntimeError("No enabled read-only MCP server is available.")
        return MultiServerMCPClient(config)

    async def _async_configuration(self) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
        # Path resolution, existence checks, and reading the local registry are
        # intentionally synchronous security checks. Keep them off LangGraph's
        # ASGI event loop so MCP calls do not trip the dev server's blocking-call
        # guard or stall unrelated assistant runs.
        return await asyncio.get_running_loop().run_in_executor(None, self._configuration)

    async def get_tools(self, server_id: str | None = None) -> list[Any]:
        configs, policies = await self._async_configuration()
        if server_id and server_id not in policies:
            raise PermissionError(f"MCP server is not available to this workspace: {server_id}")
        tools = await self._client(configs).get_tools(server_name=server_id)
        allowed = set(policies[server_id]["toolAllowlist"]) if server_id else {
            name for policy in policies.values() for name in policy["toolAllowlist"]
        }
        return [tool for tool in tools if tool.name in allowed]

    async def call_tool(self, server_id: str, name: str, arguments: dict[str, Any]) -> Any:
        configs, policies = await self._async_configuration()
        policy = policies.get(server_id)
        if not policy or not policy.get("readOnly"):
            raise PermissionError(f"MCP server is not on the read-only allowlist: {server_id}")
        if name not in policy.get("toolAllowlist", []):
            raise PermissionError(f"MCP tool is not allowed: {server_id}/{name}")
        tools = await self._client(configs).get_tools(server_name=server_id)
        selected = next((tool for tool in tools if tool.name == name and tool.name in policy["toolAllowlist"]), None)
        if selected is None:
            raise LookupError(f"MCP tool is unavailable: {server_id}/{name}")
        return await selected.ainvoke(arguments)

    async def get_resources(self) -> list[Any]:
        """Return resources exposed by registered servers (filesystem normally exposes none)."""
        configs, policies = await self._async_configuration()
        if FILESYSTEM_REGISTRATION.server_id not in policies:
            raise PermissionError("Filesystem MCP is not available to this workspace.")
        return await self._client(configs).get_resources(FILESYSTEM_REGISTRATION.server_id)

    async def get_prompt(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        """Load an MCP prompt without exposing server configuration to the browser."""
        configs, policies = await self._async_configuration()
        if FILESYSTEM_REGISTRATION.server_id not in policies:
            raise PermissionError("Filesystem MCP is not available to this workspace.")
        return await self._client(configs).get_prompt(
            FILESYSTEM_REGISTRATION.server_id,
            name,
            arguments=arguments,
        )
