from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE_ROOT))

from anybox_ipython_host.kernel import AnyboxKernelManager  # noqa: E402


class KernelCommandTests(unittest.TestCase):
    def test_kernel_uses_isolated_interpreter_before_module_resolution(self) -> None:
        manager = AnyboxKernelManager(kernel_name="python3")
        manager.connection_file = os.path.join(os.getcwd(), "kernel-test.json")

        command = manager.format_kernel_cmd(["--AnyboxTest=1"])

        self.assertEqual(
            command[:4],
            [sys.executable, "-I", "-m", "ipykernel_launcher"],
        )
        self.assertEqual(command[-1], "--AnyboxTest=1")


if __name__ == "__main__":
    unittest.main()

