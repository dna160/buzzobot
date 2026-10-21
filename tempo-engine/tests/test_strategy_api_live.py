"""Strategy Report over the real HTTP API and the real Tempo DB (PRD §13 #1,
#6, §10): `POST /v1/briefs` returns `running` at once and the run lands
`approved` with `auto_approve`; the materiality audit rows are written in the
production path; `/healthz` reports the strategy run and the LLM config.

Instant tier, so it needs the database but not LM Studio. Skipped without
TEMPO_ENGINE_DATABASE_URL.
"""

from __future__ import annotations

import asyncio
import os

import httpx
import pytest

from engine.api.app import app

pytestmark = pytest.mark.skipif("TEMPO_ENGINE_DATABASE_URL" not in os.environ, reason="requires TEMPO_ENGINE_DATABASE_URL")


async def _wait(client: httpx.AsyncClient, run_id: str, timeout_s: float = 120.0, *, past: tuple[str, ...] = ("running", "pending_review")) -> dict:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_s
    while True:
        body = (await client.get(f"/v1/briefs/{run_id}")).json()
        if body["status"] not in past or loop.time() > deadline:
            return body
        await asyncio.sleep(0.5)


async def test_async_strategy_run_lifecycle() -> None:
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=60.0) as client:
            res = await client.post("/v1/briefs", json={
                "client_slug": "bardi-tiktok", "brief_type": "strategy", "tier": "instant", "auto_approve": True,
            })
            assert res.status_code == 200, res.text
            created = res.json()
            assert created["status"] == "running"

            body = await _wait(client, created["run_id"])
            assert body["status"] == "approved", body["content"]
            assert body["content"]["brief_type"] == "strategy" and body["content"]["action_plan"]

            pool = app.state.read_conn
            n = await pool.fetchval("SELECT count(*) FROM insight.materiality_rankings WHERE run_id = $1", created["run_id"])
            assert n > 0

            health = (await client.get("/healthz")).json()
            assert "strategy" in health["brief_types"]
            assert health["llm"]["max_tokens"] >= 4096 and health["llm"]["base_url"]
            assert health["last_strategy_run"]["run_id"] == created["run_id"]


async def test_ineligible_strategy_client_is_404_without_a_row() -> None:
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post("/v1/briefs", json={"client_slug": "chocomory", "brief_type": "strategy", "tier": "instant"})
            assert res.status_code == 404


async def test_review_edits_are_applied_and_recorded() -> None:
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=60.0) as client:
            created = (await client.post("/v1/briefs", json={"client_slug": "bardi-tiktok", "brief_type": "strategy", "tier": "instant"})).json()
            body = await _wait(client, created["run_id"], past=("running",))
            assert body["status"] == "pending_review"
            page = await client.get(f"/ui/briefs/{created['run_id']}")
            assert 'data-path="sections.103.draft.headline"' in page.text

            bad = await client.post(f"/v1/briefs/{created['run_id']}/review", json={
                "decision": "approved", "edits": [{"path": "findings.0.evidence.size_ratio", "text": "1"}],
            })
            assert bad.status_code == 422  # and the run is still pending
            assert (await client.get(f"/v1/briefs/{created['run_id']}")).json()["status"] == "pending_review"

            new = "Funnel BARDI bocor paling besar antara Consideration dan Conversion."
            ok = await client.post(f"/v1/briefs/{created['run_id']}/review", json={
                "decision": "approved", "editor": "test", "edits": [{"path": "sections.103.draft.headline", "text": new}],
            })
            assert ok.status_code == 200 and ok.json()["edits"] == 1
            final = (await client.get(f"/v1/briefs/{created['run_id']}")).json()
            assert final["status"] == "approved" and final["content"]["sections"]["103"]["draft"]["headline"] == new
            row = await app.state.read_conn.fetchrow("SELECT * FROM insight.brief_edits WHERE run_id = $1", created["run_id"])
            assert row["after_text"] == new and 0 < row["edit_distance"] < 1 and row["section_id"] == "103"
