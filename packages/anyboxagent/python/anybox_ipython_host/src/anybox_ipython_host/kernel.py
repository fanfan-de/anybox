"""Persistent ipykernel process and JSON-lines command loop."""

from __future__ import annotations

import json
import logging
import os
import queue
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any

import IPython
import ipykernel
import jupyter_client
import zmq
from jupyter_client import KernelManager

from . import HOST_VERSION, PROTOCOL_VERSION
from .protocol import (
    JsonLineWriter,
    ProtocolError,
    TextBudget,
    require_code,
    require_request,
    require_request_id,
)

LOGGER = logging.getLogger("anybox_ipython_host")
KERNEL_START_TIMEOUT_SECONDS = 15
KERNEL_BOOTSTRAP_TIMEOUT_SECONDS = 5
CHANNEL_POLL_SECONDS = 0.1
ACTIVE_INTERRUPT_GRACE_SECONDS = 0.5
MANAGED_SHUTDOWN_GRACE_SECONDS = 1.5
FALLBACK_KILL_COMMAND_TIMEOUT_SECONDS = 0.5
FALLBACK_KILL_GRACE_SECONDS = 1.0


class KernelShutdownError(RuntimeError):
    """Raised when the host cannot confirm that its ipykernel exited."""


class AnyboxKernelManager(KernelManager):
    """Force the kernel to use the exact Python interpreter hosting this process."""

    def format_kernel_cmd(self, extra_arguments: list[str] | None = None) -> list[str]:
        command = [
            sys.executable,
            "-I",
            "-m",
            "ipykernel_launcher",
            "-f",
            os.path.realpath(self.connection_file),
        ]
        return command + list(extra_arguments or [])


@dataclass(slots=True)
class ActiveExecution:
    request_id: str
    thread: threading.Thread
    interrupt_requested: threading.Event


class KernelHost:
    def __init__(self, writer: JsonLineWriter) -> None:
        self._writer = writer
        self._manager: AnyboxKernelManager | None = None
        self._client: Any | None = None
        self._kernel_process: Any | None = None
        self._kernel_pid: int | None = None
        self._active: ActiveExecution | None = None
        self._state_lock = threading.Lock()
        self._shutdown_lock = threading.Lock()
        self._closing = threading.Event()
        self._shutdown_complete = threading.Event()

    @property
    def kernel_pid(self) -> int | None:
        return self._kernel_pid

    def start(self) -> None:
        manager = AnyboxKernelManager(kernel_name="python3")
        try:
            manager.start_kernel(
                cwd=os.getcwd(),
                stdout=sys.stderr,
                stderr=sys.stderr,
            )
            self._manager = manager
            self._remember_kernel_process(manager)
            if self.kernel_pid is None:
                raise RuntimeError("unable to determine the started IPython kernel PID")
            # Publish the PID before waiting for kernel readiness/bootstrap so
            # the controller can still reap the process tree if startup hangs
            # or the host is force-terminated during this window.
            self._writer.emit("kernel_started", kernelPid=self.kernel_pid)
            client = manager.client()
            self._client = client
            client.start_channels()
            client.wait_for_ready(timeout=KERNEL_START_TIMEOUT_SECONDS)
            self._bootstrap_workspace_import_path(client)
        except BaseException:
            try:
                self._shutdown_kernel_bounded(manager)
            except BaseException:
                LOGGER.exception("failed to clean up a partially started kernel")
            raise

        self._writer.emit(
            "ready",
            hostVersion=HOST_VERSION,
            pythonVersion=sys.version.split()[0],
            ipythonVersion=IPython.__version__,
            ipykernelVersion=ipykernel.__version__,
            jupyterClientVersion=jupyter_client.__version__,
            pyzmqVersion=zmq.__version__,
            kernelPid=self.kernel_pid,
        )

    @staticmethod
    def _bootstrap_workspace_import_path(client: Any) -> None:
        """Restore local-module imports only after isolated kernel startup.

        ``-I`` keeps the workspace off ``sys.path`` while Python, IPython, and
        ipykernel are imported.  Once that trusted startup has completed, add
        the workspace at the end of the import path so approved cells can
        still import project modules without letting same-named workspace
        files replace runtime dependencies during kernel initialization.
        """

        message_id = client.execute(
            "import os as _anybox_os, sys as _anybox_sys\n"
            "_anybox_workspace = _anybox_os.getcwd()\n"
            "if _anybox_workspace not in _anybox_sys.path:\n"
            "    _anybox_sys.path.append(_anybox_workspace)\n"
            "del _anybox_workspace, _anybox_os, _anybox_sys",
            silent=True,
            store_history=False,
            allow_stdin=False,
            stop_on_error=True,
        )
        deadline = time.monotonic() + KERNEL_BOOTSTRAP_TIMEOUT_SECONDS

        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("timed out restoring the workspace import path")
            try:
                shell_reply = client.get_shell_msg(timeout=remaining)
            except queue.Empty as error:
                raise TimeoutError(
                    "timed out restoring the workspace import path"
                ) from error
            if not KernelHost._belongs_to(shell_reply, message_id):
                continue
            content = shell_reply.get("content", {})
            if content.get("status") != "ok":
                detail = content.get("evalue") or content.get("status") or "unknown error"
                raise RuntimeError(
                    f"failed to restore the workspace import path: {detail}"
                )
            break

        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(
                    "timed out waiting for workspace import bootstrap to become idle"
                )
            try:
                iopub_message = client.get_iopub_msg(timeout=remaining)
            except queue.Empty as error:
                raise TimeoutError(
                    "timed out waiting for workspace import bootstrap to become idle"
                ) from error
            if not KernelHost._belongs_to(iopub_message, message_id):
                continue
            message_type = iopub_message.get("msg_type") or iopub_message.get(
                "header", {}
            ).get("msg_type")
            if (
                message_type == "status"
                and iopub_message.get("content", {}).get("execution_state") == "idle"
            ):
                break

    def emit_probe(self, request_id: object = None) -> None:
        payload: dict[str, Any] = {
            "hostVersion": HOST_VERSION,
            "pythonVersion": sys.version.split()[0],
            "pythonExecutable": sys.executable,
            "ipythonVersion": IPython.__version__,
            "ipykernelVersion": ipykernel.__version__,
            "jupyterClientVersion": jupyter_client.__version__,
            "pyzmqVersion": zmq.__version__,
            "kernelPid": self.kernel_pid,
            "kernelAlive": bool(self._manager and self._manager.is_alive()),
        }
        if isinstance(request_id, str) and request_id:
            payload["requestId"] = request_id
        self._writer.emit("probe", **payload)

    def execute(self, request: dict[str, Any]) -> None:
        request_id = require_request_id(request)
        code = require_code(request)
        budget = TextBudget.from_request(request.get("maxOutputChars"))

        with self._state_lock:
            if self._closing.is_set():
                raise ProtocolError("host is shutting down")
            if self._active is not None:
                raise ProtocolError(
                    f"kernel is already executing request {self._active.request_id!r}"
                )
            interrupt_requested = threading.Event()
            thread = threading.Thread(
                target=self._execute_cell,
                args=(request_id, code, budget, interrupt_requested),
                name=f"anybox-ipython-{request_id[:32]}",
                daemon=True,
            )
            self._active = ActiveExecution(
                request_id=request_id,
                thread=thread,
                interrupt_requested=interrupt_requested,
            )
            thread.start()

    def interrupt(self, request_id: str) -> None:
        manager = self._manager
        if manager is None:
            raise ProtocolError("kernel has not started")

        with self._state_lock:
            active = self._active
            if active is not None and active.request_id == request_id:
                active.interrupt_requested.set()
        if active is not None and active.request_id == request_id:
            manager.interrupt_kernel()
        self._writer.emit("interrupted", requestId=request_id)

    def shutdown(self, request_id: object = None, *, emit: bool = True) -> None:
        with self._shutdown_lock:
            if self._shutdown_complete.is_set():
                if emit:
                    self._emit_shutdown(request_id)
                return
            self._closing.set()

            with self._state_lock:
                active = self._active
                if active is not None:
                    active.interrupt_requested.set()
            if active is not None and active.thread.is_alive():
                try:
                    if self._manager is not None:
                        self._manager.interrupt_kernel()
                except BaseException:
                    LOGGER.exception("failed to interrupt active kernel during shutdown")
                active.thread.join(timeout=ACTIVE_INTERRUPT_GRACE_SECONDS)

            manager = self._manager
            client = self._client
            try:
                if manager is not None or self._kernel_process is not None or self._kernel_pid is not None:
                    self._shutdown_kernel_bounded(manager)
            except BaseException:
                # Keep manager/process/PID references intact so the caller can
                # report the failure and a later cleanup attempt can retry.
                raise

            try:
                if client is not None:
                    client.stop_channels()
            except BaseException:
                LOGGER.exception("failed to stop Jupyter channels")

            if active is not None and active.thread.is_alive():
                active.thread.join(timeout=ACTIVE_INTERRUPT_GRACE_SECONDS)

            self._client = None
            self._manager = None
            self._kernel_process = None
            self._kernel_pid = None
            self._shutdown_complete.set()
            if emit:
                self._emit_shutdown(request_id)

    def _emit_shutdown(self, request_id: object) -> None:
        payload = {}
        if isinstance(request_id, str) and request_id:
            payload["requestId"] = request_id
        self._writer.emit("shutdown", **payload)

    def _remember_kernel_process(self, manager: AnyboxKernelManager) -> None:
        provisioner = manager.provisioner
        process = getattr(provisioner, "process", None) if provisioner is not None else None
        pid = getattr(provisioner, "pid", None) if provisioner is not None else None
        if not isinstance(pid, int) and process is not None:
            process_pid = getattr(process, "pid", None)
            pid = process_pid if isinstance(process_pid, int) else None
        self._kernel_process = process
        self._kernel_pid = pid if isinstance(pid, int) else None

    def _shutdown_kernel_bounded(self, manager: AnyboxKernelManager | None) -> None:
        process = self._kernel_process
        pid = self._kernel_pid

        # On Windows, descendants can inherit the kernel's copy of the host's
        # stderr pipe. Killing only the kernel first detaches those descendants
        # from its process tree and prevents the host pipe from ever closing.
        # taskkill must therefore snapshot and terminate the tree while the
        # kernel parent is still alive, before KernelManager kills that parent.
        if os.name == "nt" and pid is not None and not self._kernel_has_exited(process, pid):
            tree_errors = self._kill_windows_kernel_tree(pid)
            tree_exited = self._wait_for_kernel_exit(
                process,
                pid,
                FALLBACK_KILL_GRACE_SECONDS,
            )
            if tree_errors or not tree_exited:
                details = [str(error) for error in tree_errors if str(error)]
                suffix = f" ({'; '.join(details)})" if details else ""
                raise KernelShutdownError(
                    f"Unable to confirm that IPython kernel tree PID {pid} exited{suffix}"
                )

            manager_errors, _ = self._run_managed_shutdown(manager)
            if manager_errors:
                LOGGER.warning(
                    "kernel tree exited but manager cleanup failed: %s",
                    manager_errors[-1],
                )
            return

        manager_errors, manager_finished = self._run_managed_shutdown(manager)

        if process is None and pid is None:
            if manager is None or (manager_finished and not manager_errors):
                return
            details = f": {manager_errors[-1]}" if manager_errors else ""
            raise KernelShutdownError(
                f"Unable to confirm that the IPython kernel exited{details}"
            )

        if self._kernel_has_exited(process, pid):
            return

        fallback_errors = self._force_kill_kernel(process, pid)
        if self._wait_for_kernel_exit(process, pid, FALLBACK_KILL_GRACE_SECONDS):
            if manager_errors:
                LOGGER.warning(
                    "managed kernel shutdown failed; fallback kill succeeded: %s",
                    manager_errors[-1],
                )
            return

        details = [str(error) for error in [*manager_errors, *fallback_errors] if str(error)]
        suffix = f" ({'; '.join(details)})" if details else ""
        raise KernelShutdownError(
            f"Unable to confirm that IPython kernel PID {pid or 'unknown'} exited{suffix}"
        )

    @staticmethod
    def _run_managed_shutdown(
        manager: AnyboxKernelManager | None,
    ) -> tuple[list[BaseException], bool]:
        manager_errors: list[BaseException] = []
        manager_finished = threading.Event()

        if manager is not None:
            def managed_shutdown() -> None:
                try:
                    manager.shutdown_kernel(now=True)
                except BaseException as error:
                    manager_errors.append(error)
                finally:
                    manager_finished.set()

            thread = threading.Thread(
                target=managed_shutdown,
                name="anybox-ipython-shutdown",
                daemon=True,
            )
            thread.start()
            manager_finished.wait(timeout=MANAGED_SHUTDOWN_GRACE_SECONDS)
        return manager_errors, manager_finished.is_set()

    @staticmethod
    def _kill_windows_kernel_tree(pid: int) -> list[BaseException]:
        try:
            result = subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=FALLBACK_KILL_COMMAND_TIMEOUT_SECONDS,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except BaseException as error:
            return [error]
        if result.returncode != 0:
            return [RuntimeError(f"taskkill exited with status {result.returncode}")]
        return []

    @staticmethod
    def _kernel_has_exited(process: Any | None, pid: int | None) -> bool:
        if process is not None:
            try:
                return process.poll() is not None
            except BaseException:
                return False
        if pid is None:
            return True
        return not KernelHost._pid_is_alive(pid)

    @staticmethod
    def _wait_for_kernel_exit(
        process: Any | None,
        pid: int | None,
        timeout: float,
    ) -> bool:
        deadline = time.monotonic() + max(0, timeout)
        while True:
            if KernelHost._kernel_has_exited(process, pid):
                if process is not None:
                    try:
                        process.wait(timeout=0)
                    except BaseException:
                        pass
                return True
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            time.sleep(min(0.05, remaining))

    @staticmethod
    def _force_kill_kernel(process: Any | None, pid: int | None) -> list[BaseException]:
        errors: list[BaseException] = []
        if pid is not None and os.name != "nt":
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except BaseException as error:
                errors.append(error)

        if process is not None and not KernelHost._kernel_has_exited(process, pid):
            try:
                process.kill()
            except BaseException as error:
                errors.append(error)
        elif process is None and pid is not None and os.name != "nt":
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except BaseException as error:
                errors.append(error)
        return errors

    @staticmethod
    def _pid_is_alive(pid: int) -> bool:
        if os.name != "nt":
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return False
            except PermissionError:
                return True
            return True

        try:
            import ctypes
            from ctypes import wintypes

            process_query_limited_information = 0x1000
            still_active = 259
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel32.OpenProcess.restype = wintypes.HANDLE
            kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
            kernel32.GetExitCodeProcess.restype = wintypes.BOOL
            kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel32.CloseHandle.restype = wintypes.BOOL
            handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
            if not handle:
                return ctypes.get_last_error() == 5
            try:
                exit_code = wintypes.DWORD()
                if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                    return True
                return exit_code.value == still_active
            finally:
                kernel32.CloseHandle(handle)
        except BaseException:
            # Failure to inspect is treated as alive so shutdown cannot claim
            # success without evidence.
            return True

    def _execute_cell(
        self,
        request_id: str,
        code: str,
        budget: TextBudget,
        interrupt_requested: threading.Event,
    ) -> None:
        started_at = time.monotonic()
        execution_count: int | None = None
        shell_reply_received = False
        idle_received = False
        error_emitted = False
        interrupt_delivered_after_busy = False
        client = self._client
        if client is None:
            self._writer.emit(
                "fatal",
                requestId=request_id,
                message="Jupyter client is unavailable",
            )
            self._clear_active(request_id)
            return

        try:
            message_id = client.execute(
                code,
                silent=False,
                # Anybox owns transcript persistence. Avoid copying model-generated
                # code into IPython's on-disk history.sqlite database.
                store_history=False,
                allow_stdin=False,
                stop_on_error=False,
            )
            # An interrupt can race with client.execute(). Re-send it after the
            # execute request has entered the kernel so an immediate cancellation
            # cannot be lost while the kernel is still idle.
            if interrupt_requested.is_set() and self._manager is not None:
                self._manager.interrupt_kernel()

            while not (shell_reply_received and idle_received):
                if not shell_reply_received:
                    shell_reply = self._poll_channel(client.get_shell_msg)
                    if self._belongs_to(shell_reply, message_id):
                        shell_reply_received = True
                        content = shell_reply.get("content", {})
                        execution_count = self._as_execution_count(
                            content.get("execution_count"), execution_count
                        )
                        if content.get("status") == "error" and not error_emitted:
                            self._emit_error(request_id, content, budget, execution_count)
                            error_emitted = True

                iopub_messages: list[dict[str, Any]] = []
                first_iopub = self._poll_channel(client.get_iopub_msg)
                if first_iopub is not None:
                    iopub_messages.append(first_iopub)
                # Drain messages already queued so rich output scales with the
                # producer instead of paying one 100ms shell poll per display.
                for _ in range(255):
                    queued_iopub = self._poll_channel(client.get_iopub_msg, timeout=0)
                    if queued_iopub is None:
                        break
                    iopub_messages.append(queued_iopub)

                for iopub_message in iopub_messages:
                    if not self._belongs_to(iopub_message, message_id):
                        continue
                    message_type = iopub_message.get("msg_type") or iopub_message.get("header", {}).get("msg_type")
                    content = iopub_message.get("content", {})

                    if message_type == "status":
                        execution_state = content.get("execution_state")
                        if execution_state == "busy" and interrupt_requested.is_set():
                            if not interrupt_delivered_after_busy and self._manager is not None:
                                self._manager.interrupt_kernel()
                                interrupt_delivered_after_busy = True
                        if execution_state == "idle":
                            idle_received = True
                        continue
                    if message_type == "execute_input":
                        execution_count = self._as_execution_count(
                            content.get("execution_count"), execution_count
                        )
                        if interrupt_requested.is_set() and not interrupt_delivered_after_busy:
                            if self._manager is not None:
                                self._manager.interrupt_kernel()
                                interrupt_delivered_after_busy = True
                        continue
                    if message_type == "stream":
                        text, clipped = budget.take_event(content.get("text", ""))
                        if text:
                            self._writer.emit(
                                "stream",
                                requestId=request_id,
                                name="stderr" if content.get("name") == "stderr" else "stdout",
                                text=text,
                                truncated=clipped or None,
                            )
                        continue
                    if message_type in {"execute_result", "display_data"}:
                        text_value = content.get("data", {}).get("text/plain")
                        if text_value is None:
                            continue
                        text, clipped = budget.take_event(text_value)
                        if message_type == "execute_result":
                            execution_count = self._as_execution_count(
                                content.get("execution_count"), execution_count
                            )
                            if text:
                                self._writer.emit(
                                    "result",
                                    requestId=request_id,
                                    text=text,
                                    executionCount=execution_count,
                                    truncated=clipped or None,
                                )
                        elif text:
                            self._writer.emit(
                                "display",
                                requestId=request_id,
                                mime="text/plain",
                                data=text,
                                truncated=clipped or None,
                            )
                        continue
                    if message_type == "error":
                        execution_count = self._as_execution_count(
                            content.get("execution_count"), execution_count
                        )
                        if not error_emitted:
                            self._emit_error(request_id, content, budget, execution_count)
                            error_emitted = True

            # Clear the active marker before idle. The controller serializes cells by
            # waiting for idle and may enqueue the next cell immediately afterwards.
            self._clear_active(request_id)
            self._writer.emit(
                "idle",
                requestId=request_id,
                durationMs=max(0, round((time.monotonic() - started_at) * 1000)),
                executionCount=execution_count,
                truncated=budget.truncated or None,
            )
        except BaseException as error:
            if not self._closing.is_set():
                self._writer.emit(
                    "fatal",
                    requestId=request_id,
                    message=f"kernel execution transport failed: {error}",
                )
                LOGGER.exception("kernel execution transport failed")
        finally:
            self._clear_active(request_id)

    def _emit_error(
        self,
        request_id: str,
        content: dict[str, Any],
        budget: TextBudget,
        execution_count: int | None,
    ) -> None:
        ename, _ = budget.take(content.get("ename", "Error"))
        evalue, _ = budget.take(content.get("evalue", ""))
        traceback = budget.take_lines(content.get("traceback", []))
        self._writer.emit(
            "error",
            requestId=request_id,
            ename=ename,
            evalue=evalue,
            traceback=traceback,
            executionCount=execution_count,
        )

    def _clear_active(self, request_id: str) -> None:
        with self._state_lock:
            if self._active is not None and self._active.request_id == request_id:
                self._active = None

    @staticmethod
    def _poll_channel(
        get_message: Any,
        timeout: float = CHANNEL_POLL_SECONDS,
    ) -> dict[str, Any] | None:
        try:
            return get_message(timeout=timeout)
        except queue.Empty:
            return None

    @staticmethod
    def _belongs_to(message: object, message_id: str) -> bool:
        return bool(
            isinstance(message, dict)
            and message.get("parent_header", {}).get("msg_id") == message_id
        )

    @staticmethod
    def _as_execution_count(value: object, fallback: int | None) -> int | None:
        return value if isinstance(value, int) else fallback


def runtime_probe() -> dict[str, Any]:
    return {
        "type": "probe",
        "protocolVersion": PROTOCOL_VERSION,
        "hostVersion": HOST_VERSION,
        "pythonVersion": sys.version.split()[0],
        "pythonExecutable": sys.executable,
        "ipythonVersion": IPython.__version__,
        "ipykernelVersion": ipykernel.__version__,
        "jupyterClientVersion": jupyter_client.__version__,
        "pyzmqVersion": zmq.__version__,
        "kernelPid": None,
        "kernelAlive": False,
    }


def run_host() -> int:
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    writer = JsonLineWriter()
    host = KernelHost(writer)
    try:
        host.start()
        for raw_line in sys.stdin:
            if not raw_line.strip():
                continue
            request_id: object = None
            try:
                request = require_request(json.loads(raw_line))
                request_id = request.get("requestId")
                request_type = request["type"]
                if request_type == "probe":
                    host.emit_probe(request_id)
                elif request_type == "execute":
                    host.execute(request)
                elif request_type == "interrupt":
                    host.interrupt(require_request_id(request))
                elif request_type == "shutdown":
                    try:
                        host.shutdown(request_id)
                    except KernelShutdownError as error:
                        payload = {"message": str(error)}
                        if isinstance(request_id, str) and request_id:
                            payload["requestId"] = request_id
                        writer.emit("fatal", **payload)
                        return 1
                    return 0
            except (json.JSONDecodeError, ProtocolError) as error:
                payload: dict[str, Any] = {"message": str(error)}
                if isinstance(request_id, str) and request_id:
                    payload["requestId"] = request_id
                writer.emit("fatal", **payload)
        try:
            host.shutdown(emit=False)
        except KernelShutdownError:
            LOGGER.exception("failed to shut down ipykernel after host input closed")
            return 1
        return 0
    except KeyboardInterrupt:
        try:
            host.shutdown(emit=False)
        except KernelShutdownError:
            LOGGER.exception("failed to shut down ipykernel after KeyboardInterrupt")
        return 130
    except BaseException as error:
        writer.emit("fatal", message=f"IPython host failed: {error}")
        LOGGER.exception("IPython host failed")
        try:
            host.shutdown(emit=False)
        except KernelShutdownError:
            LOGGER.exception("failed to shut down ipykernel after host failure")
        return 1
