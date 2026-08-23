"""B6 exit criteria: "Johnson approves a real client brief end to end" —
proven here via the actual HTTP API (PRD §1.1's interface) against real
Tempo data, real LM Studio, and a real Postgres checkpointer. The human
click is what only a person can do; this proves everything up to and
including that click works.

Skipped without a reachable LM Studio server and TEMPO_ENGINE_DATABASE_URL.
"""

from __future__ import annotations

import os

import httpx
import pytest

from engine.api.app import app

pytestmark = pytest.mark.skipif(
    "TEMPO_ENGINE_DATABASE_URL" not in os.environ,
    reason="requires TEMPO_ENGINE_DATABASE_URL",
)


def _lm_studio_reachable() -> bool:
    try:
        httpx.get("http://localhost:1234/v1/models", timeout=3.0).raise_for_status()
        return True
    except httpx.HTTPError:
        return False


async def test_full_review_lifecycle_via_http_api() -> None:
    if not _lm_studio_reachable():
        pytest.skip("requires a reachable LM Studio server")

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=120.0) as client:
            create_res = await client.post("/v1/briefs", json={"client_slug": "bardi-jakarta", "brief_type": "gmv"})
            assert create_res.status_code == 200, create_res.text
            created = create_res.json()
            run_id = created["run_id"]
            assert created["status"] == "pending_review"

            status_res = await client.get(f"/v1/briefs/{run_id}")
            assert status_res.status_code == 200
            body = status_res.json()
            assert body["status"] == "pending_review"
            assert body["content"]["s1"]["draft"]["headline"]

            page_res = await client.get(f"/ui/briefs/{run_id}")
            assert page_res.status_code == 200
            assert "Approve" in page_res.text
            assert body["content"]["s1"]["draft"]["headline"] in page_res.text

            review_res = await client.post(f"/v1/briefs/{run_id}/review", json={"decision": "approved", "notes": "looks good"})
            assert review_res.status_code == 200
            assert review_res.json()["status"] == "approved"

            final_status = await client.get(f"/v1/briefs/{run_id}")
            assert final_status.json()["status"] == "approved"

            # Reviewing an already-reviewed brief is rejected, not silently re-run.
            duplicate_res = await client.post(f"/v1/briefs/{run_id}/review", json={"decision": "approved"})
            assert duplicate_res.status_code == 409


async def test_unknown_client_returns_404() -> None:
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post("/v1/briefs", json={"client_slug": "does-not-exist", "brief_type": "gmv"})
            assert res.status_code == 404


async def test_wrong_north_star_client_returns_404() -> None:
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            # cimory is north_star='vtr', not 'shop' — GMV brief must refuse it.
            res = await client.post("/v1/briefs", json={"client_slug": "cimory", "brief_type": "gmv"})
            assert res.status_code == 404


async def test_unknown_run_id_returns_404() -> None:
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get("/v1/briefs/run_does_not_exist")
            assert res.status_code == 404
