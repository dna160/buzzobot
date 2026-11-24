"""Strategy generators T01–T11 (PRD §7.3, §11.2) against BARDI's frozen real
frame (P0 asked for real rows, not mock-up numbers) and the labelled synthetic
frames for what real data cannot show."""

from __future__ import annotations

import pathlib

import pytest

from engine.contracts.strategy import ActionItem, OpenAction, StrategyFrame
from engine.generators.strategy import STRATEGY_GENERATORS
from engine.generators.strategy._util import metric_value
from engine.generators.strategy.t01_funnel_flow import T01FunnelFlow
from engine.generators.strategy.t02_spend_response import T02SpendResponse
from engine.generators.strategy.t03_goal_pacing import T03GoalPacing
from engine.generators.strategy.t04_content_mix import T04ContentMix
from engine.generators.strategy.t05_sov_rank import T05SovRank
from engine.generators.strategy.t06_competitors import T06Competitors
from engine.generators.strategy.t07_search_sentiment import T07SearchSentiment
from engine.generators.strategy.t11_action_measurement import T11ActionMeasurement
from eval.fixtures.strategy_synthetic import brand_full, lite_minimal_14d

FIXTURE = pathlib.Path(__file__).resolve().parents[1] / "eval" / "fixtures" / "bardi_strategy_frame.json"


@pytest.fixture(scope="module")
def bardi() -> StrategyFrame:
    return StrategyFrame.model_validate_json(FIXTURE.read_text(encoding="utf-8"))


def by_id(gen, frame):
    return {f.id: f for f in gen.run(frame).findings}


# ─── BARDI, 10 Oct 2026: the P0 / definitions-sheet reference values ────────


def test_t01_conversion_leak_is_a_size_ratio(bardi):
    f = by_id(T01FunnelFlow(), bardi)["t01_leak_consideration"]
    assert f.evidence["size_ratio"] == pytest.approx(0.0447, abs=1e-4)  # 5,801 ÷ 129,635
    assert f.evidence["bench_size_ratio"] == pytest.approx(0.1568, abs=1e-4)
    assert f.evidence["gap_pt"] == pytest.approx(-11.21, abs=0.01)
    assert (f.evidence["stage_total"], f.evidence["next_total"]) == (129_635, 5_801)
    assert f.evidence["rank"] == 38 and f.evidence["rank_n"] == 56  # ranking list, not audience_trend's 39


def test_t01_skips_ratios_above_one_rather_than_reading_them_as_rates(bardi):
    # BDL's Conversion is 12.5× its Consideration (P0 §6.2): not a funnel step.
    days = {s: list(v) for s, v in bardi.audience.items()}
    last = days["conversion"][-1]
    days["conversion"][-1] = last.model_copy(update={"total": days["consideration"][-1].total * 12.5})
    f = by_id(T01FunnelFlow(), bardi.model_copy(update={"audience": days}))
    assert "t01_leak_consideration" not in f and "t01_ok_consideration" not in f


def test_t01_offset_only_on_stages_with_flow(bardi):
    f = by_id(T01FunnelFlow(), bardi)
    assert "t01_offset_conversion" not in f  # Conversion new/outflow is 0 every day (P0 §6.3)
    off = f["t01_offset_awareness"]
    assert off.evidence["offset_ratio"] == pytest.approx(off.evidence["outflow_total"] / off.evidence["new_total"], abs=1e-4)


def test_t02_bardi_spend_does_not_track_new_consideration(bardi):
    f = T02SpendResponse().run(bardi).findings[0]
    assert f.claim_frame == "spend_response_unrelated"
    assert f.evidence["r2"] < 0.3 and f.evidence["lag_days"] == 2
    assert f.confidence.value == "low"
    assert any("bukan sebab-akibat" in c for c in f.caveats)


def test_t04_halo_and_mix_never_stack_subtypes(bardi):
    f = by_id(T04ContentMix(), bardi)
    halo = f["t04_halo"]
    assert halo.evidence["halo"] == pytest.approx(0.0585, abs=1e-3)
    assert halo.evidence["bench_halo"] == pytest.approx(0.637, abs=1e-3)
    mix = f["t04_mix"]
    assert mix.claim_frame == "content_mix_paid_heavy"
    assert mix.evidence["paid_share"] + mix.evidence["non_paid_share"] == pytest.approx(1.0, abs=1e-3)
    assert mix.evidence["ads_share"] > 1.0  # TTMS counts ads differently — reported, never summed
    assert mix.evidence["weakest_type"] in ("bgc_organic", "creator_organic")  # UGC is not a lever


def test_t05_product_card_clicks_always_reported(bardi):
    assert "t05_sov_product_card_clicks" in by_id(T05SovRank(), bardi)


def test_t06_real_competitor_moves(bardi):
    f = by_id(T06Competitors(), bardi)
    tp = f["t06_awareness_tp_link_indonesia"]
    assert tp.claim_frame == "brand_overtaken"
    assert (tp.evidence["rank_14d"], tp.evidence["rank_now"], tp.evidence["own_rank"]) == (41, 32, 36)
    assert all("bukan angka" in c for x in f.values() for c in x.caveats)


def test_t07_lite_signals_are_locked_not_zero(bardi):
    f = by_id(T07SearchSentiment(), bardi)
    assert {x.evidence["locked_reason"] for x in f.values()} == {"plan_lite"}


def test_metric_value_matches_the_findings(bardi):
    assert metric_value(bardi, "ttms.audience.consideration.size_ratio") == pytest.approx(0.0447, abs=1e-4)
    assert metric_value(bardi, "ttms.audience.consideration.rank") == 38


# ─── Synthetic frames ────────────────────────────────────────────────────────


def test_t02_recovers_the_planted_knee():
    f = T02SpendResponse().run(brand_full()).findings[0]
    assert f.claim_frame == "spend_response_diminishing"
    assert f.evidence["r2"] >= 0.9
    assert f.evidence["knee_daily_spend"] == pytest.approx(1_600_000, rel=0.05)
    assert f.evidence["cost_per_1k_above_knee"] > f.evidence["cost_per_1k_below_knee"]


def test_t03_rank_goal_is_paced_in_ranks_never_people():
    f = T03GoalPacing().run(brand_full()).findings[0]
    assert f.claim_frame in ("goal_off_track", "goal_unreachable")
    assert f.evidence["target"] == 25 and f.evidence["current"] >= 38
    assert not any(k for k in f.evidence if "people" in k or "per_day" in k)


@pytest.mark.parametrize(
    ("goal_value", "expected"),
    [(39, "goal_on_track"), (37, "goal_on_track"), (25, "goal_off_track"), (1, "goal_unreachable")],
)
def test_t03_feasibility_bands(goal_value, expected):
    fr = brand_full()
    fr = fr.model_copy(update={"goal": fr.goal.model_copy(update={"value": goal_value})})
    assert T03GoalPacing().run(fr).findings[0].claim_frame == expected


def test_t03_without_goal_says_so():
    f = T03GoalPacing().run(lite_minimal_14d()).findings[0]
    assert (f.claim_frame, f.evidence["reason"]) == ("data_coverage_gap", "no_goal")


def test_t06_planted_competitor_jump():
    f = by_id(T06Competitors(), brand_full())
    c = f["t06_consideration_competitor_c"]
    assert (c.claim_frame, c.evidence["rank_14d"], c.evidence["rank_now"]) == ("competitor_climbing", 9, 4)


def test_t07_full_plan_search_and_sentiment():
    claims = {f.claim_frame for f in T07SearchSentiment().run(brand_full()).findings}
    assert claims == {"search_share_drop", "sentiment_spike_negative"}


def test_lite_minimal_gaps_everything_it_cannot_support():
    fr = lite_minimal_14d()
    gaps = {g.id for g in STRATEGY_GENERATORS if g.run(fr).coverage_gap}
    assert {"T02", "T04", "T08", "T11"} <= gaps


# ─── T11 verdict rules ───────────────────────────────────────────────────────


RISING = "ttms.audience.awareness.total"  # synthetic: +2,000 people a day, benchmark flat
FLAT = "ttms.audience.conversion.total"  # synthetic: constant


def _verdict(*, days_ago: int, reach: float, kill_key: str = RISING) -> str:
    """An action on the ACC total, started `days_ago`, whose target sits so that
    today's move covers `reach` of the way (1.5 → 67% of the way, 5 → 20%)."""
    from datetime import timedelta

    frame = brand_full()
    started = frame.as_of - timedelta(days=days_ago)
    key = "ttms.audience.acc.total"
    start, now = metric_value(frame, key, end=started), metric_value(frame, key)
    item = ActionItem(
        id="act_01", rank=1, priority="P0", lever="stage_targeting", metric_key=key, entity={},
        current={"value": start, "format": "number"}, target={"value": start + (now - start) * reach, "format": "number"},
        horizon_days=28, basis="own_history", confidence="medium",
        kill_signal={"metric_key": kill_key, "condition": "no_rise_within_days", "days": 14}, evidence_refs=["x"],
    )
    fr = frame.model_copy(update={"open_actions": [OpenAction(id="00000000-aaaa", action=item.model_dump(mode="json", by_alias=True), started_at=started)]})
    return str(T11ActionMeasurement().run(fr).findings[0].evidence["verdict"])


def test_t11_verdicts_by_fixed_rule():
    assert _verdict(days_ago=20, reach=1.5) == "worked"  # 67% of the way, beat a flat category
    assert _verdict(days_ago=20, reach=5) == "weak"  # right way, only 20% of the way
    assert _verdict(days_ago=20, reach=5, kill_key=FLAT) == "failed"  # kill metric never rose in 14 days
    assert _verdict(days_ago=3, reach=5) == "running"  # too early to call


def test_t11_measures_with_the_solver_arithmetic(bardi):
    assert metric_value(bardi, "ttms.audience.consideration.size_ratio") == pytest.approx(5_801 / 129_635, abs=1e-6)
