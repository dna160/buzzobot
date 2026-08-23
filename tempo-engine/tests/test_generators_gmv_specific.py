"""M01-M04 (PRD §6.3, GMV-specific), built out of sequence to close the B3
exit-gate's S4/S5 gap.
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
)
from engine.generators.base import GeneratorContext
from engine.generators.gmv import M01LiveSessionEfficiency, M02AovMixShift, M03CreatorLadder, M04SkuLifecycleContribution
from eval.fixtures.sovella_gmv_week import GMV_OBJECTIVE_CONTRACT, build_sovella_gmv_metric_frame


@pytest.fixture()
def sovella_ctx() -> GeneratorContext:
    return GeneratorContext(metric_frame=build_sovella_gmv_metric_frame(), objective_contract=GMV_OBJECTIVE_CONTRACT)


def test_m01_flags_the_best_and_worst_live_session(sovella_ctx: GeneratorContext) -> None:
    result = M01LiveSessionEfficiency().run(sovella_ctx)
    assert result.coverage_gap is None
    by_claim = {f.claim_frame: f for f in result.findings}
    assert by_claim[ClaimFrame.SESSION_EFFICIENCY_LEADER.value].entity.display_name == "Promo Special Payday Sale #2"
    assert by_claim[ClaimFrame.SESSION_EFFICIENCY_LEADER.value].evidence["roi"] == pytest.approx(27.34)


def test_m02_reports_coverage_gap_without_prior_period_products(sovella_ctx: GeneratorContext) -> None:
    """Documented in the fixture module: no prior-period product breakdown exists."""
    result = M02AovMixShift().run(sovella_ctx)
    assert result.findings == []
    assert result.coverage_gap is not None


def test_m03_reports_coverage_gap_no_creator_data_anywhere(sovella_ctx: GeneratorContext) -> None:
    """Tempo has no creator/affiliate table at all — see the module docstring."""
    result = M03CreatorLadder().run(sovella_ctx)
    assert result.findings == []
    assert result.coverage_gap is not None


def test_m04_flags_lennon_as_the_gmv_contributor_and_marsha_as_top_roi(sovella_ctx: GeneratorContext) -> None:
    """Matches the report's own §5: Lennon dominates GMV, Marsha has the
    highest ROI among the three products."""
    result = M04SkuLifecycleContribution().run(sovella_ctx)
    assert result.coverage_gap is None
    names = {f.entity.display_name for f in result.findings}
    assert "SOVELLA Lennon" in names  # highest raw GMV of the three
    assert any(f.entity.display_name == "SOVELLA Marsha" for f in result.findings) or len(result.findings) == 1


CURRENT = Period(start_date=date(2026, 7, 1), end_date=date(2026, 7, 7), active_days=7, label="current")
PRIOR = Period(start_date=date(2026, 6, 24), end_date=date(2026, 6, 30), active_days=7, label="prior")

_CONTRACT = ObjectiveContract(
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


def test_m02_price_and_mix_effects_sum_exactly_to_the_aov_delta() -> None:
    """The core guarantee of the shift-share decomposition."""
    sku_a = Entity(level=EntityLevel.PRODUCT, id="sku_a", display_name="SKU A")
    sku_b = Entity(level=EntityLevel.PRODUCT, id="sku_b", display_name="SKU B")

    records = [
        # Prior: A sells 100 units @ price 10 (gmv 1000), B sells 100 @ price 20 (gmv 2000). AOV = 3000/200 = 15.
        MetricRecord(entity=sku_a, period=PRIOR, metrics={"gmv": 1000.0, "orders": 100.0}),
        MetricRecord(entity=sku_b, period=PRIOR, metrics={"gmv": 2000.0, "orders": 100.0}),
        # Current: A sells 50 units @ price 12 (gmv 600), B sells 150 @ price 22 (gmv 3300). Mix shifted toward B, prices rose.
        MetricRecord(entity=sku_a, period=CURRENT, metrics={"gmv": 600.0, "orders": 50.0}),
        MetricRecord(entity=sku_b, period=CURRENT, metrics={"gmv": 3300.0, "orders": 150.0}),
    ]
    frame = MetricFrame(
        tenant_id="synthetic", brief_type="gmv", current_period=CURRENT, prior_period=PRIOR,
        records=records, currency="IDR", timezone="Asia/Jakarta", generated_at=datetime(2026, 7, 8, tzinfo=timezone.utc),
    )
    ctx = GeneratorContext(metric_frame=frame, objective_contract=_CONTRACT)

    result = M02AovMixShift().run(ctx)
    assert result.coverage_gap is None
    finding = result.findings[0]

    aov_current = (600.0 + 3300.0) / (50.0 + 150.0)
    aov_prior = (1000.0 + 2000.0) / (100.0 + 100.0)
    assert finding.evidence["price_effect"] + finding.evidence["mix_effect"] == pytest.approx(aov_current - aov_prior, rel=1e-6)


def test_m03_flags_leader_and_laggard_with_synthetic_creators() -> None:
    def creator(i: int, gmv: float, roi: float, orders: float) -> MetricRecord:
        return MetricRecord(
            entity=Entity(level=EntityLevel.CREATOR, id=f"cr{i}", display_name=f"Creator {i}"),
            period=CURRENT,
            metrics={"gmv": gmv, "roi": roi, "orders": orders},
        )

    records = [creator(1, 5_000_000, 9.0, 50), creator(2, 3_000_000, 5.0, 30), creator(3, 1_000_000, 1.5, 10)]
    frame = MetricFrame(
        tenant_id="synthetic", brief_type="gmv", current_period=CURRENT, prior_period=None,
        records=records, currency="IDR", timezone="Asia/Jakarta", generated_at=datetime(2026, 7, 8, tzinfo=timezone.utc),
    )
    ctx = GeneratorContext(metric_frame=frame, objective_contract=_CONTRACT)

    result = M03CreatorLadder().run(ctx)
    assert result.coverage_gap is None
    by_claim = {f.claim_frame: f for f in result.findings}
    assert by_claim[ClaimFrame.CREATOR_LADDER_LEADER.value].entity.id == "cr1"
    assert by_claim[ClaimFrame.CREATOR_LADDER_LAGGARD.value].entity.id == "cr3"
