"""Brief lifecycle: start a run through the graph up to the review
interrupt, resume it with a human decision. PRD §1.1's interface, minus
onboarding/trace (not built — B12/probe-trace territory).
"""

from __future__ import annotations

import uuid
from datetime import date

import asyncpg
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command

from engine.contracts.presets import OBJECTIVE_CONTRACTS
from engine.graphs.persistence import fetch_brief, upsert_brief
from engine.ports.tempo_read import build_awareness_metric_frame, build_gmv_metric_frame, build_install_metric_frame

# One live-Tempo adapter per brief type — mirrors GENERATORS_BY_BRIEF_TYPE
# in graphs/brief.py, same reasoning: every brief type is a peer, none is
# the hardcoded default.
_FRAME_BUILDERS = {
    "gmv": build_gmv_metric_frame,
    "awareness": build_awareness_metric_frame,
    "install": build_install_metric_frame,
}


class BriefNotFoundError(Exception):
    pass


class ClientNotEligibleError(Exception):
    """No ingested data, or the client's north_star doesn't match this
    brief type (see the relevant build_*_metric_frame's own gating)."""


def _content_from_state(state: dict) -> dict:
    return {
        "s1": state.get("s1_result"),
        "sections": state.get("section_drafts"),
        "s6": state.get("s6_result"),
        "probe_loop": {
            "enabled": state.get("probe_loop_enabled"),
            "probes_executed": state.get("probes_executed"),
            "yield_rate": state.get("probe_yield_rate"),
            "rounds_used": state.get("probe_rounds_used"),
            "log": state.get("probe_log"),
        },
    }


async def start_brief_run(
    *,
    graph: CompiledStateGraph,
    read_conn: asyncpg.Connection,
    client_slug: str,
    brief_type: str,
    window_days: int = 7,
    end_date: date | None = None,
) -> dict:
    build_frame = _FRAME_BUILDERS.get(brief_type)
    if build_frame is None:
        raise ClientNotEligibleError(f"brief_type {brief_type!r} not supported (expected one of {sorted(_FRAME_BUILDERS)})")

    frame = await build_frame(read_conn, client_slug, end_date=end_date, window_days=window_days)
    if frame is None:
        raise ClientNotEligibleError(
            f"'{client_slug}' has no ingested paid data, or its north_star doesn't match the {brief_type!r} brief"
        )

    run_id = f"run_{uuid.uuid4().hex[:16]}"
    config = {"configurable": {"thread_id": run_id}}
    initial_state = {
        "tenant_id": frame.tenant_id,
        "brief_type": brief_type,
        "run_id": run_id,
        "metric_frame": frame.model_dump(mode="json"),
        "objective_contract": OBJECTIVE_CONTRACTS[brief_type].model_dump(mode="json"),
    }
    result = await graph.ainvoke(initial_state, config=config)

    await upsert_brief(
        read_conn, run_id=run_id, tenant_id=frame.tenant_id, brief_type=brief_type,
        status="pending_review", content=_content_from_state(result),
    )
    return {"run_id": run_id, "tenant_id": frame.tenant_id, "status": "pending_review"}


async def run_brief_sync(
    *,
    graph: CompiledStateGraph,
    read_conn: asyncpg.Connection,
    client_slug: str,
    brief_type: str,
    window_days: int = 7,
    end_date: date | None = None,
) -> dict:
    """`start_brief_run` followed immediately by an auto-approve `resume_
    brief_review` — for callers (Tempo LM's brief buttons) that want a
    finished brief in one synchronous round-trip and have no human review
    UI of their own. The review gate itself is unchanged and still fully
    exercised: this just supplies the "approved" decision automatically
    rather than skipping the graph's `interrupt()`. `tempo-engine`'s own
    `/ui/briefs/{run_id}` page remains available for anyone who wants to
    inspect or reject a run instead of accepting this default.
    """
    started = await start_brief_run(
        graph=graph, read_conn=read_conn, client_slug=client_slug,
        brief_type=brief_type, window_days=window_days, end_date=end_date,
    )
    await resume_brief_review(
        graph=graph, read_conn=read_conn, run_id=started["run_id"],
        decision="approved", notes="auto-approved (Tempo LM brief button integration)",
    )
    return await get_brief_status(read_conn, started["run_id"])


async def get_brief_status(read_conn: asyncpg.Connection, run_id: str) -> dict:
    row = await fetch_brief(read_conn, run_id)
    if row is None:
        raise BriefNotFoundError(run_id)
    import json

    return {
        "run_id": row["run_id"],
        "tenant_id": row["tenant_id"],
        "brief_type": row["brief_type"],
        "status": row["status"],
        "content": row["content"] if isinstance(row["content"], dict) else json.loads(row["content"]),
    }


async def resume_brief_review(
    *,
    graph: CompiledStateGraph,
    read_conn: asyncpg.Connection,
    run_id: str,
    decision: str,
    notes: str = "",
) -> dict:
    existing = await fetch_brief(read_conn, run_id)
    if existing is None:
        raise BriefNotFoundError(run_id)
    if existing["status"] != "pending_review":
        raise ValueError(f"run {run_id!r} is already {existing['status']!r}, not pending review")

    config = {"configurable": {"thread_id": run_id}}
    resumed = await graph.ainvoke(Command(resume={"decision": decision, "notes": notes}), config=config)

    status = "approved" if decision == "approved" else "rejected"
    await upsert_brief(
        read_conn, run_id=run_id, tenant_id=existing["tenant_id"], brief_type=existing["brief_type"],
        status=status, content=_content_from_state(resumed),
    )
    return {"run_id": run_id, "status": status}
