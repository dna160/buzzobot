"""Generators run against real, live-ingested Tempo data, not just the
Sovella fixture — proves the whole B0-B2 chain (boundary -> read port ->
contracts -> generators) works end to end on an actual client. Skipped
without a live database, same as test_boundary.py.
"""

from __future__ import annotations

import os

import asyncpg
import pytest

from engine.contracts.presets import GMV_OBJECTIVE_CONTRACT
from engine.generators.base import GeneratorContext
from engine.generators.gmv import GMV_GENERATORS
from engine.generators.shared import SHARED_GENERATORS
from engine.ports.tempo_read import build_gmv_metric_frame, connect

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


@pytest.mark.parametrize("client_slug", ["bardi-jakarta", "laneige"])
async def test_shared_generators_run_against_a_real_shop_client(conn: asyncpg.Connection, client_slug: str) -> None:
    frame = await build_gmv_metric_frame(conn, client_slug)
    assert frame is not None, f"{client_slug} should have ingested paid data and a 'shop' north_star"

    ctx = GeneratorContext(metric_frame=frame, objective_contract=GMV_OBJECTIVE_CONTRACT)
    for generator in (*SHARED_GENERATORS, *GMV_GENERATORS):
        result = generator.run(ctx)
        assert result.findings or result.coverage_gap is not None  # never silently empty
        for finding in result.findings:
            assert finding.tenant_id == frame.tenant_id


async def test_frame_is_none_for_a_non_shop_client(conn: asyncpg.Connection) -> None:
    # cimory is north_star='vtr' — the GMV adapter must refuse it, not
    # mislabel VTR data as GMV.
    frame = await build_gmv_metric_frame(conn, "cimory")
    assert frame is None
