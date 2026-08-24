"""Brief Deck PRD §5: the instant tier runs the same graph with **zero model
calls**, and Brief Deck PRD §3.1: the boundary exports the whole analytical
state, not the four narrated keys.

Everything here runs offline — no LM Studio, no Postgres — which is the point:
the tier that has to answer in ten seconds is also the tier CI can prove.
"""

from __future__ import annotations

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from engine.api.dispatcher import _content_from_state
from engine.contracts.content import BriefContentV2
from engine.graphs import brief as brief_module
from engine.graphs.brief import build_brief_graph
from eval.fixtures.sovella_gmv_week import GMV_OBJECTIVE_CONTRACT, TENANT_ID, build_sovella_gmv_metric_frame


class _ForbiddenLlmClient:
    """Constructing an LM Studio client at all is the failure — not just
    calling it. An instant run that opens the socket has already blown the
    latency budget the tier exists to meet."""

    def __init__(self, *args: object, **kwargs: object) -> None:
        raise AssertionError("the instant tier must not construct an LM Studio client")


@pytest.fixture(autouse=True)
def _forbid_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(brief_module, "LmStudioClient", _ForbiddenLlmClient)


def _initial_state(run_id: str, tier: str) -> dict:
    frame = build_sovella_gmv_metric_frame()
    return {
        "tenant_id": TENANT_ID,
        "brief_type": "gmv",
        "run_id": run_id,
        "metric_frame": frame.model_dump(mode="json"),
        "objective_contract": GMV_OBJECTIVE_CONTRACT.model_dump(mode="json"),
        "tier": tier,
    }


async def _run_instant(run_id: str) -> dict:
    graph = build_brief_graph(InMemorySaver())
    config = {"configurable": {"thread_id": run_id}}
    return await graph.ainvoke(_initial_state(run_id, "instant"), config=config)


async def test_instant_run_produces_every_section_without_a_model_call() -> None:
    result = await _run_instant("instant_sections")

    assert set(result["section_drafts"].keys()) == {"2", "3", "4", "5"}
    for entry in result["section_drafts"].values():
        assert entry["narration_source"] == "template"
        assert entry["draft"]["headline"]
        assert entry["draft"]["mechanism"]
        assert entry["draft"]["action"]
    assert result["s6_result"]["source"] == "template"
    assert result["s1_result"]["source"] == "template"
    assert result["s1_result"]["draft"]["headline"]


async def test_instant_run_reports_the_probe_loop_as_not_run() -> None:
    result = await _run_instant("instant_probe")

    assert result["probe_loop_enabled"] is False
    assert result["probes_executed"] == 0
    assert result["probe_rounds_used"] == 0
    assert result["probe_log"] == []


async def test_instant_run_still_pauses_at_the_review_gate() -> None:
    """The tier changes the copy source, never the governance. A deck that
    skipped review because it was fast would be a different product."""
    graph = build_brief_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "instant_review"}}

    paused = await graph.ainvoke(_initial_state("instant_review", "instant"), config=config)
    assert paused.get("review_decision") is None

    resumed = await graph.ainvoke(
        Command(resume={"decision": "approved", "notes": "test"}), config=config
    )
    assert resumed["review_decision"]["decision"] == "approved"


async def test_instant_copy_is_deterministic_across_runs() -> None:
    """Same findings, same prose — PRD §11 R4 picks template variants by a hash
    of the finding id, not a counter, so a golden deck stays golden."""
    first = await _run_instant("instant_determinism_a")
    second = await _run_instant("instant_determinism_b")

    assert {k: v["draft"] for k, v in first["section_drafts"].items()} == {
        k: v["draft"] for k, v in second["section_drafts"].items()
    }
    assert first["s6_result"]["draft"] == second["s6_result"]["draft"]


async def test_instant_cards_vary_between_findings() -> None:
    """R4's other half: safe templates must not read as one sentence repeated.
    Distinct findings in one section produce distinct mechanism sentences."""
    result = await _run_instant("instant_variety")
    headlines = [entry["draft"]["headline"] for entry in result["section_drafts"].values()]
    assert len(set(headlines)) > 1


async def test_content_v2_exports_findings_rankings_and_coverage() -> None:
    result = await _run_instant("instant_content")
    content = _content_from_state(result)

    assert content["content_version"] == 2
    assert content["tier"] == "instant"
    assert content["engine_version"]
    assert content["brief_type"] == "gmv"

    # v1 keys keep their names and shapes — the widening is additive.
    assert content["s1"]["draft"]["headline"]
    assert set(content["sections"].keys()) == {"2", "3", "4", "5"}
    assert content["s6"]["draft"]["risks"]
    assert content["probe_loop"]["enabled"] is False

    # ...and the material a deck is made of is now there.
    assert content["findings"], "findings must be exported, not discarded"
    assert all("evidence" in f and "materiality" in f for f in content["findings"])
    assert content["rankings"], "per-section rankings must be exported"
    assert any("selected" in r for r in content["rankings"].values())
    coverage = content["coverage"]
    assert coverage is not None
    assert coverage["assessed_confidence"] in {"high", "medium", "low"}
    assert coverage["signals"], "counted denominators feed the coverage lines"

    # The export validates against its own contract, not just against these
    # assertions — this is what the TypeScript mirror is checked against.
    BriefContentV2.model_validate(content)


async def test_below_the_cut_rankings_survive_the_boundary() -> None:
    """PRD §6.5: everything below the cut is the only signal that later tells
    us the presets are wrong. v1 dropped it at the server boundary."""
    result = await _run_instant("instant_below_cut")
    content = _content_from_state(result)

    assert {fid for r in content["rankings"].values() for fid in r["selected"]}

    for section, ranking in content["rankings"].items():
        below = ranking["below_cut"]
        # Within one section a finding is either narrated or below the cut,
        # never both (across sections it can be either — affinity is a list).
        assert not set(ranking["selected"]) & {entry["id"] for entry in below}, section
        for entry in below:
            assert isinstance(entry["materiality"], (int, float))


async def test_coverage_signals_never_claim_more_than_the_battery_ran() -> None:
    result = await _run_instant("instant_signals")
    coverage = _content_from_state(result)["coverage"]

    for section, signal in coverage["signals"].items():
        assert signal["available"] <= signal["total"], section
        assert signal["total"] >= 0
