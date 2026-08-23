"""Persist the full ranked list to `insight.materiality_rankings` — PRD
§6.5's audit requirement. Writes through the same `tempo_engine` role every
other insight.* write uses (full rights there, verified in B0).
"""

from __future__ import annotations

import asyncpg

from engine.materiality.router import SectionRanking


async def ensure_schema(conn: asyncpg.Connection) -> None:
    """Idempotent — safe to call at the start of every run rather than
    requiring a separate migration-runner tool this early in the build."""
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS insight.materiality_rankings (
            id bigserial PRIMARY KEY,
            run_id text NOT NULL,
            tenant_id text NOT NULL,
            brief_type text NOT NULL,
            section_id integer NOT NULL,
            finding_id text NOT NULL,
            generator text NOT NULL,
            claim_frame text NOT NULL,
            rank integer NOT NULL,
            materiality double precision NOT NULL,
            included boolean NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    await conn.execute("CREATE INDEX IF NOT EXISTS materiality_rankings_run_idx ON insight.materiality_rankings (run_id)")
    await conn.execute("CREATE INDEX IF NOT EXISTS materiality_rankings_tenant_idx ON insight.materiality_rankings (tenant_id)")


async def persist_rankings(
    conn: asyncpg.Connection,
    run_id: str,
    tenant_id: str,
    brief_type: str,
    rankings: dict[object, SectionRanking],
) -> None:
    rows = [
        (
            run_id,
            tenant_id,
            brief_type,
            int(section_id),
            r.finding.id,
            r.finding.generator,
            r.finding.claim_frame,
            r.rank,
            r.finding.materiality,
            r.included,
        )
        for section_id, ranking in rankings.items()
        for r in ranking.ranked
    ]
    if not rows:
        return
    await conn.executemany(
        """
        INSERT INTO insight.materiality_rankings
            (run_id, tenant_id, brief_type, section_id, finding_id, generator, claim_frame, rank, materiality, included)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        """,
        rows,
    )
