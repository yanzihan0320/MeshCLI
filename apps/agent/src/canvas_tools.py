"""LangGraph tools for frontend-owned canvas commands and read-only MCP."""

from __future__ import annotations

import json
import uuid
from typing import Annotated, Any

from langchain_core.messages import ToolMessage
from langchain_core.tools import InjectedToolCallId, tool
from langgraph.prebuilt import InjectedState
from langgraph.config import get_stream_writer
from langgraph.types import Command, interrupt

from src.mcp_registry import call_filesystem_tool, safe_workspace_path


def _writer_event(event_type: str, payload: dict[str, Any]) -> None:
    get_stream_writer()({"type": event_type, "payload": payload})


def _canvas_command(
    state: dict[str, Any],
    tool_call_id: str,
    command_type: str,
    payload: dict[str, Any],
    risk: str = "write",
) -> Command:
    canvas = state.get("canvas") or {}
    command = {
        "version": 1,
        "actionId": str(uuid.uuid4()),
        "workspaceId": state["workspace_id"],
        "expectedRevision": int(canvas.get("revision", 0)),
        "risk": risk,
        "type": command_type,
        "payload": payload,
    }
    event_type = "permission_required" if risk == "destructive" else "canvas_command"
    _writer_event(event_type, {"command": command})
    resumed = interrupt({"command": command, "requires_confirmation": risk == "destructive"})
    result = resumed.get("result", resumed) if isinstance(resumed, dict) else resumed
    updated_canvas = resumed.get("canvas", canvas) if isinstance(resumed, dict) else canvas
    updated_workspace_root = resumed.get("workspace_root", state.get("workspace_root", "")) if isinstance(resumed, dict) else state.get("workspace_root", "")
    return Command(
        update={
            "canvas": updated_canvas,
            "workspace_root": updated_workspace_root,
            "messages": [
                ToolMessage(
                    content=json.dumps(result, ensure_ascii=False, default=str),
                    tool_call_id=tool_call_id,
                )
            ],
        }
    )


StateArg = Annotated[dict[str, Any], InjectedState]
ToolCallArg = Annotated[str, InjectedToolCallId]


@tool
def create_node(topic: str, state: StateArg, tool_call_id: ToolCallArg, assistant_message: str = "", label: str = "", color: str = "") -> Command:
    """Create one standalone canvas node. Reuse a matching node when possible."""
    payload = {"topic": topic}
    if assistant_message: payload["assistantMessage"] = assistant_message
    if label: payload["label"] = label
    if color: payload["color"] = color
    return _canvas_command(state, tool_call_id, "create_node", payload)


@tool
def create_branch(parent_node_id: str, topic: str, state: StateArg, tool_call_id: ToolCallArg, branch_text: str = "", prompt: str = "", assistant_message: str = "") -> Command:
    """Create a branch from an exact existing node ID."""
    payload: dict[str, Any] = {"parentNodeId": parent_node_id, "topic": topic}
    if branch_text: payload["branchText"] = branch_text
    if prompt: payload["prompt"] = prompt
    if assistant_message: payload["assistantMessage"] = assistant_message
    return _canvas_command(state, tool_call_id, "create_branch", payload)


@tool
def merge_nodes(node_ids: list[str], topic: str, merge_action: str, state: StateArg, tool_call_id: ToolCallArg, assistant_summary: str = "") -> Command:
    """Merge two or more exact existing node IDs into one synthesis node."""
    payload: dict[str, Any] = {"nodeIds": node_ids, "topic": topic, "mergeAction": merge_action}
    if assistant_summary: payload["assistantSummary"] = assistant_summary
    return _canvas_command(state, tool_call_id, "merge_nodes", payload)


@tool
def append_message(node_id: str, role: str, content: str, state: StateArg, tool_call_id: ToolCallArg) -> Command:
    """Append a user, assistant, or system message to an exact node ID."""
    if role not in {"user", "assistant", "system"}:
        raise ValueError("Unsupported message role.")
    return _canvas_command(state, tool_call_id, "append_message", {"nodeId": node_id, "role": role, "content": content})


@tool
def update_node(node_id: str, state: StateArg, tool_call_id: ToolCallArg, topic: str = "", label: str = "", color: str = "", collapsed: bool | None = None) -> Command:
    """Update ordinary metadata on an exact node ID."""
    payload: dict[str, Any] = {"nodeId": node_id}
    if topic: payload["topic"] = topic
    if label: payload["label"] = label
    if color: payload["color"] = color
    if collapsed is not None: payload["collapsed"] = collapsed
    return _canvas_command(state, tool_call_id, "update_node", payload)


@tool
def connect_nodes(source: str, target: str, state: StateArg, tool_call_id: ToolCallArg, label: str = "related") -> Command:
    """Connect two exact existing node IDs."""
    return _canvas_command(state, tool_call_id, "connect_nodes", {"source": source, "target": target, "label": label})


@tool
def focus_node(node_id: str, state: StateArg, tool_call_id: ToolCallArg) -> Command:
    """Focus an exact existing node in the frontend canvas."""
    return _canvas_command(state, tool_call_id, "focus_node", {"nodeId": node_id}, "read")


@tool
def delete_node(node_id: str, state: StateArg, tool_call_id: ToolCallArg) -> Command:
    """Delete one exact node. This always requires explicit user confirmation."""
    return _canvas_command(state, tool_call_id, "delete_node", {"nodeId": node_id}, "destructive")


async def _mcp(state: dict[str, Any], name: str, arguments: dict[str, Any]) -> str:
    _writer_event("mcp_started", {"serverId": "workspace-filesystem", "tool": name})
    try:
        result = await call_filesystem_tool(state["workspace_root"], name, arguments)
        _writer_event("mcp_finished", {"serverId": "workspace-filesystem", "tool": name})
        return str(result)
    except Exception as error:
        _writer_event("mcp_failed", {"serverId": "workspace-filesystem", "tool": name, "error": str(error)})
        raise


@tool
async def workspace_tree(path: str, state: StateArg) -> str:
    """Read a directory tree from the bound repository through read-only MCP."""
    return await _mcp(state, "directory_tree", {"path": safe_workspace_path(state["workspace_root"], path)})


@tool
async def search_workspace(pattern: str, path: str, state: StateArg) -> str:
    """Search file names in the bound repository through read-only MCP."""
    return await _mcp(state, "search_files", {"path": safe_workspace_path(state["workspace_root"], path), "pattern": pattern})


@tool
async def read_workspace_file(path: str, state: StateArg) -> str:
    """Read one file from the bound repository through read-only MCP."""
    return await _mcp(state, "read_text_file", {"path": safe_workspace_path(state["workspace_root"], path)})


CANVAS_TOOLS = [create_node, create_branch, merge_nodes, append_message, update_node, connect_nodes, focus_node, delete_node]
MCP_TOOLS = [workspace_tree, search_workspace, read_workspace_file]
