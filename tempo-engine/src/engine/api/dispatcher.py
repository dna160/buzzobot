"""Brief lifecycle: start a run through the graph up to the review
interrupt, resume it with a human decision. PRD §1.1's interface, minus
onboarding/trace (not built — B12/probe-trace territory).

Content v2 (Brief Deck PRD §3.1): `_content_from_state` exports the run's
whole analytical state — findings, rankings including everything below the
cut, the coverage audit, the probe log — not the four narrated keys v1
exported. The projection into slides is `buildDeckModel`'s job on the
TypeScript side; this boundary chooses nothing.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime

import asyncpg
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command

from engine.api.edits import Edit, apply_edits, record_edits
from engine.contracts.content import BriefContentV2, CardCopy, CoverageAudit, ProbeLoopExport, SectionEntry, SectionRankingExport, SynthesisEntry, Tier
from engine.contracts.strategy import ReportClass
from engine.contracts.presets import OBJECTIVE_CONTRACTS
from engine.graphs.persistence import fetch_brief, upsert_brief
from engine.materiality.persistence import persist_ranking_state
from engine.ports.strategy_read import build_strategy_frame
from engine.ports.tempo_read import build_awareness_metric_frame, build_gmv_metric_frame, build_install_metric_frame
from engine.version import ENGINE_VERSION

# One live-Tempo adapter per brief type — mirrors GENERATORS_BY_BRIEF_TYPE
# in graphs/brief.py, same reasoning: every brief type is a peer, none is
# the hardcoded default.
_FRAME_BUILDERS = {
    "gmv": build_gmv_metric_frame,
    "awareness": build_awareness_metric_frame,
    "install": build_install_metric_frame,
}


log = logging.getLogger(__name__)


class BriefNotFoundError(Exception):
    pass


class ClientNotEligibleError(Exception):
    """No ingested data, or the client's north_star doesn't match this
    brief type (see the relevant build_*_metric_frame's own gating)."""


def _content_from_state(state: dict) -> dict:
    """Widened in Brief Deck M0. Every v1 key keeps its name and shape, so a
    caller reading `content["s1"]` is unaffected; `content_version` is how a
    caller knows the rest is there.

    `tier` and `brief_type` are read back out of the graph state rather than
    passed in, so a resumed run reports the tier it actually ran under even
    though the resume call carries only a decision.
    """
    tier: Tier = "instant" if state.get("tier") == "instant" else "full"
    brief_type = str(state.get("brief_type", ""))
    rankings = {
        section_id: SectionRankingExport(
            selected=entry.get("selected_ids", []),
            below_cut=entry.get("below_cut", []),
        )
        for section_id, entry in (state.get("rankings") or {}).items()
    }
    coverage_dump = state.get("coverage")
    content = BriefContentV2(
        tier=tier,
        engine_version=ENGINE_VERSION,
        brief_type=brief_type,
        s1=SynthesisEntry.model_validate(state["s1_result"]) if state.get("s1_result") else None,
        sections={
            section_id: SectionEntry.model_validate(entry)
            for section_id, entry in (state.get("section_drafts") or {}).items()
        },
        s6=SynthesisEntry.model_validate(state["s6_result"]) if state.get("s6_result") else None,
        findings=state.get("findings") or [],
        card_copy={
            finding_id: CardCopy.model_validate(copy)
            for finding_id, copy in (state.get("card_copy") or {}).items()
        },
        rankings=rankings,
        coverage=CoverageAudit.model_validate(coverage_dump) if coverage_dump else None,
        probe_loop=ProbeLoopExport(
            enabled=bool(state.get("probe_loop_enabled", False)),
            probes_executed=int(state.get("probes_executed", 0) or 0),
            yield_rate=float(state.get("probe_yield_rate", 0.0) or 0.0),
            rounds_used=int(state.get("probe_rounds_used", 0) or 0),
            log=state.get("probe_log") or [],
        ),
        report_class=state.get("report_class"),
        action_plan=(
            [a for a in (state.get("strategy_actions") or []) if int(a.get("rank", 99)) <= 3]
            if brief_type == "strategy" else None
        ),
        signals=state.get("signals"),
        goal_pace=state.get("goal_pace"),
        action_log=state.get("action_log"),
        charts=state.get("charts"),
        meta=state.get("strategy_meta"),
    )
    return content.model_dump(mode="json", by_alias=True)


@dataclass(frozen=True)
class PreparedRun:
    run_id: str
    tenant_id: str
    brief_type: str
    tier: Tier
    initial_state: dict


async def prepare_brief_run(
    *,
    read_conn: asyncpg.Connection,
    client_slug: str,
    brief_type: str,
    window_days: int = 7,
    end_date: date | None = None,
    tier: Tier = "full",
    report_class: ReportClass | None = None,
) -> PreparedRun:
    """Build the frame and the graph's initial state. Raises
    `ClientNotEligibleError` before any row is written, so an ineligible
    client is a 404 at request time, never a failed run in the table."""
    run_id = f"run_{uuid.uuid4().hex[:16]}"
    if brief_type == "strategy":
        # Strategy Report (PRD §7.1): eligibility is a mirrored TTMS account
        # with ≥ 14 days of audience — north star is deliberately not a gate.
        sframe = await build_strategy_frame(
            read_conn, client_slug, end_date=end_date, window_days=window_days, report_class=report_class,
        )
        if sframe is None:
            raise ClientNotEligibleError(f"'{client_slug}' has no Market Scope account with at least 14 days of data")
        return PreparedRun(run_id, sframe.tenant_id, "strategy", tier, {
            "tenant_id": sframe.tenant_id, "brief_type": "strategy", "run_id": run_id,
            "strategy_frame": sframe.model_dump(mode="json"), "tier": tier,
        })

    build_frame = _FRAME_BUILDERS.get(brief_type)
    if build_frame is None:
        raise ClientNotEligibleError(f"brief_type {brief_type!r} not supported (expected one of {sorted(_FRAME_BUILDERS)})")
    frame = await build_frame(read_conn, client_slug, end_date=end_date, window_days=window_days)
    if frame is None:
        raise ClientNotEligibleError(
            f"'{client_slug}' has no ingested paid data, or its north_star doesn't match the {brief_type!r} brief"
        )
    return PreparedRun(run_id, frame.tenant_id, brief_type, tier, {
        "tenant_id": frame.tenant_id, "brief_type": brief_type, "run_id": run_id,
        "metric_frame": frame.model_dump(mode="json"),
        "objective_contract": OBJECTIVE_CONTRACTS[brief_type].model_dump(mode="json"), "tier": tier,
    })


async def execute_brief_run(*, graph: CompiledStateGraph, read_conn: asyncpg.Connection, run: PreparedRun) -> dict:
    """Run the graph to the review interrupt, persist the brief as
    `pending_review`, and write the materiality audit rows (PRD §13 #6)."""
    config = {"configurable": {"thread_id": run.run_id}}
    result = await graph.ainvoke(run.initial_state, config=config)
    await upsert_brief(
        read_conn, run_id=run.run_id, tenant_id=run.tenant_id, brief_type=run.brief_type,
        status="pending_review", content=_content_from_state(result),
    )
    try:
        await persist_ranking_state(read_conn, run.run_id, run.tenant_id, run.brief_type, result)
    except Exception as exc:  # noqa: BLE001 - the audit trail must never fail the run it audits
        log.warning("materiality rankings not persisted for %s: %s", run.run_id, exc)
    return {"run_id": run.run_id, "tenant_id": run.tenant_id, "status": "pending_review", "tier": run.tier}


async def start_brief_run(
    *,
    graph: CompiledStateGraph,
    read_conn: asyncpg.Connection,
    client_slug: str,
    brief_type: str,
    window_days: int = 7,
    end_date: date | None = None,
    tier: Tier = "full",
    report_class: ReportClass | None = None,
) -> dict:
    """Blocking start: returns once the run is paused at the review gate.
    `/v1/briefs/sync` and the tests use it; `POST /v1/briefs` uses
    `start_brief_run_async`."""
    run = await prepare_brief_run(
        read_conn=read_conn, client_slug=client_slug, brief_type=brief_type, window_days=window_days,
        end_date=end_date, tier=tier, report_class=report_class,
    )
    return await execute_brief_run(graph=graph, read_conn=read_conn, run=run)


# Strong references to in-flight background runs: the event loop keeps only
# weak ones, and a run collected mid-flight would leave its row `running`.
_BACKGROUND: set[asyncio.Task] = set()


async def start_brief_run_async(
    *,
    graph: CompiledStateGraph,
    read_conn: asyncpg.Connection,
    client_slug: str,
    brief_type: str,
    window_days: int = 7,
    end_date: date | None = None,
    tier: Tier = "full",
    report_class: ReportClass | None = None,
    auto_approve: bool = False,
) -> dict:
    """PRD §13 #1: write the `insight.brief` row as `running`, start the graph
    in a background task, and return the run id at once. `GET
    /v1/briefs/{run_id}` reports `running` → `pending_review` (or `approved`
    with `auto_approve`) → or `failed` with the error in `content.error`."""
    run = await prepare_brief_run(
        read_conn=read_conn, client_slug=client_slug, brief_type=brief_type, window_days=window_days,
        end_date=end_date, tier=tier, report_class=report_class,
    )
    await upsert_brief(
        read_conn, run_id=run.run_id, tenant_id=run.tenant_id, brief_type=run.brief_type, status="running",
        content={"tier": run.tier, "brief_type": run.brief_type, "started_at": datetime.now(UTC).isoformat()},
    )

    async def _run() -> None:
        try:
            await execute_brief_run(graph=graph, read_conn=read_conn, run=run)
            if auto_approve:
                await resume_brief_review(
                    graph=graph, read_conn=read_conn, run_id=run.run_id,
                    decision="approved", notes="auto-approved (async run)",
                )
        except Exception as exc:  # noqa: BLE001 - recorded on the row; the caller polls for it
            log.exception("background run %s failed", run.run_id)
            await upsert_brief(
                read_conn, run_id=run.run_id, tenant_id=run.tenant_id, brief_type=run.brief_type, status="failed",
                content={"tier": run.tier, "brief_type": run.brief_type, "error": f"{type(exc).__name__}: {exc}"[:500]},
            )

    task = asyncio.create_task(_run(), name=f"brief-{run.run_id}")
    _BACKGROUND.add(task)
    task.add_done_callback(_BACKGROUND.discard)
    return {"run_id": run.run_id, "tenant_id": run.tenant_id, "status": "running", "tier": run.tier}


async def run_brief_sync(
    *,
    graph: CompiledStateGraph,
    read_conn: asyncpg.Connection,
    client_slug: str,
    brief_type: str,
    window_days: int = 7,
    end_date: date | None = None,
    tier: Tier = "full",
    report_class: ReportClass | None = None,
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
        brief_type=brief_type, window_days=window_days, end_date=end_date, tier=tier, report_class=report_class,
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
    edits: list[Edit] | None = None,
    editor: str | None = None,
) -> dict:
    """Resume at the review gate. `edits` (approve only) change narrated text
    before the brief is stored and are recorded in `insight.brief_edits`
    (Strategy Report PRD §11.4); an invalid edit raises `EditError` before the
    graph is resumed, so a bad request never half-approves a run."""
    existing = await fetch_brief(read_conn, run_id)
    if existing is None:
        raise BriefNotFoundError(run_id)
    if existing["status"] != "pending_review":
        raise ValueError(f"run {run_id!r} is already {existing['status']!r}, not pending review")
    edits = edits if decision == "approved" else None
    if edits:
        stored = existing["content"] if isinstance(existing["content"], dict) else json.loads(existing["content"])
        apply_edits(json.loads(json.dumps(stored)), edits)  # validate against a copy

    config = {"configurable": {"thread_id": run_id}}
    resumed = await graph.ainvoke(Command(resume={"decision": decision, "notes": notes}), config=config)

    status = "approved" if decision == "approved" else "rejected"
    content = _content_from_state(resumed)
    applied = apply_edits(content, edits) if edits else []
    await upsert_brief(
        read_conn, run_id=run_id, tenant_id=existing["tenant_id"], brief_type=existing["brief_type"],
        status=status, content=content,
    )
    await record_edits(
        read_conn, run_id=run_id, tenant_id=existing["tenant_id"], brief_type=existing["brief_type"], edits=applied, editor=editor,
    )
    return {"run_id": run_id, "status": status, "edits": len(applied)}
