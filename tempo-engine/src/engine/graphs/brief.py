"""The brief graph (PRD §4.1): data_steward -> generator fan-out -> probe
loop (B7, kill-switched via PROBE_LOOP_ENABLED) -> materiality+router ->
narrate S2-S5 (sequential here; LangGraph's own parallel dispatch is a
tuning pass once there's a latency budget to tune against, not a B5 concern)
-> critic (per section) -> numeral gate (inline in narrate/critique — see
agents/narrator.py, agents/critic.py) -> synthesist (S6 then S1) ->
interrupt() -> insight.brief.

Generation tiers (Brief Deck PRD §5): `tier` in the initial state picks the
path. `full` (the default, and what every caller got before tiers existed)
runs the graph above unchanged. `instant` routes generator_fanout ->
materiality_router -> instant_copy -> review_gate: no probe loop, no
narrators, no critic, no synthesist, and therefore **zero model calls**, with
prose written from the closed `claim_frame` template table in engine/copy/.
Both tiers pass through the same `interrupt()` review gate and produce the
same content shape — a tier is a copy source, not a different document.

Probe loop kill switch (PRD §11 risk #1, Hard Rule): `PROBE_LOOP_ENABLED`
env var, default "true" — B7's own live exit-gate test is the evidence the
measured yield clears the ≥0.4 bar; set to "false"/"0" to force pre-B7
behaviour (generator findings only, zero extra LM Studio round-trips)
without touching this file.

State is plain JSON-serializable dicts, not raw Pydantic objects — explicit
and safe for the Postgres checkpointer's serializer rather than relying on
its Pydantic support working the way I'd guess.

DB access is deliberately NOT threaded through graph nodes: `tempo_read.py`
(B0) is the only module that reads Tempo, and this graph does not read or
write Postgres directly either — `run_brief_graph` takes an already-built
`MetricFrame` and returns the finished (or interrupted) state; persisting to
`insight.brief` is the caller's job (`persist_brief`, using the same
connection pattern as every other insight.* writer in this codebase).
"""

from __future__ import annotations

import os
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from engine.agents.analyst import run_probe_loop
from engine.agents.critic import critique_section
from engine.agents.narrator import narrate_section
from engine.agents.synthesist import synthesize_s1, synthesize_s6
from engine.contracts import Finding, MetricFrame, ObjectiveContract, SectionId, SectionPayload
from engine.copy import instant_s1_draft, instant_s6_draft, instant_section_draft
from engine.generators.base import CoverageGap
from engine.generators.awareness import AWARENESS_GENERATORS
from engine.generators.base import Generator, GeneratorContext
from engine.generators.gmv import GMV_GENERATORS
from engine.generators.install import INSTALL_GENERATORS
from engine.generators.shared import SHARED_GENERATORS, assess_confidence_tier
from engine.graphs.coverage import build_coverage_audit
from engine.llm.client import LmStudioClient
from engine.llm.schemas import json_schema_for
from engine.materiality import route_all_sections, score_findings


def _probe_loop_enabled() -> bool:
    return os.environ.get("PROBE_LOOP_ENABLED", "true").strip().lower() not in ("false", "0", "")


# One battery per brief type (PRD §6.3) — every brief type shares G01-G08
# and adds its own objective-specific generators (M01-M04 / A01-A04 / N01-N04).
GENERATORS_BY_BRIEF_TYPE: dict[str, tuple[Generator, ...]] = {
    "gmv": (*SHARED_GENERATORS, *GMV_GENERATORS),
    "awareness": (*SHARED_GENERATORS, *AWARENESS_GENERATORS),
    "install": (*SHARED_GENERATORS, *INSTALL_GENERATORS),
}
NARRATOR_SECTIONS: tuple[SectionId, ...] = (
    SectionId.S2_PERIOD_COMPARISON,
    SectionId.S3_PRIMARY_CHANNEL,
    SectionId.S4_SECONDARY_CHANNEL_FUNNEL,
    SectionId.S5_CREATIVE_ENTITY,
)


class BriefState(TypedDict, total=False):
    tenant_id: str
    brief_type: str
    run_id: str
    tier: str  # "instant" | "full"; absent means "full" (pre-tier behaviour)
    metric_frame: dict
    objective_contract: dict
    findings: list[dict]
    coverage_gaps: list[dict]  # CoverageGap dumps from generators that skipped
    coverage: dict  # CoverageAudit dump — exported at the boundary (deck PRD §3.1)
    rankings: dict[str, dict]  # {"2": {"selected_ids": [...], "below_cut": [...]}, ...}
    section_drafts: dict[str, dict]  # {"2": {"draft": {...}, "source": "llm", ...}, ...}
    s6_result: dict
    s1_result: dict
    review_decision: dict
    probe_loop_enabled: bool
    probes_executed: int
    probe_yield_rate: float
    probe_rounds_used: int
    probe_log: list[dict]


async def data_steward_node(state: BriefState) -> dict[str, Any]:
    # Validates the frame parses under the contract — the actual fetch
    # already happened in tempo_read.py, before this graph was invoked.
    MetricFrame.model_validate(state["metric_frame"])
    return {}


async def generator_fanout_node(state: BriefState) -> dict[str, Any]:
    frame = MetricFrame.model_validate(state["metric_frame"])
    contract = ObjectiveContract.model_validate(state["objective_contract"])
    ctx = GeneratorContext(metric_frame=frame, objective_contract=contract)
    generators = GENERATORS_BY_BRIEF_TYPE[state["brief_type"]]
    results = [gen.run(ctx) for gen in generators]
    findings = [f for r in results for f in r.findings]
    # A generator that skipped for a missing metric is evidence, not noise —
    # it is the denominator behind "4 dari 6 sinyal tersedia" (deck PRD §4).
    # Discarding it here is what made the old boundary unable to tell a thin
    # period from a complete one.
    gaps = [r.coverage_gap.model_dump(mode="json") for r in results if r.coverage_gap is not None]
    return {"findings": [f.model_dump(mode="json") for f in findings], "coverage_gaps": gaps}


async def probe_loop_node(state: BriefState) -> dict[str, Any]:
    enabled = _probe_loop_enabled()
    if not enabled:
        return {"probe_loop_enabled": False, "probes_executed": 0, "probe_yield_rate": 0.0, "probe_rounds_used": 0, "probe_log": []}

    findings = [Finding.model_validate(f) for f in state["findings"]]
    frame = MetricFrame.model_validate(state["metric_frame"])
    contract = ObjectiveContract.model_validate(state["objective_contract"])
    client = LmStudioClient()

    result = await run_probe_loop(
        findings, frame, contract, tenant_id=state["tenant_id"], brief_type=state["brief_type"], client=client,
    )
    merged = [*state["findings"], *[f.model_dump(mode="json") for f in result.new_findings]]
    probe_log = [
        {
            "probe": entry.probe.model_dump(mode="json"),
            "result_ok": entry.result_ok,
            "reason": entry.reason,
            "finding_id": entry.finding_id,
        }
        for entry in result.probe_log
    ]
    return {
        "findings": merged,
        "probe_loop_enabled": True,
        "probes_executed": result.probes_executed,
        "probe_yield_rate": result.yield_rate,
        "probe_rounds_used": result.rounds_used,
        "probe_log": probe_log,
    }


async def materiality_router_node(state: BriefState) -> dict[str, Any]:
    findings = [Finding.model_validate(f) for f in state["findings"]]
    scored = score_findings(findings, state["brief_type"])
    rankings = route_all_sections(scored)
    # `selected_ids` is what this graph reads back (see `_selected_findings`);
    # `below_cut` is carried for the boundary only — PRD §6.5's "everything
    # below the cut is the only signal that tells us the presets are wrong",
    # which Lampiran C renders and nothing else consumes.
    rankings_serialized = {
        str(int(sid)): {
            "selected_ids": [f.id for f in r.selected],
            "below_cut": [
                {"id": entry.finding.id, "materiality": entry.finding.materiality}
                for entry in r.ranked
                if not entry.included
            ],
        }
        for sid, r in rankings.items()
    }
    gaps = [CoverageGap.model_validate(g) for g in state.get("coverage_gaps", [])]
    coverage = build_coverage_audit(scored, gaps)
    return {
        "findings": [f.model_dump(mode="json") for f in scored],
        "rankings": rankings_serialized,
        "coverage": coverage.model_dump(mode="json"),
    }


def _selected_findings(state: BriefState, section_id: SectionId, findings_by_id: dict[str, Finding]) -> list[Finding]:
    ids = state.get("rankings", {}).get(str(int(section_id)), {}).get("selected_ids", [])
    return [findings_by_id[i] for i in ids if i in findings_by_id]


async def narrate_and_critique_node(state: BriefState) -> dict[str, Any]:
    findings = [Finding.model_validate(f) for f in state["findings"]]
    findings_by_id = {f.id: f for f in findings}
    contract = ObjectiveContract.model_validate(state["objective_contract"])
    frame = MetricFrame.model_validate(state["metric_frame"])
    tier = assess_confidence_tier(frame)
    client = LmStudioClient()

    section_drafts: dict[str, dict] = {}
    for section_id in NARRATOR_SECTIONS:
        selected = _selected_findings(state, section_id, findings_by_id)
        payload = SectionPayload(
            tenant_id=state["tenant_id"], brief_type=state["brief_type"], section_id=section_id,
            objective_contract=contract, findings=selected, confidence_tier=tier,
        )
        result = await narrate_section(payload, client)
        draft_json = result.draft.model_dump(mode="json")

        critic_result = await critique_section(draft_json, json_schema_for(tier), selected, client)
        final_draft = critic_result.revised_draft_json if critic_result.ok else draft_json

        section_drafts[str(int(section_id))] = {
            "draft": final_draft,
            "narration_source": result.source,
            "narration_attempts": result.attempts,
            "critic_ok": critic_result.ok,
            "critic_approved": critic_result.approved,
            "critic_notes": critic_result.notes,
        }

    return {"section_drafts": section_drafts}


INSTANT_SOURCE = "template"


async def instant_copy_node(state: BriefState) -> dict[str, Any]:
    """The instant tier's whole copy layer (PRD §5). Same section slots, same
    S6/S1 ordering (S1 last, from accepted headlines only), same content shape
    — written from the `claim_frame` template table instead of the narrators.

    No LM Studio client is constructed here. That is the tier's contract, and
    `tests/test_instant_tier.py` asserts it by failing the test if the client
    is instantiated at all.
    """
    findings = [Finding.model_validate(f) for f in state["findings"]]
    findings_by_id = {f.id: f for f in findings}
    confidence_tier = assess_confidence_tier(MetricFrame.model_validate(state["metric_frame"]))

    section_drafts: dict[str, dict] = {}
    accepted_headlines: list[str] = []
    for section_id in NARRATOR_SECTIONS:
        selected = _selected_findings(state, section_id, findings_by_id)
        draft = instant_section_draft(selected, confidence_tier)
        section_drafts[str(int(section_id))] = {
            "draft": draft.model_dump(mode="json"),
            "narration_source": INSTANT_SOURCE,
            "narration_attempts": 0,
            "critic_ok": None,
            "critic_approved": None,
            "critic_notes": None,
        }
        accepted_headlines.append(draft.headline)

    s6_findings = _selected_findings(state, SectionId.S6_RISK_ACTIONS_OUTLOOK, findings_by_id)
    s6_draft = instant_s6_draft(s6_findings, confidence_tier)
    if s6_draft.risks:
        accepted_headlines.append(s6_draft.risks[0].risk)
    s1_draft = instant_s1_draft(accepted_headlines)

    return {
        "section_drafts": section_drafts,
        "s6_result": {
            "draft": s6_draft.model_dump(mode="json"),
            "source": INSTANT_SOURCE,
            "attempts": 0,
            "fallback_reason": None,
        },
        "s1_result": {
            "draft": s1_draft.model_dump(mode="json"),
            "source": INSTANT_SOURCE,
            "attempts": 0,
            "fallback_reason": None,
        },
        # The probe loop never ran; say so explicitly rather than leaving the
        # keys absent, so the deck's provenance footer reads "0 probes" and
        # not "unknown".
        "probe_loop_enabled": False,
        "probes_executed": 0,
        "probe_yield_rate": 0.0,
        "probe_rounds_used": 0,
        "probe_log": [],
    }


async def synthesist_node(state: BriefState) -> dict[str, Any]:
    findings = [Finding.model_validate(f) for f in state["findings"]]
    findings_by_id = {f.id: f for f in findings}
    client = LmStudioClient()

    summary_parts = []
    accepted_headlines = []
    narrated_findings: list[Finding] = []
    for section_id in NARRATOR_SECTIONS:
        entry = state["section_drafts"].get(str(int(section_id)))
        if not entry:
            continue
        headline = entry["draft"].get("headline", "")
        accepted_headlines.append(headline)
        summary_parts.append(f"S{int(section_id)}: {headline}")
        narrated_findings.extend(_selected_findings(state, section_id, findings_by_id))
    accepted_summary = " ".join(summary_parts)

    s6_findings = _selected_findings(state, SectionId.S6_RISK_ACTIONS_OUTLOOK, findings_by_id)
    s6_result = await synthesize_s6(s6_findings, accepted_summary, client)
    if s6_result.draft.risks:
        accepted_headlines.append(s6_result.draft.risks[0].risk)
        summary_parts.append(f"S6: {s6_result.draft.risks[0].risk}")

    all_used_findings = narrated_findings + s6_findings
    s1_result = await synthesize_s1(accepted_headlines, all_used_findings, " ".join(summary_parts), client)

    return {
        "s6_result": {
            "draft": s6_result.draft.model_dump(mode="json"),
            "source": s6_result.source,
            "attempts": s6_result.attempts,
            "fallback_reason": s6_result.fallback_reason,
        },
        "s1_result": {
            "draft": s1_result.draft.model_dump(mode="json"),
            "source": s1_result.source,
            "attempts": s1_result.attempts,
            "fallback_reason": s1_result.fallback_reason,
        },
    }


async def review_gate_node(state: BriefState) -> dict[str, Any]:
    """PRD §4.1 step 8, §10: LangGraph `interrupt()` pauses the graph here;
    state persists in the Postgres checkpointer; resuming requires a
    `Command(resume=...)` call with the same thread_id (the run_id)."""
    rendered = {
        "s1": state.get("s1_result"),
        "sections": state.get("section_drafts"),
        "s6": state.get("s6_result"),
    }
    decision = interrupt({"brief": rendered})
    return {"review_decision": decision}


def _is_instant(state: BriefState) -> bool:
    return state.get("tier", "full") == "instant"


def _route_after_generators(state: BriefState) -> str:
    """The probe loop is an agent loop — it is the first thing the instant
    tier skips, before materiality, so an instant run never opens a socket."""
    return "materiality_router" if _is_instant(state) else "probe_loop"


def _route_after_materiality(state: BriefState) -> str:
    return "instant_copy" if _is_instant(state) else "narrate_and_critique"


def build_brief_graph(checkpointer: object):
    graph: StateGraph[BriefState] = StateGraph(BriefState)
    graph.add_node("data_steward", data_steward_node)
    graph.add_node("generator_fanout", generator_fanout_node)
    graph.add_node("probe_loop", probe_loop_node)
    graph.add_node("materiality_router", materiality_router_node)
    graph.add_node("narrate_and_critique", narrate_and_critique_node)
    graph.add_node("instant_copy", instant_copy_node)
    graph.add_node("synthesist", synthesist_node)
    graph.add_node("review_gate", review_gate_node)

    graph.add_edge(START, "data_steward")
    graph.add_edge("data_steward", "generator_fanout")
    graph.add_conditional_edges(
        "generator_fanout",
        _route_after_generators,
        {"probe_loop": "probe_loop", "materiality_router": "materiality_router"},
    )
    graph.add_edge("probe_loop", "materiality_router")
    graph.add_conditional_edges(
        "materiality_router",
        _route_after_materiality,
        {"narrate_and_critique": "narrate_and_critique", "instant_copy": "instant_copy"},
    )
    graph.add_edge("narrate_and_critique", "synthesist")
    graph.add_edge("synthesist", "review_gate")
    graph.add_edge("instant_copy", "review_gate")
    graph.add_edge("review_gate", END)

    return graph.compile(checkpointer=checkpointer)


BriefStatus = Literal["pending_review", "approved", "rejected"]
