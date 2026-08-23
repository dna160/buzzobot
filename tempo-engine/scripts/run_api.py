"""Entry point for the review API (`engine.api.app`) as an actual running
service, as opposed to `pytest` exercising it in-process.

On Windows, uses `engine.api.win_loop:selector_loop_factory` instead of
uvicorn's own default loop — see that module's docstring for why setting
the asyncio event loop *policy* (the fix that works for pytest, via
`tests/conftest.py`) does nothing for uvicorn's newer `get_loop_factory()`
mechanism, and psycopg's async driver cannot run under the Proactor loop
uvicorn otherwise hard-codes on `win32`.

Usage: `.venv/Scripts/python.exe scripts/run_api.py [--host H] [--port P]`
"""

from __future__ import annotations

import argparse
import sys

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    loop = "engine.api.win_loop:selector_loop_factory" if sys.platform == "win32" else "auto"
    uvicorn.run("engine.api.app:app", host=args.host, port=args.port, reload=args.reload, loop=loop)


if __name__ == "__main__":
    main()
