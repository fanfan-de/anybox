from __future__ import annotations

import io
import json
import sys
import unittest
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE_ROOT))

from anybox_ipython_host.protocol import (  # noqa: E402
    JsonLineWriter,
    ProtocolError,
    TextBudget,
    require_code,
    require_request,
    require_request_id,
)


class ProtocolTests(unittest.TestCase):
    def test_writer_adds_version_and_omits_none(self) -> None:
        stream = io.StringIO()
        JsonLineWriter(stream).emit("ready", kernelPid=123, optional=None)
        self.assertEqual(
            json.loads(stream.getvalue()),
            {"type": "ready", "protocolVersion": 1, "kernelPid": 123},
        )

    def test_budget_bounds_all_text_for_a_request(self) -> None:
        budget = TextBudget(5)
        self.assertEqual(budget.take("abc"), ("abc", False))
        self.assertEqual(budget.take("def"), ("de", True))
        self.assertEqual(budget.take("ignored"), ("", True))
        self.assertEqual(budget.used, 5)
        self.assertTrue(budget.truncated)

    def test_budget_bounds_optional_output_events_and_ignores_empty_events(self) -> None:
        budget = TextBudget(100, event_limit=2)

        self.assertEqual(budget.take_event(""), ("", False))
        self.assertEqual(budget.events_used, 0)
        self.assertEqual(budget.take_event("first"), ("first", False))
        self.assertEqual(budget.take_event("second"), ("second", False))
        self.assertEqual(budget.take_event("dropped"), ("", True))
        self.assertEqual(budget.events_used, 2)
        self.assertTrue(budget.truncated)

    def test_line_budget_marks_exact_boundary_when_more_lines_remain(self) -> None:
        budget = TextBudget(5)

        self.assertEqual(budget.take_lines(["12345", "not emitted"]), ["12345"])
        self.assertTrue(budget.truncated)

    def test_request_validation(self) -> None:
        request = require_request(
            {
                "type": "execute",
                "protocolVersion": 1,
                "requestId": "cell-1",
                "code": "1 + 1",
            }
        )
        self.assertEqual(require_request_id(request), "cell-1")
        self.assertEqual(require_code(request), "1 + 1")

        with self.assertRaises(ProtocolError):
            require_request({"type": "execute", "protocolVersion": 999})
        with self.assertRaises(ProtocolError):
            require_request_id({"requestId": ""})
        with self.assertRaises(ProtocolError):
            TextBudget.from_request(True)


if __name__ == "__main__":
    unittest.main()
