from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import threading
import traceback
from pathlib import Path
from typing import Any


def configure_standard_streams() -> None:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass


configure_standard_streams()

os.environ.setdefault("OPENHANDS_SUPPRESS_BANNER", "1")

from openhands.sdk import Agent, Conversation, LLM, Tool  # noqa: E402
from openhands.sdk.event import (  # noqa: E402
    ActionEvent,
    AgentErrorEvent,
    MessageEvent,
    ObservationEvent,
)
from openhands.sdk.llm import TextContent  # noqa: E402
from openhands.sdk.security.confirmation_policy import NeverConfirm  # noqa: E402
from openhands.tools.file_editor import FileEditorTool  # noqa: E402
from openhands.tools.task_tracker import TaskTrackerTool  # noqa: E402
from openhands.tools.terminal import TerminalTool  # noqa: E402
from openhands.workspace import DockerWorkspace  # noqa: E402


EVENT_PREFIX = "MESHCLI_EVENT "
CONTROL_PREFIX = "MESHCLI_CONTROL "
ANSI_ESCAPE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
LONE_SURROGATE = re.compile("[\ud800-\udfff]")
_output_lock = threading.Lock()
_conversation: Any = None


def sanitize_unicode(value: Any) -> Any:
    """Replace lone UTF-16 surrogates before crossing the JSONL boundary."""
    if isinstance(value, str):
        return LONE_SURROGATE.sub("\ufffd", value)
    if isinstance(value, dict):
        return {
            sanitize_unicode(key) if isinstance(key, str) else key: sanitize_unicode(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [sanitize_unicode(item) for item in value]
    return value


class MeshCLILLM(LLM):
    """OpenHands LLM with a safe UTF-8 boundary for repository-derived text."""

    def format_messages_for_llm(self, messages: list[Any]) -> list[dict[str, Any]]:
        formatted = super().format_messages_for_llm(messages)
        return sanitize_unicode(formatted)

    async def aformat_messages_for_llm(
        self,
        messages: list[Any],
    ) -> list[dict[str, Any]]:
        formatted = await super().aformat_messages_for_llm(messages)
        return sanitize_unicode(formatted)


def emit(event_type: str, payload: dict[str, Any]) -> None:
    with _output_lock:
        sys.stdout.write(
            EVENT_PREFIX
            + json.dumps(
                sanitize_unicode({"type": event_type, "payload": payload}),
                ensure_ascii=False,
            )
            + "\n"
        )
        sys.stdout.flush()


def emit_control(payload: dict[str, Any]) -> None:
    with _output_lock:
        sys.stdout.write(CONTROL_PREFIX + json.dumps(payload) + "\n")
        sys.stdout.flush()


def text_content(value: Any) -> str:
    content = getattr(value, "content", None)
    if isinstance(content, str):
        return content
    if content is None:
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, TextContent):
            parts.append(item.text)
        elif isinstance(item, dict) and isinstance(item.get("text"), str):
            parts.append(item["text"])
    return "".join(parts)


def relative_agent_path(path: str | None, workspace_path: Path, mode: str) -> str:
    if not path:
        return ""
    normalized = path.replace("\\", "/")
    if mode == "docker" and normalized.startswith("/workspace/"):
        return normalized.removeprefix("/workspace/")
    try:
        return str(Path(path).resolve().relative_to(workspace_path)).replace("\\", "/")
    except (OSError, ValueError):
        return normalized


def action_payload(event: ActionEvent) -> dict[str, Any]:
    action = event.action
    arguments = action.model_dump(mode="json") if action is not None else {}
    return {
        "tool": event.tool_name,
        "toolCallId": str(event.tool_call_id),
        "summary": event.summary,
        "arguments": arguments,
    }


class EventMapper:
    def __init__(self, workspace_path: Path, mode: str) -> None:
        self.workspace_path = workspace_path
        self.mode = mode
        self.streamed_text = False
        self.last_agent_message = ""
        self.changed_paths: set[str] = set()

    def detect_changed_files(self) -> None:
        try:
            result = subprocess.run(
                ["git", "status", "--porcelain=v1", "-z", "--untracked-files=normal"],
                cwd=self.workspace_path,
                check=False,
                capture_output=True,
                text=True,
                timeout=10,
            )
            for record in result.stdout.split("\0"):
                if len(record) < 4:
                    continue
                path = record[3:].replace("\\", "/")
                if path and path not in self.changed_paths:
                    self.changed_paths.add(path)
                    emit("file_changed", {"path": path, "operation": "detected"})
        except Exception:
            return

    def on_token(self, chunk: Any) -> None:
        try:
            choices = getattr(chunk, "choices", None) or []
            delta = getattr(choices[0], "delta", None) if choices else None
            content = getattr(delta, "content", None)
            if isinstance(content, str) and content:
                self.streamed_text = True
                emit("text_delta", {"delta": content})
        except Exception:
            return

    def on_event(self, event: Any) -> None:
        if isinstance(event, MessageEvent):
            if event.source != "agent":
                return
            message = text_content(event.llm_message)
            if message:
                self.last_agent_message = message
                if not self.streamed_text:
                    emit("text_delta", {"delta": message})
            return

        if isinstance(event, ActionEvent):
            payload = action_payload(event)
            emit("tool_started", payload)
            if event.tool_name == "finish":
                message = str(payload["arguments"].get("message", "")).strip()
                if message:
                    self.last_agent_message = message
                    emit("text_delta", {"delta": message})
            if event.tool_name == TerminalTool.name:
                emit(
                    "command_started",
                    {
                        "toolCallId": payload["toolCallId"],
                        "command": payload["arguments"].get("command", ""),
                    },
                )
            elif event.tool_name == TaskTrackerTool.name:
                emit("plan_updated", {"plan": payload["arguments"]})
            return

        if isinstance(event, ObservationEvent):
            observation = event.observation
            if event.tool_name == TerminalTool.name:
                output = ANSI_ESCAPE.sub("", getattr(observation, "text", "") or "")
                if output:
                    emit(
                        "command_output",
                        {"toolCallId": str(event.tool_call_id), "output": output},
                    )
                emit(
                    "command_finished",
                    {
                        "toolCallId": str(event.tool_call_id),
                        "exitCode": getattr(observation, "exit_code", None),
                        "timedOut": bool(getattr(observation, "timeout", False)),
                    },
                )
                self.detect_changed_files()
            elif event.tool_name == FileEditorTool.name:
                command = getattr(observation, "command", "")
                if command != "view" and not getattr(observation, "is_error", False):
                    emit(
                        "file_changed",
                        {
                            "toolCallId": str(event.tool_call_id),
                            "path": relative_agent_path(
                                getattr(observation, "path", None),
                                self.workspace_path,
                                self.mode,
                            ),
                            "operation": command,
                        },
                    )
            return

        if isinstance(event, AgentErrorEvent):
            emit("command_output", {"output": event.error, "stream": "stderr"})


def load_request() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("Runner request is empty")
    request = json.loads(raw)
    if not isinstance(request, dict):
        raise ValueError("Runner request must be a JSON object")
    return request


def configure_llm(model_override: str | None = None) -> LLM:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    base_url = os.environ.get("OPENAI_BASE_URL", "").strip()
    configured_model = (model_override or os.environ.get("OPENAI_MODEL", "")).strip()
    if not api_key or not base_url or not configured_model:
        raise RuntimeError("OPENAI_API_KEY, OPENAI_BASE_URL and OPENAI_MODEL are required")
    model = configured_model if "/" in configured_model else f"openai/{configured_model}"
    return MeshCLILLM(
        model=model,
        api_key=api_key,
        base_url=base_url,
        stream=True,
        reasoning_effort=None,
        max_output_tokens=int(os.environ.get("AGENT_MAX_OUTPUT_TOKENS", "8192")),
        timeout=int(os.environ.get("AGENT_LLM_TIMEOUT_SECONDS", "300")),
        num_retries=int(os.environ.get("AGENT_LLM_MAX_RETRIES", "5")),
        log_completions=False,
    )


def stop_conversation(_signum: int, _frame: Any) -> None:
    conversation = _conversation
    if conversation is not None:
        try:
            conversation.pause()
        except Exception:
            pass


def resolve_working_directory(workspace_path: Path, value: Any) -> tuple[Path, str]:
    relative = str(value or ".").replace("\\", "/").removeprefix("./") or "."
    if relative.startswith("/") or ".." in relative.split("/"):
        raise ValueError("workingDirectory must stay inside the managed workspace")
    local_path = (workspace_path / relative).resolve()
    try:
        local_path.relative_to(workspace_path)
    except ValueError as error:
        raise ValueError("workingDirectory escaped the managed workspace") from error
    if not local_path.is_dir():
        raise ValueError(f"workingDirectory does not exist: {relative}")
    docker_path = "/workspace" if relative == "." else f"/workspace/{relative}"
    return local_path, docker_path


def run() -> int:
    global _conversation
    request = load_request()
    workspace_path = Path(str(request["workspacePath"])).resolve()
    persistence_path = Path(str(request["persistencePath"])).resolve()
    mode = str(request.get("mode", "docker"))
    if mode not in {"local", "docker"}:
        raise ValueError(f"Unsupported workspace mode: {mode}")
    if not workspace_path.is_dir():
        raise ValueError("Managed run workspace does not exist")
    local_working_directory, docker_working_directory = resolve_working_directory(
        workspace_path,
        request.get("workingDirectory"),
    )
    persistence_path.mkdir(parents=True, exist_ok=True)

    mapper = EventMapper(workspace_path, mode)
    llm = configure_llm(str(request.get("model") or ""))
    agent = Agent(
        llm=llm,
        tools=[
            Tool(name=TerminalTool.name),
            Tool(name=FileEditorTool.name),
            Tool(name=TaskTrackerTool.name),
        ],
    )

    workspace: Any = local_working_directory
    docker_workspace: DockerWorkspace | None = None
    if mode == "docker":
        mount = f"{workspace_path.as_posix()}:/workspace"
        remote_env = {
            "OH_CONVERSATIONS_PATH": "/tmp/meshcli/conversations",
            "OH_BASH_EVENTS_DIR": "/tmp/meshcli/bash_events",
            "OH_WORKSPACE_PATH": "/workspace",
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUTF8": "1",
        }
        os.environ.update(remote_env)
        docker_workspace = DockerWorkspace(
            working_dir=docker_working_directory,
            server_image=str(
                request.get(
                    "dockerImage",
                    "ghcr.io/openhands/agent-server:1.36.1-python",
                )
            ),
            volumes=[mount],
            forward_env=list(remote_env),
            detach_logs=False,
            health_check_timeout=float(request.get("dockerHealthTimeout", 180)),
        )
        container_id = getattr(docker_workspace, "_container_id", None)
        if container_id:
            emit_control({"containerId": container_id})
        workspace = docker_workspace

    try:
        conversation_options: dict[str, Any] = {}
        if mode == "local":
            conversation_options["persistence_dir"] = persistence_path
        _conversation = Conversation(
            agent=agent,
            workspace=workspace,
            callbacks=[mapper.on_event],
            token_callbacks=[mapper.on_token],
            visualizer=None,
            max_iteration_per_run=int(request.get("maxIterations", 60)),
            delete_on_close=True,
            **conversation_options,
        )
        _conversation.set_confirmation_policy(NeverConfirm())
        _conversation.send_message(
            "You are running inside a MeshCLI-managed disposable project copy. "
            "Work autonomously, keep every change inside the current workspace, never seek "
            "or expose secrets, and finish with a concise summary and verification.\n\n"
            f"User task:\n{request['prompt']}"
        )
        _conversation.run()
        emit(
            "run_finished",
            {
                "adapter": "openhands",
                "summary": mapper.last_agent_message or "OpenHands execution completed.",
            },
        )
        return 0
    finally:
        if _conversation is not None:
            try:
                _conversation.close()
            finally:
                _conversation = None
        if docker_workspace is not None:
            docker_workspace.cleanup()


def main() -> None:
    signal.signal(signal.SIGINT, stop_conversation)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, stop_conversation)
    try:
        raise SystemExit(run())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as error:
        message = sanitize_unicode(traceback.format_exc())
        sys.stderr.write(message)
        sys.stderr.flush()
        raise SystemExit(1)


if __name__ == "__main__":
    main()
