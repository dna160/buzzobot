"""Which database Tanya Tempo reads (`ChatDataSource`).

Chat reads the ads database named by `TEMPO_DATA_DATABASE_URL` when it is set,
reachable, and has Tempo's tables (`clients`, `tiktok_accounts`, `campaigns`,
`paid_hourly_metrics`). Otherwise it falls back to the engine's own read pool
(`TEMPO_ENGINE_DATABASE_URL`) — the same data the reports read — and says so in
`/healthz`. A failed connection is retried at most once a minute, so starting a
tunnel later is picked up without restarting the engine. Turn logging always
goes to the engine database (`insight.chat_turns`), never the data database.
"""

from __future__ import annotations

import asyncio
import sys
from time import monotonic

import asyncpg

from engine.ports.tempo_read import create_pool, parse_database_url

REQUIRED_TABLES = ("clients", "tiktok_accounts", "campaigns", "paid_hourly_metrics")
RETRY_S = 60.0
CONNECT_TIMEOUT_S = 5.0


def _describe(url: str) -> str:
    """host:port/db — never the credentials."""
    try:
        p = parse_database_url(url)
    except ValueError:
        return "(invalid URL)"
    return f"{p['host']}:{p['port']}/{p['database']}"


class ChatDataSource:
    def __init__(self, engine_pool: asyncpg.Pool, data_url: str | None) -> None:
        self._engine_pool = engine_pool
        self._data_url = (data_url or "").strip() or None
        self._data_pool: asyncpg.Pool | None = None
        self._last_try = -RETRY_S
        self._error: str | None = None
        self._lock = asyncio.Lock()

    async def pool(self) -> asyncpg.Pool:
        if self._data_url is None or self._data_pool is not None:
            return self._data_pool or self._engine_pool
        async with self._lock:
            if self._data_pool is None and monotonic() - self._last_try >= RETRY_S:
                self._last_try = monotonic()
                await self._connect()
        return self._data_pool or self._engine_pool

    async def _connect(self) -> None:
        assert self._data_url is not None
        try:
            pool = await asyncio.wait_for(create_pool(self._data_url), CONNECT_TIMEOUT_S)
        except Exception as exc:  # noqa: BLE001 - fallback, reported in status()
            self._error = f"unreachable: {type(exc).__name__}: {exc}"[:240]
            print(f"[chat] data database {_describe(self._data_url)} {self._error}; using engine DB", file=sys.stderr)
            return
        try:
            missing = [
                t for t in REQUIRED_TABLES
                if await pool.fetchval("SELECT to_regclass($1)", f"public.{t}") is None
            ]
        except Exception as exc:  # noqa: BLE001
            missing = [f"(check failed: {exc})"]
        if missing:
            await pool.close()
            self._error = "missing Tempo tables: " + ", ".join(missing)
            print(f"[chat] data database {_describe(self._data_url)} {self._error}; using engine DB", file=sys.stderr)
            return
        self._data_pool = pool
        self._error = None

    def status(self) -> dict:
        if self._data_url is None:
            return {"source": "engine", "configured": None}
        return {
            "source": "data" if self._data_pool is not None else "engine",
            "configured": _describe(self._data_url),
            "error": self._error,
        }

    async def close(self) -> None:
        if self._data_pool is not None:
            await self._data_pool.close()
