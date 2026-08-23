"""Persist the full ranked list to insight.materiality_rankings — live,
against the real Postgres insight schema created and verified writable in B0.
"""

from __future__ import annotations

import os
import uuid

import asyncpg
import pytest

from engine.generators.base import GeneratorContext
from engine.generators.shared import SHARED_GENERATORS
from engine.materiality import route_all_sections, score_findings
from engine.materiality.persistence import ensure_schema, persist_rankings
from engine.ports.tempo_read import connect
from eval.fixtures.sovella_gmv_week import GMV_OBJECTIVE_CONTRACT, build_sovella_gmv_metric_frame

pytestmark = pytest.mark.skipif(
    "TEMPO_ENGINE_DATABASE_URL" not in os.environ,
    reason="requires TEMPO_ENGINE_DATABASE_URL (run scripts/bootstrap_engine_role.py against a live Tempo Postgres)",
)


@pytest.fixture()
async def conn():
    c = await connect(os.environ["TEMPO_ENGINE_DATABASE_URL"])
    try:
        yield c
    finally:
        await c.close()


async def test_persist_rankings_writes_every_row_including_below_the_cut(conn: asyncpg.Connection) -> None:
    await ensure_schema(conn)

    ctx = GeneratorContext(metric_frame=build_sovella_gmv_metric_frame(), objective_contract=GMV_OBJECTIVE_CONTRACT)
    findings = [f for gen in SHARED_GENERATORS for f in gen.run(ctx).findings]
    rankings = route_all_sections(score_findings(findings, "gmv"))
    total_ranked = sum(len(r.ranked) for r in rankings.values())
    total_included = sum(len(r.selected) for r in rankings.values())
    assert total_ranked > 0

    run_id = f"test_{uuid.uuid4().hex[:12]}"
    try:
        await persist_rankings(conn, run_id, "sovella", "gmv", rankings)

        row_count = await conn.fetchval("SELECT count(*) FROM insight.materiality_rankings WHERE run_id = $1", run_id)
        assert row_count == total_ranked

        included_count = await conn.fetchval(
            "SELECT count(*) FROM insight.materiality_rankings WHERE run_id = $1 AND included", run_id
        )
        assert included_count == total_included

        # Everything below the cut really is there too, not just what was selected.
        excluded_count = await conn.fetchval(
            "SELECT count(*) FROM insight.materiality_rankings WHERE run_id = $1 AND NOT included", run_id
        )
        assert excluded_count == total_ranked - total_included
    finally:
        await conn.execute("DELETE FROM insight.materiality_rankings WHERE run_id = $1", run_id)
