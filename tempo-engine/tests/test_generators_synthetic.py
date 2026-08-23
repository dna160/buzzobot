"""G04's positive case needs an entity that spent without producing an
order — the Sovella fixture doesn't happen to have one under the corrected,
narrower GMV waste rule (see test_generators_gmv_fixture.py). Also proves
G06's FDR-correction rejects noise, independent of the Sovella fixture's
thin dimensional data.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from engine.contracts import (
    ClaimFrame,
    Entity,
    EntityLevel,
    IdentityEquation,
    MetricAvailability,
    MetricFrame,
    MetricRecord,
    MetricTier,
    ObjectiveContract,
    Period,
    SectionId,
)
from engine.generators.base import GeneratorContext
from engine.generators.shared import G04ZeroYield, G05MarginalReturn, G06SegmentContrast
from engine.materiality import route_all_sections, score_findings

CURRENT = Period(start_date=date(2026, 7, 1), end_date=date(2026, 7, 7), active_days=7, label="current")
PRIOR = Period(start_date=date(2026, 6, 24), end_date=date(2026, 6, 30), active_days=7, label="prior")

GMV_CONTRACT = ObjectiveContract(
    brief_type="gmv",
    primary_outcome="gmv",
    efficiency_metric="roi",
    identity_chain=[
        IdentityEquation(outcome="clicks", factors=["impressions", "ctr"]),
        IdentityEquation(outcome="orders", factors=["clicks", "cvr"]),
        IdentityEquation(outcome="gmv", factors=["orders", "aov"]),
    ],
    core_metrics=["impressions", "clicks", "ctr", "cvr", "orders", "aov", "gmv", "cost", "roi"],
    metric_tiers=[MetricTier(metric="gmv", availability=MetricAvailability.REQUIRED)],
    waste_definition="n/a",
    additivity_trap="n/a",
)


def _frame(records: list[MetricRecord]) -> MetricFrame:
    return MetricFrame(
        tenant_id="synthetic",
        brief_type="gmv",
        current_period=CURRENT,
        prior_period=PRIOR,
        records=records,
        currency="IDR",
        timezone="Asia/Jakarta",
        generated_at=datetime(2026, 7, 8, tzinfo=timezone.utc),
    )


def test_g04_flags_a_session_that_spent_with_zero_orders() -> None:
    dead_session = Entity(level=EntityLevel.SESSION, id="live_dead", display_name="Dead Session")
    live_session = Entity(level=EntityLevel.SESSION, id="live_good", display_name="Good Session")

    records = [
        MetricRecord(entity=dead_session, period=CURRENT, metrics={"cost": 500_000.0, "orders": 0.0, "gmv": 0.0}),
        MetricRecord(entity=live_session, period=CURRENT, metrics={"cost": 500_000.0, "orders": 20.0, "gmv": 4_000_000.0}),
    ]
    ctx = GeneratorContext(metric_frame=_frame(records), objective_contract=GMV_CONTRACT)

    result = G04ZeroYield().run(ctx)
    assert result.coverage_gap is None
    assert len(result.findings) == 1
    finding = result.findings[0]
    assert finding.claim_frame == ClaimFrame.ZERO_YIELD_SPEND.value
    assert finding.entity.id == "live_dead"
    assert finding.level.value == "session"


def test_g05_flags_scale_up_and_scale_down_campaigns_against_the_account_baseline() -> None:
    account = Entity(level=EntityLevel.ACCOUNT, id="account", display_name="Account")
    scale_up = Entity(level=EntityLevel.CAMPAIGN, id="c_up", display_name="Scale Up Campaign")
    scale_down = Entity(level=EntityLevel.CAMPAIGN, id="c_down", display_name="Scale Down Campaign")
    neutral = Entity(level=EntityLevel.CAMPAIGN, id="c_flat", display_name="Neutral Campaign")

    # Account: delta_gmv=10_000, delta_cost=2_000 -> account marginal return = 5.0
    # c_up: delta_gmv=10_000, delta_cost=1_000 -> marginal=10.0, ratio=2.0  (> 1.3, scale-up)
    # c_down: delta_gmv=2_000, delta_cost=2_000 -> marginal=1.0, ratio=0.2 (< 0.6, scale-down)
    # c_flat: delta_gmv=3_000, delta_cost=500 -> marginal=6.0, ratio=1.2 (within band, not flagged)
    records = [
        MetricRecord(entity=account, period=CURRENT, metrics={"gmv": 50_000.0, "cost": 10_000.0}),
        MetricRecord(entity=account, period=PRIOR, metrics={"gmv": 40_000.0, "cost": 8_000.0}),
        MetricRecord(entity=scale_up, period=CURRENT, metrics={"gmv": 15_000.0, "cost": 2_000.0}),
        MetricRecord(entity=scale_up, period=PRIOR, metrics={"gmv": 5_000.0, "cost": 1_000.0}),
        MetricRecord(entity=scale_down, period=CURRENT, metrics={"gmv": 12_000.0, "cost": 3_000.0}),
        MetricRecord(entity=scale_down, period=PRIOR, metrics={"gmv": 10_000.0, "cost": 1_000.0}),
        MetricRecord(entity=neutral, period=CURRENT, metrics={"gmv": 6_000.0, "cost": 1_000.0}),
        MetricRecord(entity=neutral, period=PRIOR, metrics={"gmv": 3_000.0, "cost": 500.0}),
    ]
    ctx = GeneratorContext(metric_frame=_frame(records), objective_contract=GMV_CONTRACT)

    result = G05MarginalReturn().run(ctx)
    assert result.coverage_gap is None
    assert len(result.findings) == 2
    by_entity = {f.entity.id: f for f in result.findings}

    up = by_entity["c_up"]
    assert up.claim_frame == ClaimFrame.MARGINAL_RETURN_SCALING.value
    assert up.direction.value == "positive"
    assert up.evidence["ratio_to_account"] == pytest.approx(2.0)

    down = by_entity["c_down"]
    assert down.claim_frame == ClaimFrame.MARGINAL_RETURN_DECLINING.value
    assert down.direction.value == "negative"
    assert down.evidence["ratio_to_account"] == pytest.approx(0.2)

    assert "c_flat" not in by_entity


def test_g05_scale_up_and_scale_down_findings_route_to_s3_and_s6() -> None:
    """B8 exit criteria: "Scale-up/scale-down findings in S3/S6." Runs the
    same G05 findings through the real materiality scorer + router (not just
    checking `section_affinity` in isolation) to prove they actually survive
    ranking into both sections."""
    account = Entity(level=EntityLevel.ACCOUNT, id="account", display_name="Account")
    scale_up = Entity(level=EntityLevel.CAMPAIGN, id="c_up", display_name="Scale Up Campaign")
    scale_down = Entity(level=EntityLevel.CAMPAIGN, id="c_down", display_name="Scale Down Campaign")

    records = [
        MetricRecord(entity=account, period=CURRENT, metrics={"gmv": 50_000.0, "cost": 10_000.0}),
        MetricRecord(entity=account, period=PRIOR, metrics={"gmv": 40_000.0, "cost": 8_000.0}),
        MetricRecord(entity=scale_up, period=CURRENT, metrics={"gmv": 15_000.0, "cost": 2_000.0}),
        MetricRecord(entity=scale_up, period=PRIOR, metrics={"gmv": 5_000.0, "cost": 1_000.0}),
        MetricRecord(entity=scale_down, period=CURRENT, metrics={"gmv": 12_000.0, "cost": 3_000.0}),
        MetricRecord(entity=scale_down, period=PRIOR, metrics={"gmv": 10_000.0, "cost": 1_000.0}),
    ]
    ctx = GeneratorContext(metric_frame=_frame(records), objective_contract=GMV_CONTRACT)

    result = G05MarginalReturn().run(ctx)
    scored = score_findings(result.findings, "gmv")
    rankings = route_all_sections(scored)

    s3_ids = {f.id for f in rankings[SectionId.S3_PRIMARY_CHANNEL].selected}
    s6_ids = {f.id for f in rankings[SectionId.S6_RISK_ACTIONS_OUTLOOK].selected}
    assert {"g05_c_up", "g05_c_down"} <= s3_ids
    assert {"g05_c_up", "g05_c_down"} <= s6_ids


def test_g06_finds_a_significant_dimension_contrast() -> None:
    def campaign(i: int, roi: float, dim_value: str) -> MetricRecord:
        return MetricRecord(
            entity=Entity(level=EntityLevel.CAMPAIGN, id=f"c{i}", display_name=f"Campaign {i}"),
            period=CURRENT,
            metrics={"roi": roi, "cost": 1000.0},
            dimensions={"format": dim_value},
        )

    records = [
        campaign(1, 9.8, "video"), campaign(2, 10.1, "video"), campaign(3, 9.9, "video"), campaign(4, 10.2, "video"),
        campaign(5, 3.1, "static"), campaign(6, 2.9, "static"), campaign(7, 3.0, "static"), campaign(8, 2.8, "static"),
    ]
    ctx = GeneratorContext(metric_frame=_frame(records), objective_contract=GMV_CONTRACT)

    result = G06SegmentContrast().run(ctx)
    assert result.coverage_gap is None
    assert len(result.findings) == 1
    finding = result.findings[0]
    assert finding.claim_frame == ClaimFrame.ATTRIBUTE_PERFORMANCE_CORRELATION.value
    assert finding.evidence["dimension"] == "format"
    assert finding.evidence["p_value_fdr_adjusted"] < 0.05


def test_g06_reports_coverage_gap_when_groups_are_indistinguishable() -> None:
    def campaign(i: int, roi: float, dim_value: str) -> MetricRecord:
        return MetricRecord(
            entity=Entity(level=EntityLevel.CAMPAIGN, id=f"c{i}", display_name=f"Campaign {i}"),
            period=CURRENT,
            metrics={"roi": roi, "cost": 1000.0},
            dimensions={"format": dim_value},
        )

    records = [
        campaign(1, 5.0, "video"), campaign(2, 5.2, "video"),
        campaign(3, 4.9, "static"), campaign(4, 5.1, "static"),
    ]
    ctx = GeneratorContext(metric_frame=_frame(records), objective_contract=GMV_CONTRACT)

    result = G06SegmentContrast().run(ctx)
    assert result.findings == []
    assert result.coverage_gap is not None
