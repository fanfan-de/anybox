"""Versioned JSON-lines protocol helpers for the Anybox IPython host."""

from __future__ import annotations

import json
import sys
import threading
from dataclasses import dataclass
from typing import Any, TextIO

from . import PROTOCOL_VERSION

DEFAULT_MAX_OUTPUT_CHARS = 100_000
MAX_OUTPUT_CHARS = 1_000_000
MAX_OUTPUT_EVENTS = 2_048
MAX_CODE_CHARS = 1_000_000


class ProtocolError(ValueError):
    """Raised when the controlling process sends an invalid request."""


class JsonLineWriter:
    """Serialize protocol events without allowing concurrent line interleaving."""

    def __init__(self, stream: TextIO = sys.stdout) -> None:
        self._stream = stream
        self._lock = threading.Lock()

    def emit(self, event_type: str, **payload: Any) -> None:
        event = {
            "type": event_type,
            "protocolVersion": PROTOCOL_VERSION,
            **{key: value for key, value in payload.items() if value is not None},
        }
        encoded = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            self._stream.write(encoded)
            self._stream.write("\n")
            self._stream.flush()


@dataclass(slots=True)
class TextBudget:
    """Bound textual payload and output-event count for one execution request."""

    limit: int
    used: int = 0
    truncated: bool = False
    event_limit: int = MAX_OUTPUT_EVENTS
    events_used: int = 0

    @classmethod
    def from_request(cls, value: object) -> "TextBudget":
        if value is None:
            return cls(DEFAULT_MAX_OUTPUT_CHARS)
        if isinstance(value, bool) or not isinstance(value, int):
            raise ProtocolError("maxOutputChars must be an integer")
        if value < 1 or value > MAX_OUTPUT_CHARS:
            raise ProtocolError(
                f"maxOutputChars must be between 1 and {MAX_OUTPUT_CHARS}"
            )
        return cls(value)

    def take(self, value: object) -> tuple[str, bool]:
        text = str(value or "")
        remaining = max(0, self.limit - self.used)
        if len(text) <= remaining:
            self.used += len(text)
            return text, False

        self.used = self.limit
        self.truncated = True
        return text[:remaining], True

    def take_event(self, value: object) -> tuple[str, bool]:
        """Take text for one optional output event.

        Empty payloads never produce an event. Once either budget is exhausted,
        later optional events are dropped and the final idle event reports that
        truncation occurred.
        """

        text = str(value or "")
        if not text:
            return "", False
        if self.events_used >= self.event_limit or self.used >= self.limit:
            self.truncated = True
            return "", True
        self.events_used += 1
        return self.take(text)

    def take_lines(self, values: object) -> list[str]:
        if not isinstance(values, list):
            values = [values]
        result: list[str] = []
        for index, value in enumerate(values):
            text, clipped = self.take(value)
            if text:
                result.append(text)
            if clipped:
                break
            if self.used >= self.limit:
                if index + 1 < len(values):
                    self.truncated = True
                break
        return result


def require_request(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ProtocolError("request must be a JSON object")

    version = value.get("protocolVersion")
    if version != PROTOCOL_VERSION:
        raise ProtocolError(
            f"unsupported protocolVersion {version!r}; expected {PROTOCOL_VERSION}"
        )

    request_type = value.get("type")
    if request_type not in {"probe", "execute", "interrupt", "shutdown"}:
        raise ProtocolError(f"unsupported request type {request_type!r}")
    return value


def require_request_id(request: dict[str, Any]) -> str:
    request_id = request.get("requestId")
    if not isinstance(request_id, str) or not request_id.strip():
        raise ProtocolError("requestId must be a non-empty string")
    if len(request_id) > 256:
        raise ProtocolError("requestId must not exceed 256 characters")
    return request_id


def require_code(request: dict[str, Any]) -> str:
    code = request.get("code")
    if not isinstance(code, str):
        raise ProtocolError("code must be a string")
    if len(code) > MAX_CODE_CHARS:
        raise ProtocolError(f"code must not exceed {MAX_CODE_CHARS} characters")
    return code
