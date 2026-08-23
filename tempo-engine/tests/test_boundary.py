"""B0 exit criterion, executable: "Engine reads a real client's read-models;
write attempt to tempo.* fails." Requires `TEMPO_ENGINE_DATABASE_URL` (set by
`scripts/bootstrap_engine_role.py`) and a live Postgres — skipped otherwise
so the rest of the suite doesn't require a database.
"""

from __future__ import annotations

import os

import asyncpg
import pytest

from engine.ports.tempo_read import connect, fetch_available_dates, fetch_client, verify_read_only_boundary

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


async def test_engine_role_can_read_a_real_client(conn: asyncpg.Connection) -> None:
    client = await fetch_client(conn, "bardi-jakarta")
    assert client is not None
    assert client.north_star == "shop"


async def test_engine_role_can_read_available_dates(conn: asyncpg.Connection) -> None:
    client = await fetch_client(conn, "bardi-jakarta")
    assert client is not None
    dates = await fetch_available_dates(conn, client.id)
    assert len(dates) > 0


async def test_engine_role_write_to_tempo_table_fails(conn: asyncpg.Connection) -> None:
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await conn.execute(
            "INSERT INTO clients (agency_id, name, slug) VALUES "
            "('00000000-0000-0000-0000-000000000000', 'should-fail', 'should-fail')"
        )


async def test_verify_read_only_boundary_passes(conn: asyncpg.Connection) -> None:
    await verify_read_only_boundary(conn)  # raises AssertionError on failure


async def test_engine_role_can_write_insight_schema(conn: asyncpg.Connection) -> None:
    await conn.execute("CREATE TABLE IF NOT EXISTS insight._boundary_probe (id serial PRIMARY KEY)")
    await conn.execute("DROP TABLE insight._boundary_probe")
