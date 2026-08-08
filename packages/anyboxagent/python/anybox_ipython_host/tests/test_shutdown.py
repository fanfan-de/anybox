from __future__ import annotations

import io
import json
import subprocess
import sys
import threading
import unittest
from pathlib import Path
from unittest import mock

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE_ROOT))

from anybox_ipython_host import kernel  # noqa: E402
from anybox_ipython_host.protocol import JsonLineWriter  # noqa: E402


class FakeProcess:
    def __init__(self, *, pid: int = 987_654, kill_succeeds: bool = True) -> None:
        self.pid = pid
        self.alive = True
        self.kill_succeeds = kill_succeeds
        self.kill_calls = 0

    def poll(self) -> int | None:
        return None if self.alive else -9

    def kill(self) -> None:
        self.kill_calls += 1
        if self.kill_succeeds:
            self.alive = False
        else:
            raise OSError("simulated process kill failure")

    def wait(self, timeout: float | None = None) -> int:
        if self.alive:
            raise subprocess.TimeoutExpired("fake-kernel", timeout)
        return -9


class FakeProvisioner:
    def __init__(self, process: FakeProcess) -> None:
        self.process = process
        self.pid = process.pid


class FakeManager:
    def __init__(
        self,
        process: FakeProcess,
        *,
        managed_shutdown: str = "success",
        events: list[str] | None = None,
    ) -> None:
        self.provisioner = FakeProvisioner(process)
        self.process = process
        self.managed_shutdown = managed_shutdown
        self.interrupt_calls = 0
        self.shutdown_calls = 0
        self.release_hang = threading.Event()
        self.events = events

    def interrupt_kernel(self) -> None:
        self.interrupt_calls += 1

    def shutdown_kernel(self, *, now: bool) -> None:
        self.shutdown_calls += 1
        if self.events is not None:
            self.events.append("manager")
        if self.managed_shutdown == "failure":
            raise RuntimeError("simulated managed shutdown failure")
        if self.managed_shutdown == "hang":
            self.release_hang.wait(timeout=5)
            return
        self.process.alive = False


class FakeClient:
    def __init__(self) -> None:
        self.stop_calls = 0

    def stop_channels(self) -> None:
        self.stop_calls += 1


class ShutdownTests(unittest.TestCase):
    def make_host(
        self,
        process: FakeProcess,
        *,
        managed_shutdown: str,
        events: list[str] | None = None,
    ) -> tuple[kernel.KernelHost, FakeManager, FakeClient, io.StringIO]:
        stream = io.StringIO()
        host = kernel.KernelHost(JsonLineWriter(stream))
        manager = FakeManager(
            process,
            managed_shutdown=managed_shutdown,
            events=events,
        )
        client = FakeClient()
        host._manager = manager  # type: ignore[assignment]
        host._client = client
        host._remember_kernel_process(manager)  # type: ignore[arg-type]
        return host, manager, client, stream

    def timing(self) -> mock._patch:
        return mock.patch.multiple(
            kernel,
            ACTIVE_INTERRUPT_GRACE_SECONDS=0.02,
            MANAGED_SHUTDOWN_GRACE_SECONDS=0.02,
            FALLBACK_KILL_GRACE_SECONDS=0.02,
        )

    @staticmethod
    def configure_taskkill(
        run: mock.Mock,
        process: FakeProcess,
        *,
        succeeds: bool = True,
        events: list[str] | None = None,
    ) -> None:
        def taskkill(args: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            if events is not None:
                events.append("taskkill")
            if succeeds:
                process.alive = False
            return subprocess.CompletedProcess(args, 0 if succeeds else 1)

        run.side_effect = taskkill

    @mock.patch.object(kernel.subprocess, "run")
    def test_fallback_kill_is_confirmed_before_shutdown_ack(self, run: mock.Mock) -> None:
        process = FakeProcess()
        host, manager, client, stream = self.make_host(
            process,
            managed_shutdown="failure",
        )
        self.configure_taskkill(run, process)

        with self.timing():
            host.shutdown("shutdown-1")

        self.assertEqual(process.kill_calls, 0 if sys.platform == "win32" else 1)
        self.assertFalse(process.alive)
        self.assertEqual(client.stop_calls, 1)
        self.assertIsNone(host.kernel_pid)
        self.assertIsNone(host._manager)
        event = json.loads(stream.getvalue())
        self.assertEqual(event["type"], "shutdown")
        self.assertEqual(event["requestId"], "shutdown-1")
        self.assertEqual(manager.shutdown_calls, 1)
        if sys.platform == "win32":
            run.assert_called_once()

    @mock.patch.object(kernel.subprocess, "run")
    def test_failed_fallback_retains_handles_and_does_not_ack(self, run: mock.Mock) -> None:
        process = FakeProcess(kill_succeeds=False)
        host, manager, _, stream = self.make_host(
            process,
            managed_shutdown="failure",
        )
        self.configure_taskkill(run, process, succeeds=False)

        with self.timing(), self.assertRaises(kernel.KernelShutdownError):
            host.shutdown("shutdown-2")

        self.assertEqual(stream.getvalue(), "")
        self.assertIs(host._manager, manager)
        self.assertEqual(host.kernel_pid, process.pid)
        self.assertFalse(host._shutdown_complete.is_set())
        if sys.platform == "win32":
            run.assert_called_once()

    @mock.patch.object(kernel.subprocess, "run")
    def test_hung_managed_shutdown_uses_bounded_fallback(self, run: mock.Mock) -> None:
        process = FakeProcess()
        host, manager, _, stream = self.make_host(process, managed_shutdown="hang")
        self.configure_taskkill(run, process)

        try:
            with self.timing():
                host.shutdown("shutdown-hung")
        finally:
            manager.release_hang.set()

        self.assertFalse(process.alive)
        self.assertEqual(process.kill_calls, 0 if sys.platform == "win32" else 1)
        self.assertEqual(json.loads(stream.getvalue())["type"], "shutdown")
        if sys.platform == "win32":
            run.assert_called_once()

    @mock.patch.object(kernel.subprocess, "run")
    def test_shutdown_interrupts_active_execution_before_killing_kernel(self, run: mock.Mock) -> None:
        process = FakeProcess()
        host, manager, _, _ = self.make_host(process, managed_shutdown="success")
        self.configure_taskkill(run, process)
        interrupt_requested = threading.Event()
        active_thread = threading.Thread(
            target=lambda: interrupt_requested.wait(timeout=1),
            daemon=True,
        )
        active_thread.start()
        host._active = kernel.ActiveExecution(
            request_id="cell-1",
            thread=active_thread,
            interrupt_requested=interrupt_requested,
        )

        with self.timing():
            host.shutdown("shutdown-active")

        self.assertTrue(interrupt_requested.is_set())
        self.assertGreaterEqual(manager.interrupt_calls, 1)
        active_thread.join(timeout=1)
        self.assertFalse(active_thread.is_alive())
        if sys.platform == "win32":
            run.assert_called_once()
        else:
            run.assert_not_called()

    @mock.patch.object(kernel.subprocess, "run")
    def test_windows_kills_tree_before_manager_cleanup(self, run: mock.Mock) -> None:
        events: list[str] = []
        process = FakeProcess()
        host, _, _, _ = self.make_host(
            process,
            managed_shutdown="success",
            events=events,
        )
        self.configure_taskkill(run, process, events=events)

        with mock.patch.object(kernel.os, "name", "nt"), self.timing():
            host.shutdown("shutdown-order")

        self.assertEqual(events, ["taskkill", "manager"])

    @mock.patch.object(kernel.subprocess, "run")
    def test_windows_taskkill_has_time_to_confirm_the_process_tree(self, run: mock.Mock) -> None:
        run.return_value = subprocess.CompletedProcess([], 0)

        self.assertEqual(kernel.KernelHost._kill_windows_kernel_tree(12345), [])

        self.assertEqual(
            run.call_args.kwargs["timeout"],
            kernel.FALLBACK_KILL_COMMAND_TIMEOUT_SECONDS,
        )
        self.assertGreaterEqual(kernel.FALLBACK_KILL_COMMAND_TIMEOUT_SECONDS, 2.0)


if __name__ == "__main__":
    unittest.main()
