"""psycopg's async mode requires a selector-based event loop; Windows'
asyncio default (ProactorEventLoop) doesn't support it. Only affects tests
that touch AsyncPostgresSaver (test_brief_graph_live.py's Postgres variant)
but is harmless to set globally.
"""

from __future__ import annotations

import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
