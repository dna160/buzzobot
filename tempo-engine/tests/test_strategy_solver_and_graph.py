"""Target Solver, classifier, routing and the instant-tier graph (PRD §5.4,
§5.2, §5.3, §7.6, §11.2)."""

from __future__ import annotations

import pathlib

import pytest
from langgraph.checkpoint.memory import InMemorySaver

import engine.llm.client as llm_client
from engine.api.dispatcher import _content_from_state
from engine.contracts import Finding
from engine.contracts.content import BriefContentV2
from engine.contracts.strategy import SECTION_ORDER, StrategyFrame
from engine.gates.numeral_gate import run_numeral_gate
from engine.generators.strategy import STRATEGY_GENERATORS, T09TargetSolver
from engine.generators.strategy.t09_target_solver import MIX_STEP, STAGE_STEP
from engine.graphs.brief import build_brief_graph
from engine.ports.strategy_classify import classify, score_shop
from eval.fixtures.strategy_synthetic import brand_full, lite_minimal_14d

FIXTURE = pathlib.Path(__file__).resolve().parents[1] / "eval" / "fixtures" / "bardi_strategy_frame.json"


@pytest.fixture(scope="module")
def bardi() -> StrategyFrame:
    return StrategyFrame.model_validate_json(FIXTURE.read_text(encoding="utf-8"))


def battery(frame):
    findings = [f for g in STRATEGY_GENERATORS for f in g.run(frame).findings]
    return findings, T09TargetSolver().run(frame, findings)[1]


# ─── Classifier (PRD §5.2) ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("north_star", "gmv", "conv", "expected"),
    [
        ("shop", 0.87, 0.045, "shop"),  # BARDI
        ("shop", None, None, "shop"),  # north star alone meets the threshold (P0 §6.1)
        ("vtr", 0.15, 0.045, "brand"),
        ("vtr", 0.9, 0.2, "brand"),  # -2 +2 +1 = 1 < 2
        ("app_install", 0.6, 0.12, "shop"),  # -1 +2 +1 = 2
        ("app_install", 0.05, None, "brand"),
    ],
)
def test_classifier(north_star, gmv, conv, expected):
    assert classify(north_star=north_star, gmv_share=gmv, conv_ratio=conv).report_class == expected


def test_override_wins_and_is_flagged():
    c = classify(north_star="shop", gmv_share=0.9, conv_ratio=0.2, override="brand")
    assert (c.report_class, c.inferred_class, c.overridden, c.score) == ("brand", "shop", True, score_shop("shop", 0.9, 0.2))


# ─── Target Solver (PRD §5.4 rules, §7.3 table) ──────────────────────────────


def test_bardi_actions(bardi):
    _, actions = battery(bardi)
    assert [a.lever for a in actions] == ["stage_targeting", "content_mix", "investigate"]
    st = actions[0]
    assert st.metric_key == "ttms.audience.consideration.size_ratio" and st.priority == "P0"
    assert st.target.value == pytest.approx(st.current.value + STAGE_STEP, abs=1e-4)  # capped step, below the 15.68% benchmark
    assert st.stake.unit == "people" and st.stake.value == pytest.approx(STAGE_STEP * 129_635, rel=0.01)
    assert st.kill_signal.metric_key == "ttms.product_card_clicks"  # not Conversion new: it is always 0 (P0 §6.3)
    inv = actions[2]
    assert inv.target is None and inv.basis == "defensive" and inv.priority == "P2"


def test_solver_bounds_on_every_fixture(bardi):
    for frame in (bardi, brand_full()):
        _, actions = battery(frame)
        assert len({a.lever for a in actions}) == len(actions)  # one action per lever
        for a in actions:
            if a.lever == "stage_targeting":
                assert a.target.value - a.current.value <= STAGE_STEP + 1e-9
            if a.lever == "content_mix":
                assert a.target.value - a.current.value <= MIX_STEP + 1e-9
            assert a.lever == "investigate" or (a.kill_signal and a.target is not None)
        ranks = [a.confidence for a in actions if a.lever != "investigate"]
        assert ranks == sorted(ranks, key=lambda c: {"high": 0, "medium": 1, "low": 2}[c])


def test_budget_cap_only_from_a_fit_worth_acting_on(bardi):
    assert "budget_cap" not in {a.lever for a in battery(bardi)[1]}  # R² ≈ 0
    cap = next(a for a in battery(brand_full())[1] if a.lever == "budget_cap")
    assert cap.target.value == pytest.approx(1_600_000, rel=0.05) and cap.stake.unit == "idr"


# ─── Graph: instant tier, zero model calls (PRD §7.6) ────────────────────────


class _ForbiddenLlmClient:
    def __init__(self, *a, **k):
        raise AssertionError("the instant tier must not construct an LLM client")


async def run_instant(frame: StrategyFrame, monkeypatch) -> dict:
    monkeypatch.setattr(llm_client, "LmStudioClient", _ForbiddenLlmClient)
    graph = build_brief_graph(InMemorySaver())
    cfg = {"configurable": {"thread_id": f"t-{frame.client_slug}-{frame.classification.report_class}"}}
    state = await graph.ainvoke(
        {"tenant_id": frame.tenant_id, "brief_type": "strategy", "run_id": "r", "strategy_frame": frame.model_dump(mode="json"), "tier": "instant"},
        config=cfg,
    )
    content = _content_from_state(state)
    BriefContentV2.model_validate(content)
    return content


async def test_instant_report_is_complete(bardi, monkeypatch):
    c = await run_instant(bardi, monkeypatch)
    assert sorted(c["sections"]) == ["101", "103", "104", "105", "106", "107", "108", "109", "110"]
    assert len(c["action_plan"]) == 3 and all(a["copy"]["langkah"] for a in c["action_plan"])
    assert c["report_class"]["report_class"] == "shop"
    assert c["meta"]["section_order"] == [int(s) for s in SECTION_ORDER["shop"]]
    assert {"funnel", "content_mix", "rank_list", "stage_table"} <= {k for k, v in c["charts"].items() if v}


async def test_every_instant_numeral_is_in_evidence(bardi, monkeypatch):
    """The instant tier is numeral-gate-safe by construction; prove it with the gate."""
    c = await run_instant(bardi, monkeypatch)
    findings = {f["id"]: Finding.model_validate(f) for f in c["findings"]}
    for sid, entry in c["sections"].items():
        draft = entry["draft"]
        for p in draft.get("paragraphs", []):
            refs = [findings[r] for r in p["evidence_refs"] if r in findings]
            res = run_numeral_gate(p["text"], refs)
            assert res.ok, (sid, p["text"], res.violations)


async def test_action_copy_carries_the_solver_numbers(bardi, monkeypatch):
    c = await run_instant(bardi, monkeypatch)
    st = c["action_plan"][0]
    assert "4,47%" in st["copy"]["langkah"] and "9,47%" in st["copy"]["langkah"] and "4 minggu" in st["copy"]["langkah"]
    assert "14 hari" in st["copy"]["gagal_jika"]


async def test_class_changes_order_and_t6(bardi, monkeypatch):
    shop = await run_instant(bardi, monkeypatch)
    brand_frame = bardi.model_copy(update={"classification": classify(north_star="shop", gmv_share=0.87, conv_ratio=0.045, override="brand")})
    brand = await run_instant(brand_frame, monkeypatch)
    assert shop["meta"]["section_order"] != brand["meta"]["section_order"]
    shop_t6 = set(shop["rankings"]["106"]["selected"])
    brand_t6 = set(brand["rankings"]["106"]["selected"])
    assert shop_t6 != brand_t6
    # Class-highlight gate input (PRD §11.3): shop T6 leads with product-card clicks
    # or the Conversion-stage leak; brand T6 with SOV / rank / competitors.
    fid = {f["id"]: f for f in shop["findings"]}
    assert any(fid[i]["evidence"].get("metric") == "product_card_clicks" or fid[i]["claim_frame"].startswith("stage_") for i in shop_t6)
    bid = {f["id"]: f for f in brand["findings"]}
    assert all(bid[i]["generator"] in ("T05", "T06") for i in brand_t6)


async def test_no_finding_is_narrated_twice(bardi, monkeypatch):
    c = await run_instant(bardi, monkeypatch)
    narrated = [i for sid in ("103", "104", "105", "106", "107", "108") for i in c["rankings"][sid]["selected"]]
    assert len(narrated) == len(set(narrated))


async def test_lite_minimal_renders_honest_empty_states(monkeypatch):
    c = await run_instant(lite_minimal_14d(), monkeypatch)
    assert c["action_plan"] is None or c["action_plan"] == []
    assert "Data tidak cukup" in c["sections"]["104"]["draft"]["paragraphs"][0]["text"]
    locked = [s for s in c["signals"] if s["status"] == "locked"]
    assert len(locked) == 2
