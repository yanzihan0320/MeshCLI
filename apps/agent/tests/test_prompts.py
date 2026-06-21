"""Tests for src.prompts — SYSTEM_PROMPT composition."""

from src.prompts import CANVAS_STATE_SHAPE, FRONTEND_TOOLS, SYSTEM_PROMPT


class TestSystemPrompt:
    def test_is_nonempty_string(self):
        assert isinstance(SYSTEM_PROMPT, str)
        assert len(SYSTEM_PROMPT.strip()) > 0

    def test_contains_canvas_state_shape(self):
        assert CANVAS_STATE_SHAPE.strip() in SYSTEM_PROMPT

    def test_contains_frontend_tools(self):
        assert FRONTEND_TOOLS.strip() in SYSTEM_PROMPT

    def test_all_tool_names_present_in_frontend_tools(self):
        expected_tools = [
            "createChatNode",
            "createBranchFromNode",
            "mergeChatNodes",
            "appendNodeMessage",
            "updateChatNode",
            "focusChatNode",
            "highlightWorkspaceFinding",
            "renderNodePreview",
            "renderMergePlan",
            "renderBranchProposal",
            "deleteChatNode",
            "renderChart",
        ]
        for tool_name in expected_tools:
            assert tool_name in FRONTEND_TOOLS, f"{tool_name} missing from FRONTEND_TOOLS"
