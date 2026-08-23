"""End-to-end brief graph tests against real LM Studio. Two variants:
in-memory checkpointer (fast, proves the graph's control flow and the
interrupt/resume mechanics) and the real Postgres checkpointer (proves the
PRD's actual durability requirement, and that a brief lands in
insight.brief). Skipped without a reachable LM Studio server; the Postgres
variant additionally requires TEMPO_ENGINE_DATABASE_URL.
"""

from __future__ import annotations

import os

import httpx
import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.types import Command

from engine.graphs.brief import build_brief_graph
from engine.graphs.persistence import ensure_schema, fetch_brief, insight_checkpointer_conninfo, upsert_brief
from engine.ports.tempo_read import connect
from eval.fixtures.sovella_gmv_week import GMV_OBJECTIVE_CONTRACT, TENANT_ID, build_sovella_gmv_metric_frame


def _lm_studio_reachable() -> bool:
    try:
        httpx.get("http://localhost:1234/v1/models", timeout=3.0).raise_for_status()
        return True
    except httpx.HTTPError:
        return False


pytestmark = pytest.mark.skipif(not _lm_studio_reachable(), reason="requires a reachable LM Studio server")


def _initial_state(run_id: str) -> dict:
    frame = build_sovella_gmv_metric_frame()
    return {
        "tenant_id": TENANT_ID,
        "brief_type": "gmv",
        "run_id": run_id,
        "metric_frame": frame.model_dump(mode="json"),
        "objective_contract": GMV_OBJECTIVE_CONTRACT.model_dump(mode="json"),
    }


async def test_brief_graph_pauses_at_review_and_resumes_with_in_memory_checkpointer() -> None:
    checkpointer = InMemorySaver()
    graph = build_brief_graph(checkpointer)
    config = {"configurable": {"thread_id": "test_run_memory"}}

    result = await graph.ainvoke(_initial_state("test_run_memory"), config=config)

    # The graph paused at interrupt() — no review_decision yet, but every
    # earlier stage ran to completion.
    assert "review_decision" not in result or result.get("review_decision") is None
    assert result["section_drafts"]
    assert set(result["section_drafts"].keys()) == {"2", "3", "4", "5"}
    for entry in result["section_drafts"].values():
        assert entry["draft"]["headline"]
    assert result["s6_result"]["draft"]["risks"]
    assert result["s1_result"]["draft"]["headline"]

    resumed = await graph.ainvoke(Command(resume={"decision": "approved"}), config=config)
    assert resumed["review_decision"] == {"decision": "approved"}


async def test_brief_graph_with_postgres_checkpointer_persists_to_insight_brief() -> None:
    if "TEMPO_ENGINE_DATABASE_URL" not in os.environ:
        pytest.skip("requires TEMPO_ENGINE_DATABASE_URL")

    db_url = os.environ["TEMPO_ENGINE_DATABASE_URL"]
    conninfo = insight_checkpointer_conninfo(db_url)

    run_id = "test_run_pg_001"
    async with AsyncPostgresSaver.from_conn_string(conninfo) as checkpointer:
        await checkpointer.setup()  # idempotent; creates LangGraph's own checkpoint tables in insight schema
        graph = build_brief_graph(checkpointer)
        config = {"configurable": {"thread_id": run_id}}

        result = await graph.ainvoke(_initial_state(run_id), config=config)
        assert result["s1_result"]["draft"]["headline"]

        conn = await connect(db_url)
        try:
            await ensure_schema(conn)
            await upsert_brief(
                conn, run_id=run_id, tenant_id=TENANT_ID, brief_type="gmv",
                status="pending_review",
                content={"s1": result["s1_result"], "sections": result["section_drafts"], "s6": result["s6_result"]},
            )
            row = await fetch_brief(conn, run_id)
            assert row is not None
            assert row["status"] == "pending_review"
            assert row["tenant_id"] == TENANT_ID

            resumed = await graph.ainvoke(Command(resume={"decision": "approved"}), config=config)
            await upsert_brief(
                conn, run_id=run_id, tenant_id=TENANT_ID, brief_type="gmv",
                status="approved",
                content={"s1": resumed["s1_result"], "sections": resumed["section_drafts"], "s6": resumed["s6_result"]},
            )
            row = await fetch_brief(conn, run_id)
            assert row["status"] == "approved"
        finally:
            await conn.execute("DELETE FROM insight.brief WHERE run_id = $1", run_id)
            await conn.close()
