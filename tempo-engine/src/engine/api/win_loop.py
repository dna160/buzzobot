"""A uvicorn loop factory that returns Python's selector-based event loop
instead of uvicorn's own Windows default.

uvicorn (>=0.36) builds its event loop from a `get_loop_factory()` lookup,
not from `asyncio.get_event_loop_policy()` — its built-in "asyncio" and
"auto" factories (`uvicorn/loops/asyncio.py`) hard-code `asyncio.
ProactorEventLoop` on `win32`, so setting the process-wide event loop
policy before calling `uvicorn.run()` (the fix that works for plain
`asyncio.run()` callers, e.g. `tests/conftest.py`) has no effect here — it
never gets consulted. psycopg's async driver cannot run under
ProactorEventLoop at all (`psycopg.InterfaceError`), so the checkpointer
connection in `app.py`'s lifespan fails on every Windows launch of the real
service.

Passed to `uvicorn.run(..., loop="engine.api.win_loop:selector_loop_factory")`
in `scripts/run_api.py` — the dotted-path form `Config.get_loop_factory()`
falls back to when `loop` isn't one of its own literal names ("none",
"auto", "asyncio", "uvloop").

Signature note: uvicorn's own built-in factories (`uvicorn/loops/asyncio.py`
etc.) are two-level — `Config.get_loop_factory()` calls them WITH
`use_subprocess` and expects THAT result to be the zero-arg loop factory it
hands to `asyncio.Runner`. The custom dotted-path branch does not do that
second call — it passes whatever `import_from_string(self.loop)` returns
straight through as the zero-arg factory itself. So this function's
signature must be `() -> asyncio.AbstractEventLoop` (an instance, called
with no arguments), not `(use_subprocess) -> Callable[[], AbstractEventLoop]`
— matching the two-level shape here silently makes `Runner` treat the
*class* `SelectorEventLoop` as if it were an already-constructed loop
instance, producing `TypeError: ... close() missing 1 required positional
argument: 'self'` deep inside `asyncio.Runner.close()`.
"""

from __future__ import annotations

import asyncio


def selector_loop_factory() -> asyncio.AbstractEventLoop:
    return asyncio.SelectorEventLoop()
