"""Awareness generators (B9) run against real, live-ingested Tempo data —
same "prove the whole chain end to end on an actual client" discipline as
`test_live_gmv_generators.py`. Skipped without a live database.
"""

from __future__ import annotations

import os

import asyncpg
import pytest

from engine.contracts.presets import AWARENESS_OBJECTIVE_CONTRACT
from engine.generators.awareness import AWARENESS_GENERATORS
from engine.generators.base import GeneratorContext
from engine.generators.shared import SHARED_GENERATORS
from engine.ports.tempo_read import build_awareness_metric_frame, connect

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


async def test_shared_and_awareness_generators_run_against_a_real_vtr_client(conn: asyncpg.Connection) -> None:
    frame = await build_awareness_metric_frame(conn, "cimory")
    assert frame is not None, "cimory should have ingested paid data and a 'vtr' north_star"
    assert frame.brief_type == "awareness"

    ctx = GeneratorContext(metric_frame=frame, objective_contract=AWARENESS_OBJECTIVE_CONTRACT)
    for generator in (*SHARED_GENERATORS, *AWARENESS_GENERATORS):
        result = generator.run(ctx)
        assert result.findings or result.coverage_gap is not None  # never silently empty
        for finding in result.findings:
            assert finding.tenant_id == frame.tenant_id
            for value in finding.evidence.values():
                assert isinstance(value, (int, float, str))


async def test_frame_is_none_for_a_non_vtr_client(conn: asyncpg.Connection) -> None:
    # bardi-jakarta is north_star='shop' — the Awareness adapter must refuse
    # it, not mislabel Shop data as Awareness.
    frame = await build_awareness_metric_frame(conn, "bardi-jakarta")
    assert frame is None
