# SPDX-FileCopyrightText: 2026 Anybox Authors
#
# SPDX-License-Identifier: GPL-3.0-or-later

"""Launch the vendored Blender MCP without installing it into its source tree."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
from typing import NoReturn


def fail(message: str) -> NoReturn:
    print(f"[anybox-blender-mcp] {message}", file=sys.stderr, flush=True)
    raise SystemExit(2)


def resolve_uv() -> str:
    configured = os.environ.get("BLENDER_UV_PATH", "uv").strip() or "uv"
    configured_path = Path(configured)
    if configured_path.is_absolute():
        if not configured_path.is_file():
            fail(f"Configured uv executable does not exist: {configured_path}")
        return str(configured_path)

    resolved = shutil.which(configured)
    if resolved is None:
        fail(
            "Could not find uv. Install uv or set BLENDER_UV_PATH to its "
            "absolute executable path."
        )
    return resolved


def resolve_project() -> Path:
    configured = os.environ.get("BLENDER_MCP_PROJECT", "").strip()
    if not configured:
        fail("BLENDER_MCP_PROJECT is not configured.")

    project = Path(configured).resolve()
    for required_name in ("pyproject.toml", "uv.lock"):
        if not (project / required_name).is_file():
            fail(f"Bundled Blender MCP is missing {required_name}: {project}")
    return project


def main() -> int:
    uv = resolve_uv()
    project = resolve_project()

    sync_command = [
        uv,
        "sync",
        "--project",
        str(project),
        "--frozen",
        "--no-dev",
        "--no-install-project",
    ]
    sync_result = subprocess.run(sync_command, stdin=subprocess.DEVNULL, check=False)
    if sync_result.returncode != 0:
        print(
            f"[anybox-blender-mcp] uv sync failed with exit code "
            f"{sync_result.returncode}.",
            file=sys.stderr,
            flush=True,
        )
        return sync_result.returncode

    child_environment = os.environ.copy()
    child_environment["PYTHONPATH"] = str(project)
    child_environment["PYTHONNOUSERSITE"] = "1"

    run_command = [
        uv,
        "run",
        "--project",
        str(project),
        "--frozen",
        "--no-dev",
        "--no-sync",
        "python",
        "-m",
        "blmcp",
    ]
    child = subprocess.Popen(run_command, env=child_environment)

    def forward_signal(signum: int, _frame: object) -> None:
        if child.poll() is None:
            if os.name == "nt":
                child.terminate()
            else:
                child.send_signal(signum)

    for signal_name in ("SIGINT", "SIGTERM"):
        supported_signal = getattr(signal, signal_name, None)
        if supported_signal is not None:
            signal.signal(supported_signal, forward_signal)

    return child.wait()


if __name__ == "__main__":
    raise SystemExit(main())
