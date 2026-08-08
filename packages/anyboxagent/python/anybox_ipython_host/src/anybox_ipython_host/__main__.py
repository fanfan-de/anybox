"""CLI entry point for the private Anybox IPython host."""

from __future__ import annotations

import json
import sys


def _configure_utf8_stdio() -> None:
    """Keep the private JSONL transport UTF-8 on every supported platform.

    The host is launched with ``-I``, so a ``PYTHONUTF8`` environment variable
    is intentionally ignored.  ``-X utf8`` is the primary guarantee; this is a
    second line of defence for standard streams supplied by launchers whose
    inherited encoding does not match the byte-oriented controller.
    """

    for stream_name, errors in (
        ("stdin", "strict"),
        ("stdout", "strict"),
        ("stderr", "backslashreplace"),
    ):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors=errors)


def main() -> int:
    _configure_utf8_stdio()
    try:
        from .kernel import run_host, runtime_probe
    except BaseException as error:
        from . import PROTOCOL_VERSION

        print(
            json.dumps(
                {
                    "type": "fatal",
                    "protocolVersion": PROTOCOL_VERSION,
                    "message": f"IPython host dependencies are unavailable: {error}",
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            flush=True,
        )
        return 1

    if sys.argv[1:] == ["--probe"]:
        print(
            json.dumps(runtime_probe(), ensure_ascii=False, separators=(",", ":")),
            flush=True,
        )
        return 0
    if len(sys.argv) > 1:
        print("usage: python -m anybox_ipython_host [--probe]", file=sys.stderr)
        return 2
    return run_host()


if __name__ == "__main__":
    raise SystemExit(main())
