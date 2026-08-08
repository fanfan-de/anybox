"""CLI entry point for the private Anybox IPython host."""

from __future__ import annotations

import json
import sys


def main() -> int:
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

