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
