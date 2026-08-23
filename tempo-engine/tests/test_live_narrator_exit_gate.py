"""B4 exit criteria: "100% numeral fidelity over 20 runs; fallback < 5%."

Numeral fidelity is 100% by construction — `narrate_section` never returns
an `llm`-sourced draft that failed the numeral gate (agents/narrator.py's
control flow only reaches the `return NarrationResult(..., source="llm")`
line after the gate passed). This test independently re-runs the numeral
gate against every llm-sourced draft anyway, against the exact findings
that call used, so a control-flow bug that skipped the gate would still be
caught here rather than trusted on faith.

The real empirical question is the fallback rate: does the actual model
(google/gemma-4-12b via LM Studio, PRD §7's exact spec) produce schema-valid,
numeral-clean output often enough in practice. Skipped without a reachable
LM Studio server.
"""

from __future__ import annotations

import httpx
import pytest

from engine.agents.narrator import narrate_section
from engine.contracts import SectionPayload
from engine.gates.numeral_gate import run_numeral_gate
from engine.generators.base import GeneratorContext
from engine.generators.gmv import GMV_GENERATORS
from engine.generators.shared import SHARED_GENERATORS, assess_confidence_tier
from engine.llm.client import LmStudioClient
from engine.llm.schemas import SectionDraftFull
from engine.materiality import route_all_sections, score_findings
from eval.fixtures.sovella_gmv_week import GMV_OBJECTIVE_CONTRACT, TENANT_ID, build_sovella_gmv_metric_frame

ALL_GENERATORS = (*SHARED_GENERATORS, *GMV_GENERATORS)
TARGET_RUNS = 20
MAX_FALLBACK_RATE = 0.05


def _lm_studio_reachable() -> bool:
    try:
        httpx.get("http://localhost:1234/v1/models", timeout=3.0).raise_for_status()
        return True
    except httpx.HTTPError:
        return False


pytestmark = pytest.mark.skipif(not _lm_studio_reachable(), reason="requires a reachable LM Studio server")


def _rankings():
    ctx = GeneratorContext(metric_frame=build_sovella_gmv_metric_frame(), objective_contract=GMV_OBJECTIVE_CONTRACT)
    findings = [f for gen in ALL_GENERATORS for f in gen.run(ctx).findings]
    return route_all_sections(score_findings(findings, "gmv")), ctx.metric_frame


async def test_numeral_fidelity_and_fallback_rate_over_20_runs() -> None:
    rankings, frame = _rankings()
    confidence_tier = assess_confidence_tier(frame)
    client = LmStudioClient()

    section_ids = list(rankings.keys())
    runs = []  # (NarrationResult, SectionPayload) pairs
    for i in range(TARGET_RUNS):
        section_id = section_ids[i % len(section_ids)]
        selected = rankings[section_id].selected
        payload = SectionPayload(
            tenant_id=TENANT_ID,
            brief_type="gmv",
            section_id=section_id,
            objective_contract=GMV_OBJECTIVE_CONTRACT,
            findings=selected,
            confidence_tier=confidence_tier,
        )
        result = await narrate_section(payload, client)
        runs.append((result, payload))

    fallback_count = sum(1 for r, _ in runs if r.source == "fallback")
    fallback_rate = fallback_count / len(runs)
    llm_runs = [(r, p) for r, p in runs if r.source == "llm"]

    for result, payload in llm_runs:
        text = result.draft.headline + " " + result.draft.mechanism + " " + result.draft.action
        if isinstance(result.draft, SectionDraftFull):
            text += " " + result.draft.implication
        gate = run_numeral_gate(text, payload.findings)
        assert gate.ok, f"llm-sourced draft failed independent numeral re-check: {gate.violations}"
        assert result.draft.evidence_refs

    print(
        f"\n[B4 exit gate] {len(runs)} runs, {fallback_count} fallback ({fallback_rate:.1%}), "
        f"{len(llm_runs)} llm-sourced, 100% numeral fidelity confirmed on all llm-sourced drafts"
    )

    assert fallback_rate < MAX_FALLBACK_RATE, (
        f"fallback rate {fallback_rate:.1%} exceeds the {MAX_FALLBACK_RATE:.0%} target "
        f"({fallback_count}/{len(runs)} runs fell back)"
    )
