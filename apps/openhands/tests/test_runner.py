import io
import json
from pathlib import Path
import subprocess

from meshcli_openhands import runner


def test_standard_streams_are_forced_to_utf8(monkeypatch) -> None:
    class FakeStream:
        def __init__(self) -> None:
            self.calls: list[tuple[str, str]] = []

        def reconfigure(self, *, encoding: str, errors: str) -> None:
            self.calls.append((encoding, errors))

    stdin = FakeStream()
    stdout = FakeStream()
    stderr = FakeStream()
    monkeypatch.setattr(runner.sys, "stdin", stdin)
    monkeypatch.setattr(runner.sys, "stdout", stdout)
    monkeypatch.setattr(runner.sys, "stderr", stderr)

    runner.configure_standard_streams()

    assert stdin.calls == [("utf-8", "replace")]
    assert stdout.calls == [("utf-8", "replace")]
    assert stderr.calls == [("utf-8", "replace")]


def test_emit_replaces_lone_unicode_surrogates(monkeypatch) -> None:
    stdout = io.StringIO()
    monkeypatch.setattr(runner.sys, "stdout", stdout)

    runner.emit("command_output", {"output": "broken:\udcae", "nested": ["\ud800"]})

    line = stdout.getvalue()
    line.encode("utf-8", errors="strict")
    event = json.loads(line.removeprefix(runner.EVENT_PREFIX))
    assert event["payload"] == {"output": "broken:\ufffd", "nested": ["\ufffd"]}


def test_relative_agent_path_for_docker(tmp_path: Path) -> None:
    assert runner.relative_agent_path("/workspace/src/app.py", tmp_path, "docker") == "src/app.py"


def test_resolve_working_directory_stays_inside_workspace(tmp_path: Path) -> None:
    child = tmp_path / "packages" / "app"
    child.mkdir(parents=True)
    local, docker = runner.resolve_working_directory(tmp_path, "packages/app")
    assert local == child.resolve()
    assert docker == "/workspace/packages/app"


def test_resolve_working_directory_rejects_parent_escape(tmp_path: Path) -> None:
    import pytest

    with pytest.raises(ValueError, match="stay inside"):
        runner.resolve_working_directory(tmp_path, "../outside")


def test_terminal_side_effects_are_detected(tmp_path: Path, monkeypatch) -> None:
    subprocess.run(["git", "init", "--quiet"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.name", "MeshCLI Test"], cwd=tmp_path, check=True)
    subprocess.run(
        ["git", "config", "user.email", "meshcli@example.invalid"],
        cwd=tmp_path,
        check=True,
    )
    target = tmp_path / "tracked.txt"
    target.write_text("before\n", encoding="utf-8")
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "fixture"], cwd=tmp_path, check=True)
    target.write_text("after\n", encoding="utf-8")

    events: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(runner, "emit", lambda kind, payload: events.append((kind, payload)))
    mapper = runner.EventMapper(tmp_path, "local")
    mapper.detect_changed_files()
    mapper.detect_changed_files()

    assert events == [("file_changed", {"path": "tracked.txt", "operation": "detected"})]
