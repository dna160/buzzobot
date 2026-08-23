"""Install generators (B10) run against real, live-ingested Tempo data —
same discipline as test_live_gmv_generators.py / test_live_awareness_
generators.py. Skipped without a live database.
"""

from __future__ import annotations

import os

import asyncpg
import pytest

from engine.contracts.presets import INSTALL_OBJECTIVE_CONTRACT
from engine.generators.base import GeneratorContext
from engine.generators.install import INSTALL_GENERATORS
from engine.generators.shared import SHARED_GENERATORS
from engine.ports.tempo_read import build_install_metric_frame, connect

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


async def test_shared_and_install_generators_run_against_a_real_app_install_client(conn: asyncpg.Connection) -> None:
    frame = await build_install_metric_frame(conn, "treasury")
    assert frame is not None, "treasury should have ingested paid data and an 'app_install' north_star"
    assert frame.brief_type == "install"

    ctx = GeneratorContext(metric_frame=frame, objective_contract=INSTALL_OBJECTIVE_CONTRACT)
    for generator in (*SHARED_GENERATORS, *INSTALL_GENERATORS):
        result = generator.run(ctx)
        assert result.findings or result.coverage_gap is not None  # never silently empty
        for finding in result.findings:
            assert finding.tenant_id == frame.tenant_id
            for value in finding.evidence.values():
                assert isinstance(value, (int, float, str))


async def test_frame_is_none_for_a_non_app_install_client(conn: asyncpg.Connection) -> None:
    # cimory is north_star='vtr' — the Install adapter must refuse it, not
    # mislabel VTR data as Install.
    frame = await build_install_metric_frame(conn, "cimory")
    assert frame is None
