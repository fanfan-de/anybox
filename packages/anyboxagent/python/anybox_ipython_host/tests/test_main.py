from __future__ import annotations

import io
import sys
import unittest
from pathlib import Path
from unittest import mock

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE_ROOT))

from anybox_ipython_host.__main__ import _configure_utf8_stdio  # noqa: E402


class MainTests(unittest.TestCase):
    def test_configures_text_standard_streams_as_utf8(self) -> None:
        stdin = io.TextIOWrapper(io.BytesIO(), encoding="latin-1")
        stdout = io.TextIOWrapper(io.BytesIO(), encoding="latin-1")
        stderr = io.TextIOWrapper(io.BytesIO(), encoding="latin-1")

        with (
            mock.patch.object(sys, "stdin", stdin),
            mock.patch.object(sys, "stdout", stdout),
            mock.patch.object(sys, "stderr", stderr),
        ):
            _configure_utf8_stdio()

        self.assertEqual(stdin.encoding.lower(), "utf-8")
        self.assertEqual(stdin.errors, "strict")
        self.assertEqual(stdout.encoding.lower(), "utf-8")
        self.assertEqual(stdout.errors, "strict")
        self.assertEqual(stderr.encoding.lower(), "utf-8")
        self.assertEqual(stderr.errors, "backslashreplace")

    def test_ignores_standard_streams_without_reconfigure(self) -> None:
        stream = io.StringIO()
        with (
            mock.patch.object(sys, "stdin", stream),
            mock.patch.object(sys, "stdout", stream),
            mock.patch.object(sys, "stderr", stream),
        ):
            _configure_utf8_stdio()


if __name__ == "__main__":
    unittest.main()
