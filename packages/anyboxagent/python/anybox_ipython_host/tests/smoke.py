"""End-to-end smoke test for the private JSONL host and a real ipykernel."""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

import psutil

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = PACKAGE_ROOT / "src"
PROTOCOL_VERSION = 1


def resolve_host_python() -> str:
    repository_root = PACKAGE_ROOT.parents[3]
    managed_python = (
        repository_root / "packages" / "desktop" / "build" / "agent-runtime"
        / "dependencies" / "python"
        / ("python.exe" if os.name == "nt" else "bin/python3")
    )
    candidates = [
        os.environ.get("ANYBOX_IPYTHON_TEST_PYTHON"),
        sys.executable,
        str(managed_python),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        probe = subprocess.run(
            [
                candidate,
                "-I",
                "-c",
                "import IPython, ipykernel, jupyter_client, zmq",
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if probe.returncode == 0:
            return candidate
    raise RuntimeError(
        "No Python interpreter with isolated IPython dependencies is available; "
        "set ANYBOX_IPYTHON_TEST_PYTHON to the managed Python executable."
    )


HOST_PYTHON = resolve_host_python()


def host_command() -> list[str]:
    return [
        HOST_PYTHON,
        "-I",
        "-u",
        "-c",
        "; ".join(
            [
                "import runpy, sys",
                "source_root = sys.argv[1]",
                "sys.argv = ['anybox_ipython_host']",
                "sys.path.insert(0, source_root)",
                "runpy.run_module('anybox_ipython_host', run_name='__main__')",
            ]
        ),
        str(SOURCE_ROOT),
    ]


def install_workspace_startup_traps(workspace: str) -> Path:
    marker = Path(workspace) / "startup-module-hijacked.txt"
    payload = (
        "from pathlib import Path\n"
        f"Path({str(marker)!r}).write_text('hijacked', encoding='utf-8')\n"
        "raise RuntimeError('workspace module hijacked kernel startup')\n"
    )
    for filename in ("IPython.py", "ipykernel_launcher.py"):
        (Path(workspace) / filename).write_text(payload, encoding="utf-8")
    (Path(workspace) / "anybox_workspace_probe.py").write_text(
        "VALUE = 2\n",
        encoding="utf-8",
    )
    return marker


class EventReader:
    def __init__(self, stream: Any) -> None:
        self._events: queue.Queue[dict[str, Any]] = queue.Queue()
        self._thread = threading.Thread(target=self._read, args=(stream,), daemon=True)
        self._thread.start()

    def _read(self, stream: Any) -> None:
        for line in stream:
            if line.strip():
                self._events.put(json.loads(line))

    def next(self, process: subprocess.Popen[str], timeout: float = 20) -> dict[str, Any]:
        try:
            event = self._events.get(timeout=timeout)
        except queue.Empty as error:
            exit_code = process.poll()
            diagnostics = ""
            if exit_code is not None and process.stderr is not None:
                diagnostics = process.stderr.read().strip()
            raise AssertionError(
                f"timed out waiting for host event (exit={exit_code}): {diagnostics or 'no diagnostics'}"
            ) from error
        if event.get("type") == "fatal":
            raise AssertionError(f"host emitted fatal event: {event}")
        return event


def send(process: subprocess.Popen[str], event_type: str, **payload: Any) -> None:
    assert process.stdin is not None
    process.stdin.write(
        json.dumps(
            {"type": event_type, "protocolVersion": PROTOCOL_VERSION, **payload},
            separators=(",", ":"),
        )
        + "\n"
    )
    process.stdin.flush()


def collect_cell(
    reader: EventReader,
    process: subprocess.Popen[str],
    request_id: str,
    timeout: float = 15,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        event = reader.next(process, max(0.1, deadline - time.monotonic()))
        if event.get("requestId") != request_id:
            continue
        events.append(event)
        if event.get("type") == "idle":
            return events
    raise AssertionError(f"cell {request_id} did not become idle: {events}")


def assert_pid_exits(pid: int, timeout: float = 5) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not psutil.pid_exists(pid):
            return
        time.sleep(0.05)
    raise AssertionError(f"kernel PID {pid} remained alive after host shutdown")


def run() -> None:
    env = os.environ.copy()
    with tempfile.TemporaryDirectory(prefix="anybox-ipython-") as workspace:
        startup_hijack_marker = install_workspace_startup_traps(workspace)
        process = subprocess.Popen(
            host_command(),
            cwd=workspace,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )
        assert process.stdout is not None
        reader = EventReader(process.stdout)
        kernel_pid = 0
        background_pid = 0
        try:
            started = reader.next(process)
            assert started["type"] == "kernel_started", started
            assert started["protocolVersion"] == PROTOCOL_VERSION, started
            assert isinstance(started.get("kernelPid"), int), started
            kernel_pid = started["kernelPid"]

            ready = reader.next(process)
            assert ready["type"] == "ready", ready
            assert ready["protocolVersion"] == PROTOCOL_VERSION, ready
            assert ready.get("kernelPid") == kernel_pid, ready
            assert not startup_hijack_marker.exists(), startup_hijack_marker

            send(process, "probe", requestId="probe-1")
            probe = reader.next(process)
            assert probe["type"] == "probe" and probe["kernelAlive"], probe

            send(
                process,
                "execute",
                requestId="cell-1",
                code=(
                    "import anybox_workspace_probe\n"
                    "print('hello from ipython')\n"
                    "anybox_workspace_probe.VALUE"
                ),
                maxOutputChars=10_000,
            )
            first = collect_cell(reader, process, "cell-1")
            assert any(
                event.get("type") == "stream" and "hello from ipython" in event.get("text", "")
                for event in first
            ), first
            assert any(
                event.get("type") == "result" and event.get("text") == "2"
                for event in first
            ), first
            assert not startup_hijack_marker.exists(), startup_hijack_marker

            send(process, "execute", requestId="cell-2", code="value = 40")
            collect_cell(reader, process, "cell-2")
            send(process, "execute", requestId="cell-3", code="value + 2")
            third = collect_cell(reader, process, "cell-3")
            assert any(
                event.get("type") == "result" and event.get("text") == "42"
                for event in third
            ), third

            send(
                process,
                "execute",
                requestId="cell-long-error",
                code="raise ValueError('x' * 5000)",
                maxOutputChars=256,
            )
            long_error = collect_cell(reader, process, "cell-long-error")
            error_events = [event for event in long_error if event.get("type") == "error"]
            assert len(error_events) == 1, long_error
            assert error_events[0].get("ename") == "ValueError", error_events
            assert any(
                event.get("type") == "idle" and event.get("truncated") is True
                for event in long_error
            ), long_error

            display_started = time.monotonic()
            send(
                process,
                "execute",
                requestId="cell-many-displays",
                code=(
                    "from IPython.display import display\n"
                    "for display_index in range(300):\n"
                    "    display(display_index)"
                ),
                maxOutputChars=20_000,
            )
            many_displays = collect_cell(
                reader,
                process,
                "cell-many-displays",
                timeout=15,
            )
            assert sum(
                event.get("type") == "display" for event in many_displays
            ) == 300, many_displays
            assert time.monotonic() - display_started < 10, "display draining was unexpectedly slow"

            send(
                process,
                "execute",
                requestId="cell-event-budget",
                code=(
                    "from IPython.display import display\n"
                    "display({'text/plain': ''}, raw=True)\n"
                    "for event_index in range(2200):\n"
                    "    display(event_index)\n"
                    "raise RuntimeError('after event budget')"
                ),
                maxOutputChars=1_000_000,
            )
            bounded_events = collect_cell(
                reader,
                process,
                "cell-event-budget",
                timeout=20,
            )
            display_events = [
                event for event in bounded_events if event.get("type") == "display"
            ]
            assert len(display_events) == 2048, len(display_events)
            assert all(event.get("data") for event in display_events), display_events
            assert sum(
                event.get("type") == "error"
                and event.get("ename") == "RuntimeError"
                for event in bounded_events
            ) == 1, bounded_events[-5:]
            assert any(
                event.get("type") == "idle" and event.get("truncated") is True
                for event in bounded_events
            ), bounded_events[-5:]

            send(process, "execute", requestId="cell-4", code="while True:\n    pass")
            send(process, "interrupt", requestId="cell-4")
            interrupted = collect_cell(reader, process, "cell-4")
            assert any(event.get("type") == "interrupted" for event in interrupted), interrupted
            assert any(
                event.get("type") == "error" and event.get("ename") == "KeyboardInterrupt"
                for event in interrupted
            ), interrupted

            send(process, "execute", requestId="cell-5", code="'still alive'")
            fifth = collect_cell(reader, process, "cell-5")
            assert any(
                event.get("type") == "result" and event.get("text") == "'still alive'"
                for event in fifth
            ), fifth

            send(
                process,
                "execute",
                requestId="cell-background",
                code=(
                    "import subprocess, sys\n"
                    "anybox_background = subprocess.Popen("
                    "[sys.executable, '-c', 'import time; time.sleep(60)'])\n"
                    "print(anybox_background.pid, flush=True)"
                ),
            )
            background = collect_cell(reader, process, "cell-background")
            background_text = "".join(
                event.get("text", "")
                for event in background
                if event.get("type") == "stream"
            ).strip()
            assert background_text.isdigit(), background
            background_pid = int(background_text)
            assert psutil.pid_exists(background_pid), background_pid

            send(process, "shutdown", requestId="shutdown-1")
            shutdown = reader.next(process)
            assert shutdown["type"] == "shutdown", shutdown
            assert process.wait(timeout=10) == 0
        finally:
            if process.poll() is None:
                try:
                    send(process, "shutdown", requestId="cleanup")
                    process.wait(timeout=3)
                except BaseException:
                    process.kill()
                    process.wait(timeout=3)

        if process.returncode != 0:
            assert process.stderr is not None
            raise AssertionError(process.stderr.read())
        assert_pid_exits(kernel_pid)
        assert_pid_exits(background_pid)
        assert not startup_hijack_marker.exists(), startup_hijack_marker


def run_active_shutdown() -> None:
    env = os.environ.copy()
    with tempfile.TemporaryDirectory(prefix="anybox-ipython-active-shutdown-") as workspace:
        process = subprocess.Popen(
            host_command(),
            cwd=workspace,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )
        assert process.stdout is not None
        reader = EventReader(process.stdout)
        kernel_pid = 0
        try:
            started = reader.next(process)
            assert started["type"] == "kernel_started", started
            kernel_pid = started["kernelPid"]
            ready = reader.next(process)
            assert ready["type"] == "ready", ready
            assert ready.get("kernelPid") == kernel_pid, ready

            send(process, "execute", requestId="active-cell", code="while True:\n    pass")
            time.sleep(0.25)
            send(process, "shutdown", requestId="active-shutdown")

            deadline = time.monotonic() + 8
            shutdown = None
            while time.monotonic() < deadline:
                event = reader.next(process, max(0.1, deadline - time.monotonic()))
                if event.get("type") == "shutdown" and event.get("requestId") == "active-shutdown":
                    shutdown = event
                    break
            assert shutdown is not None, "active execution shutdown was not acknowledged"
            assert process.wait(timeout=5) == 0
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=3)

        if process.returncode != 0:
            assert process.stderr is not None
            raise AssertionError(process.stderr.read())
        assert_pid_exits(kernel_pid)


if __name__ == "__main__":
    run()
    run_active_shutdown()
    print("anybox-ipython-host smoke passed")
