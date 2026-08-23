"""B7 exit criteria (PRD §12): "Measurable depth gain vs. B5 on the gold
set, probe yield >= 0.4."

Yield = findings_produced / probes_executed (`AnalystResult.yield_rate`,
`agents/analyst.py`). A single `run_probe_loop` call is at most 6 probes
across at most 2 rounds, so one call is a small sample; this test runs the
loop several times against the same Sovella gold-set frame (the analyst is
free to ask different questions each time — temperature 0.2, not 0) and
pools probes_executed/new_findings across all runs before computing the
rate, the same "aggregate over repeated live runs" discipline used by B4's
fallback-rate test. Skipped without a reachable LM Studio server.
"""

from __future__ import annotations

import httpx
import pytest

from engine.agents.analyst import run_probe_loop
from engine.generators.base import GeneratorContext
from engine.generators.gmv import GMV_GENERATORS
from engine.generators.shared import SHARED_GENERATORS
from engine.llm.client import LmStudioClient
from eval.fixtures.sovella_gmv_week import GMV_OBJECTIVE_CONTRACT, TENANT_ID, build_sovella_gmv_metric_frame

ALL_GENERATORS = (*SHARED_GENERATORS, *GMV_GENERATORS)
N_RUNS = 5
MIN_YIELD_RATE = 0.4


def _lm_studio_reachable() -> bool:
    try:
        httpx.get("http://localhost:1234/v1/models", timeout=3.0).raise_for_status()
        return True
    except httpx.HTTPError:
        return False


pytestmark = pytest.mark.skipif(not _lm_studio_reachable(), reason="requires a reachable LM Studio server")


def _generator_findings():
    frame = build_sovella_gmv_metric_frame()
    ctx = GeneratorContext(metric_frame=frame, objective_contract=GMV_OBJECTIVE_CONTRACT)
    findings = [f for gen in ALL_GENERATORS for f in gen.run(ctx).findings]
    return findings, frame


async def test_probe_loop_yield_over_5_runs() -> None:
    findings, frame = _generator_findings()
    client = LmStudioClient()

    total_probes = 0
    total_new_findings = 0
    per_run = []
    for i in range(N_RUNS):
        result = await run_probe_loop(
            findings, frame, GMV_OBJECTIVE_CONTRACT,
            tenant_id=TENANT_ID, brief_type="gmv", client=client,
        )
        total_probes += result.probes_executed
        total_new_findings += len(result.new_findings)
        per_run.append((result.probes_executed, len(result.new_findings), result.yield_rate, result.rounds_used))

    pooled_yield = total_new_findings / total_probes if total_probes > 0 else 0.0

    print(f"\n[B7 exit gate] {N_RUNS} probe-loop runs against the Sovella gold set:")
    for i, (probes, produced, rate, rounds) in enumerate(per_run, start=1):
        print(f"  run {i}: {probes} probes, {produced} findings, yield={rate:.2f}, rounds={rounds}")
    print(f"  pooled: {total_new_findings}/{total_probes} = {pooled_yield:.2f} (target >= {MIN_YIELD_RATE})")

    assert total_probes > 0, "the analyst proposed zero probes across all 5 runs — cannot measure yield"
    assert pooled_yield >= MIN_YIELD_RATE, (
        f"pooled probe yield {pooled_yield:.2f} ({total_new_findings}/{total_probes}) "
        f"is below the B7 exit-gate target of {MIN_YIELD_RATE}"
    )
