"""Strategy Report live exit gates (PRD §11.3), against the real LM Studio.

Runs the full tier `STRATEGY_EXIT_GATE_RUNS` times (PRD: 20) on two fixtures
— the frozen BARDI frame (shop class) and the synthetic brand-class frame —
and checks:

| Gate | Threshold |
|---|---|
| Numeral fidelity | 100% of accepted sections |
| Fallback rate | < 5% of sections; < 10% of action copies |
| Action gate pass@1 | ≥ 80% |
| Chip gate pass@1 | ≥ 80% |
| Class-highlight gate | 100%, and brand/shop differ in T6 content and order |
| Generic-sentence detector | 0 flagged paragraphs in accepted sections |
| Wall clock | p95 ≤ 600 s |
| Cloud calls | 0 requests to any host but `LM_STUDIO_URL`'s |

`STRATEGY_EXIT_GATE_OUT=path.json` writes the per-run numbers. Skipped when
LM Studio is not reachable.
"""

from __future__ import annotations

import json
import math
import os
import pathlib
from urllib.parse import urlparse

import httpx
import pytest

from engine.contracts import Finding
from engine.contracts.strategy import SECTION_ORDER, StrategyFrame, StrategySectionDraft
from engine.gates.generic import generic_problems
from engine.gates.strategy_gates import allowed_from, orphan_numerals
from engine.graphs.strategy import strategy_fanout_node, strategy_route_node
from engine.graphs.strategy_agents import LLM_SECTIONS, strategy_full_node
from engine.llm.client import LmStudioConfig
from engine.llm.strategy_prompts import section_table
from eval.fixtures.strategy_synthetic import brand_full

RUNS = int(os.environ.get("STRATEGY_EXIT_GATE_RUNS", "20"))
FIXTURE = pathlib.Path(__file__).resolve().parents[1] / "eval" / "fixtures" / "bardi_strategy_frame.json"


def _reachable() -> bool:
    try:
        httpx.get(f"{LmStudioConfig.from_env().base_url.rstrip('/')}/models", timeout=3.0).raise_for_status()
        return True
    except httpx.HTTPError:
        return False


pytestmark = pytest.mark.skipif(not _reachable(), reason="requires a reachable LM Studio server")


async def _routed_state(frame: StrategyFrame, run_id: str) -> dict:
    state = {"tenant_id": frame.tenant_id, "brief_type": "strategy", "run_id": run_id, "strategy_frame": frame.model_dump(mode="json"), "tier": "full"}
    state.update(await strategy_fanout_node(state))
    state.update(await strategy_route_node(state))
    return state


def _p95(xs: list[float]) -> float:
    s = sorted(xs)
    return s[min(len(s) - 1, math.ceil(0.95 * len(s)) - 1)]


def _measure(state: dict, out: dict, frame: StrategyFrame) -> dict:
    by_id = {f["id"]: Finding.model_validate(f) for f in state["findings"]}
    names = [frame.brand_name, frame.client_name, *{c.brand for rows in frame.competitors.values() for c in rows}]
    ev = out["strategy_meta"]["eval"]
    orphans, generic = [], []
    for sid in LLM_SECTIONS:
        entry = out["section_drafts"][str(int(sid))]
        if entry["narration_source"] != "llm":
            continue
        routed = [by_id[i] for i in state["rankings"][str(int(sid))]["selected_ids"]]
        draft = StrategySectionDraft.model_validate(entry["draft"])
        allowed = allowed_from(routed, section_table(routed, frame.brand_name))
        for text in (draft.headline, *(p.text for p in draft.paragraphs), draft.implication or ""):
            orphans += orphan_numerals(text, allowed)
        generic += generic_problems([p.text for p in draft.paragraphs], names)
    t6 = state["rankings"][str(int(106))]["selected_ids"]
    return {
        "duration_s": ev.get("duration_s"),
        "degraded": out["strategy_meta"]["degraded"],
        "pass_at_1": ev.get("pass_at_1"),
        "section_sources": {k: v.get("source") for k, v in ev.get("sections", {}).items()},
        "action_sources": (ev.get("actions") or {}).get("sources", {}),
        "orphans": orphans,
        "generic": generic,
        "t6": t6,
        "llm_calls": ev.get("llm_calls"),
    }


async def test_live_strategy_exit_gate(monkeypatch):
    lm_host = urlparse(LmStudioConfig.from_env().base_url).hostname
    hosts: set[str] = set()
    real_send = httpx.AsyncClient.send

    async def spy_send(self, request, *a, **k):  # noqa: ANN001, ANN002, ANN003
        hosts.add(request.url.host)
        return await real_send(self, request, *a, **k)

    monkeypatch.setattr(httpx.AsyncClient, "send", spy_send)

    bardi = StrategyFrame.model_validate_json(FIXTURE.read_text(encoding="utf-8"))
    fixtures = {"shop": bardi, "brand": brand_full()}
    results: dict[str, list[dict]] = {k: [] for k in fixtures}
    for cls, frame in fixtures.items():
        assert frame.classification.report_class == cls
        for i in range(RUNS):
            state = await _routed_state(frame, f"exit_gate_{cls}_{i}")
            out = await strategy_full_node(state)
            results[cls].append(_measure(state, out, frame))

    out_path = os.environ.get("STRATEGY_EXIT_GATE_OUT")
    if out_path:
        pathlib.Path(out_path).write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")

    runs = [r for rs in results.values() for r in rs]
    sections = [s for r in runs for s in r["section_sources"].values() if s != "template"]
    actions = [s for r in runs for s in r["action_sources"].values()]
    action_p1 = [bool((r["pass_at_1"] or {}).get("action_phraser")) for r in runs]
    chip_p1 = [bool((r["pass_at_1"] or {}).get("chip_gate")) for r in runs]
    durations = [r["duration_s"] or 0.0 for r in runs]
    summary = {
        "runs": len(runs),
        "section_fallback_rate": sections.count("fallback") / max(1, len(sections)),
        "action_fallback_rate": actions.count("fallback") / max(1, len(actions)),
        "action_pass_at_1": sum(action_p1) / len(runs),
        "chip_pass_at_1": sum(chip_p1) / len(runs),
        "orphans": sum(len(r["orphans"]) for r in runs),
        "generic": sum(len(r["generic"]) for r in runs),
        "class_highlight_missing": sum("class_highlight_missing" in r["degraded"] for r in runs),
        "degraded_runs": sum(bool(r["degraded"]) for r in runs),
        "p95_s": _p95(durations),
        "hosts": sorted(hosts),
    }
    print("\nstrategy exit gate:", json.dumps(summary, indent=1))

    assert summary["orphans"] == 0, [r["orphans"] for r in runs if r["orphans"]]
    assert summary["section_fallback_rate"] < 0.05, summary
    assert summary["action_fallback_rate"] < 0.10, summary
    assert summary["action_pass_at_1"] >= 0.8, summary
    assert summary["chip_pass_at_1"] >= 0.8, summary
    assert summary["class_highlight_missing"] == 0, summary
    assert summary["generic"] == 0, [r["generic"] for r in runs if r["generic"]]
    assert summary["p95_s"] <= 600, summary
    assert hosts <= {lm_host, "localhost", "127.0.0.1"}, hosts
    # Brand and shop produce different T6 content and a different order.
    assert results["brand"][0]["t6"] != results["shop"][0]["t6"]
    assert SECTION_ORDER["brand"] != SECTION_ORDER["shop"]
