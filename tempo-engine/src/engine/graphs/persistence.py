"""Persist a brief run to `insight.brief` (PRD §4.1's terminal node).
Deliberately separate from the graph itself — no graph node touches
Postgres directly (see brief.py's module docstring)."""

from __future__ import annotations

import json
import uuid

import asyncpg

from engine.ports.tempo_read import parse_database_url


def insight_checkpointer_conninfo(database_url: str) -> str:
    """A psycopg conninfo string with `search_path=insight,public` — needed
    because `AsyncPostgresSaver.setup()`/`.setup()`'s migrations create
    unqualified tables (`CREATE TABLE checkpoint_migrations (...)`), which
    land in whatever schema is first on the connection's `search_path`. The
    `tempo_engine` role correctly has no CREATE on `public` (that's the read-
    only boundary from B0 working as intended) — pointing search_path at
    `insight` first means the checkpointer's own tables land there instead,
    without the checkpointer needing to know insight.* exists at all.
    """
    parsed = parse_database_url(database_url)
    return (
        f"postgresql://{parsed['user']}:{parsed['password']}@{parsed['host']}:{parsed['port']}"
        f"/{parsed['database']}?options=-c%20search_path%3Dinsight,public"
    )


async def ensure_schema(conn: asyncpg.Connection) -> None:
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS insight.brief (
            id text PRIMARY KEY,
            run_id text NOT NULL UNIQUE,
            tenant_id text NOT NULL,
            brief_type text NOT NULL,
            status text NOT NULL DEFAULT 'pending_review',
            content jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    await conn.execute("CREATE INDEX IF NOT EXISTS brief_tenant_idx ON insight.brief (tenant_id)")
    await conn.execute("CREATE INDEX IF NOT EXISTS brief_status_idx ON insight.brief (status)")


async def upsert_brief(
    conn: asyncpg.Connection,
    *,
    run_id: str,
    tenant_id: str,
    brief_type: str,
    status: str,
    content: dict,
) -> None:
    await conn.execute(
        """
        INSERT INTO insight.brief (id, run_id, tenant_id, brief_type, status, content, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
        ON CONFLICT (run_id) DO UPDATE SET status = $5, content = $6::jsonb, updated_at = now()
        """,
        str(uuid.uuid4()),
        run_id,
        tenant_id,
        brief_type,
        status,
        json.dumps(content),
    )


async def fetch_brief(conn: asyncpg.Connection, run_id: str) -> dict | None:
    row = await conn.fetchrow("SELECT * FROM insight.brief WHERE run_id = $1", run_id)
    return dict(row) if row else None


async def brief_stats(conn: asyncpg.Connection) -> dict:
    """Last-run summary for `GET /healthz` (Brief Deck PRD §7, K6). The engine
    health card that replaces the LM Studio settings UI needs to answer "is it
    up, and did the last run finish?" — both from data the engine already
    owns, without a second endpoint or a live LM Studio round-trip."""
    row = await conn.fetchrow(
        """
        SELECT run_id, brief_type, status, content->>'tier' AS tier, updated_at
        FROM insight.brief ORDER BY updated_at DESC LIMIT 1
        """
    )
    total = await conn.fetchval("SELECT count(*) FROM insight.brief")
    last = None
    if row is not None:
        last = {
            "run_id": row["run_id"],
            "brief_type": row["brief_type"],
            "status": row["status"],
            "tier": row["tier"],
            "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
        }
    return {"briefs_total": int(total or 0), "last_run": last}


def _fallbacks(ev: dict) -> int:
    """Parts of a full-tier report that kept their instant copy because the
    model's draft failed its gates: sections, action copies and the verdict."""
    n = sum(1 for e in (ev.get("sections") or {}).values() if e.get("source") == "fallback")
    n += sum(1 for v in ((ev.get("actions") or {}).get("sources") or {}).values() if v == "fallback")
    return n + (1 if (ev.get("verdict") or {}).get("source") == "fallback" else 0)


async def recent_strategy_runs(conn: asyncpg.Connection, limit: int = 8) -> list[dict]:
    """Newest Strategy Report runs for `/healthz` and the settings health card
    (Strategy Report PRD §9.5, §10): tier, status, how long the full tier took,
    how many parts fell back, what degraded, and pass@1."""
    rows = await conn.fetch(
        """
        SELECT run_id, status, updated_at, content->>'tier' AS tier,
               content->'meta'->'degraded' AS degraded, content->'meta'->'eval' AS eval, content->>'error' AS error
        FROM insight.brief WHERE brief_type = 'strategy' ORDER BY updated_at DESC LIMIT $1
        """,
        limit,
    )
    out = []
    for row in rows:
        ev = row["eval"]
        ev = json.loads(ev) if isinstance(ev, str) else (ev or {})
        deg = row["degraded"]
        deg = json.loads(deg) if isinstance(deg, str) else (deg or [])
        out.append({
            "run_id": row["run_id"],
            "status": row["status"],
            "tier": row["tier"],
            "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
            "duration_s": ev.get("duration_s"),
            "llm_calls": ev.get("llm_calls"),
            "pass_at_1": ev.get("pass_at_1"),
            "fallbacks": _fallbacks(ev),
            "degraded": deg,
            "error": row["error"],
        })
    return out
