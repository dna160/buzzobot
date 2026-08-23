"""B9 exit criteria: "Depth parity [with GMV]; A04 validated against
deduped rollups." Live testing against `cimory` (see
test_live_awareness_generators.py) found `reach` genuinely absent for the
whole current window (TikTok does not report `reach` for every campaign
objective) — every reach-dependent generator (G01, G05, A01, A03, A04)
correctly reported a coverage gap rather than fabricating a result, and A02
(VTR-only, no reach dependency) produced real findings from real data. That
proves the coverage-gap path; these synthetic frames prove the positive
path for the generators live data didn't happen to exercise this run.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from engine.contracts import Entity, EntityLevel, MetricFrame, MetricRecord, Period
from engine.contracts.presets import AWARENESS_OBJECTIVE_CONTRACT
from engine.generators.awareness import A01FrequencyDistribution, A02RetentionCurve, A03IncrementalReachEfficiency, A04ReachOverlap
from engine.generators.base import GeneratorContext
from engine.generators.shared import G01IdentityDecomposition, G05MarginalReturn

CURRENT = Period(start_date=date(2026, 7, 1), end_date=date(2026, 7, 7), active_days=7, label="current")
PRIOR = Period(start_date=date(2026, 6, 24), end_date=date(2026, 6, 30), active_days=7, label="prior")


def _frame(records: list[MetricRecord]) -> MetricFrame:
    return MetricFrame(
        tenant_id="synthetic-awareness",
        brief_type="awareness",
        current_period=CURRENT,
        prior_period=PRIOR,
        records=records,
        currency="IDR",
        timezone="Asia/Jakarta",
        generated_at=datetime(2026, 7, 8, tzinfo=timezone.utc),
    )


def _ctx(records: list[MetricRecord]) -> GeneratorContext:
    return GeneratorContext(metric_frame=_frame(records), objective_contract=AWARENESS_OBJECTIVE_CONTRACT)


def _campaign(id_: str, name: str, *, impressions: float, reach: float, watched6s: float, engaged15s: float, cost: float, period: Period = CURRENT, dimensions: dict | None = None, level: EntityLevel = EntityLevel.CAMPAIGN) -> MetricRecord:
    metrics = {"impressions": impressions, "reach": reach, "cost": cost}
    if reach > 0:
        metrics["frequency"] = impressions / reach
    if impressions > 0:
        metrics["vtr6s"] = watched6s / impressions
        metrics["vtr15s"] = engaged15s / impressions
    if reach > 0 and impressions > 0:
        qr = reach * metrics["vtr6s"]
        metrics["qualified_reach"] = qr
        if qr > 0 and cost > 0:
            metrics["qualified_reach_per_cost"] = qr / cost
    return MetricRecord(entity=Entity(level=level, id=id_, display_name=name), period=period, metrics=metrics, dimensions=dimensions or {})


def test_a01_flags_over_exposed_and_under_saturated_campaigns() -> None:
    records = [
        _campaign("c1", "Over-exposed", impressions=100_000, reach=5_000, watched6s=20_000, engaged15s=8_000, cost=1_000_000),  # freq=20
        _campaign("c2", "Typical A", impressions=20_000, reach=10_000, watched6s=5_000, engaged15s=2_000, cost=500_000),  # freq=2
        _campaign("c3", "Typical B", impressions=22_000, reach=11_000, watched6s=5_500, engaged15s=2_200, cost=550_000),  # freq=2
        _campaign("c4", "Under-saturated", impressions=10_000, reach=9_000, watched6s=3_000, engaged15s=1_000, cost=300_000),  # freq~1.11
    ]
    result = A01FrequencyDistribution().run(_ctx(records))
    assert result.coverage_gap is None
    by_entity = {f.entity.id: f for f in result.findings}
    assert by_entity["c1"].claim_frame == "frequency_over_exposed"
    assert by_entity["c4"].claim_frame == "frequency_under_saturated"


def test_a02_flags_hook_without_hold_and_strong_hold() -> None:
    records = [
        _campaign("c1", "Steep Drop-off", impressions=100_000, reach=50_000, watched6s=40_000, engaged15s=4_000, cost=1_000_000),  # ratio=0.1
        _campaign("c2", "Typical A", impressions=100_000, reach=50_000, watched6s=40_000, engaged15s=20_000, cost=1_000_000),  # ratio=0.5
        _campaign("c3", "Typical B", impressions=100_000, reach=50_000, watched6s=40_000, engaged15s=22_000, cost=1_000_000),  # ratio=0.55
        _campaign("c4", "Strong Hold", impressions=100_000, reach=50_000, watched6s=40_000, engaged15s=36_000, cost=1_000_000),  # ratio=0.9
    ]
    result = A02RetentionCurve().run(_ctx(records))
    assert result.coverage_gap is None
    by_entity = {f.entity.id: f for f in result.findings}
    assert by_entity["c1"].claim_frame == "retention_hook_without_hold"
    assert by_entity["c4"].claim_frame == "retention_strong_hold"


def test_a03_flags_scale_up_and_scale_down_against_account_baseline() -> None:
    account = Entity(level=EntityLevel.ACCOUNT, id="account", display_name="Account")
    # Account: delta_qr=10_000, delta_cost=2_000 -> account marginal = 5.0
    account_current = MetricRecord(entity=account, period=CURRENT, metrics={"qualified_reach": 50_000.0, "cost": 10_000.0})
    account_prior = MetricRecord(entity=account, period=PRIOR, metrics={"qualified_reach": 40_000.0, "cost": 8_000.0})

    def qr_record(id_: str, name: str, period: Period, qr: float, cost: float) -> MetricRecord:
        return MetricRecord(entity=Entity(level=EntityLevel.CAMPAIGN, id=id_, display_name=name), period=period, metrics={"qualified_reach": qr, "cost": cost})

    records = [
        account_current, account_prior,
        qr_record("c_up", "Scale Up", CURRENT, 15_000.0, 2_000.0), qr_record("c_up", "Scale Up", PRIOR, 5_000.0, 1_000.0),  # marginal=10 ratio=2.0
        qr_record("c_down", "Scale Down", CURRENT, 12_000.0, 3_000.0), qr_record("c_down", "Scale Down", PRIOR, 10_000.0, 1_000.0),  # marginal=1 ratio=0.2
    ]
    result = A03IncrementalReachEfficiency().run(_ctx(records))
    assert result.coverage_gap is None
    by_entity = {f.entity.id: f for f in result.findings}
    assert by_entity["c_up"].claim_frame == "incremental_reach_efficient"
    assert by_entity["c_down"].claim_frame == "incremental_reach_saturating"


def test_a04_flags_adgroup_overlap_validated_against_the_deduped_campaign_rollup() -> None:
    # Campaign-level (deduped) reach: 10,000. Two adgroups sum to 14,000 ->
    # overlap_ratio = (14,000 - 10,000) / 10,000 = 0.40 (well above the 15% floor).
    campaign = _campaign("camp1", "Campaign 1", impressions=50_000, reach=10_000, watched6s=5_000, engaged15s=2_000, cost=1_000_000)
    ag1 = _campaign("ag1", "Adgroup 1", impressions=30_000, reach=8_000, watched6s=3_000, engaged15s=1_200, cost=600_000, level=EntityLevel.AD_GROUP, dimensions={"campaign_id": "camp1"})
    ag2 = _campaign("ag2", "Adgroup 2", impressions=20_000, reach=6_000, watched6s=2_000, engaged15s=800, cost=400_000, level=EntityLevel.AD_GROUP, dimensions={"campaign_id": "camp1"})

    result = A04ReachOverlap().run(_ctx([campaign, ag1, ag2]))
    assert result.coverage_gap is None
    assert len(result.findings) == 1
    finding = result.findings[0]
    assert finding.claim_frame == "adgroup_reach_overlap"
    assert finding.entity.id == "camp1"
    assert finding.evidence["campaign_reach"] == 10_000
    assert finding.evidence["summed_adgroup_reach"] == 14_000
    assert finding.evidence["overlap_ratio"] == pytest.approx(0.40)


def test_g01_and_g05_reproduce_depth_parity_with_gmv_on_a_full_awareness_frame() -> None:
    """The two highest-value shared generators (LMDI, marginal return) must
    work identically for Awareness as for GMV once the identity chain's
    leaf factors (reach, vtr6s) are present in both periods — this is what
    "depth parity" means structurally, not just "some generator ran"."""
    account = Entity(level=EntityLevel.ACCOUNT, id="account", display_name="Account")
    current = MetricRecord(entity=account, period=CURRENT, metrics={"reach": 50_000.0, "vtr6s": 0.3, "impressions": 250_000.0, "qualified_reach": 15_000.0, "cost": 10_000.0})
    prior = MetricRecord(entity=account, period=PRIOR, metrics={"reach": 40_000.0, "vtr6s": 0.25, "impressions": 200_000.0, "qualified_reach": 10_000.0, "cost": 8_000.0})
    ctx = _ctx([current, prior])

    g01_result = G01IdentityDecomposition().run(ctx)
    assert g01_result.coverage_gap is None
    contribution_sum = sum(v for k, v in g01_result.findings[0].evidence.items() if k.endswith("_contribution"))
    assert contribution_sum == pytest.approx(g01_result.findings[0].evidence["delta"], rel=1e-6)

    g05_result = G05MarginalReturn().run(ctx)
    # No paired non-account entity in this frame -> honest coverage gap,
    # not an error; G05's positive path is already proven in
    # test_generators_synthetic.py against the shared marginal_return() math
    # A03 reuses directly.
    assert g05_result.coverage_gap is not None
