"""Tests for the MeshCLI assistant prompt."""

from src.prompts import SYSTEM_PROMPT
from src.node_supervisor_prompt import NODE_SUPERVISOR_PROMPT


def test_prompt_names_meshcli_and_defines_runtime_boundaries():
    assert "MeshCLI" in SYSTEM_PROMPT
    assert "CanvasSnapshot" in SYSTEM_PROMPT
    assert "OpenHands" in SYSTEM_PROMPT
    assert "read-only filesystem MCP" in SYSTEM_PROMPT
    assert "Deletion always requires confirmation" in SYSTEM_PROMPT


def test_node_supervisor_keeps_repository_inspection_lightweight():
    assert ".git" in NODE_SUPERVISOR_PROMPT
    assert ".meshcli" in NODE_SUPERVISOR_PROMPT
    assert "at most three" in NODE_SUPERVISOR_PROMPT
