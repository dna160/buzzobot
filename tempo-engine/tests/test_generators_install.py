"""B10 exit criteria: "Depth parity" [with GMV/Awareness]. Synthetic
frames proving each N01-N04 positive path; live validation (real
'app_install' client `treasury`) is in test_live_install_generators.py.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from engine.contracts import Entity, EntityLevel, MetricFrame, MetricRecord, Period
from engine.contracts.presets import INSTALL_OBJECTIVE_CONTRACT
from engine.generators.base import GeneratorContext
from engine.generators.install import N01FunnelLeak, N02CohortQuality, N03CpiPaybackProxy, N04InstallAnomaly
from engine.generators.shared import G01IdentityDecomposition, G04ZeroYield

CURRENT = Period(start_date=date(2026, 7, 1), end_date=date(2026, 7, 7), active_days=7, label="current")
PRIOR = Period(start_date=date(2026, 6, 24), end_date=date(2026, 6, 30), active_days=7, label="prior")


def _frame(records: list[MetricRecord]) -> MetricFrame:
    return MetricFrame(
        tenant_id="synthetic-install",
        brief_type="install",
        current_period=CURRENT,
        prior_period=PRIOR,
        records=records,
        currency="IDR",
        timezone="Asia/Jakarta",
        generated_at=datetime(2026, 7, 8, tzinfo=timezone.utc),
    )


def _ctx(records: list[MetricRecord]) -> GeneratorContext:
    return GeneratorContext(metric_frame=_frame(records), objective_contract=INSTALL_OBJECTIVE_CONTRACT)


def _campaign(id_: str, name: str, *, impressions: float, clicks: float, installs: float, cost: float, period: Period = CURRENT, level: EntityLevel = EntityLevel.CAMPAIGN) -> MetricRecord:
    metrics = {"impressions": impressions, "clicks": clicks, "installs": installs, "cost": cost}
    if impressions > 0:
        metrics["ctr"] = clicks / impressions
    if clicks > 0:
        metrics["ir"] = installs / clicks
    if cost > 0:
        if installs > 0:
            metrics["cpi"] = cost / installs
        metrics["installs_per_cost"] = installs / cost
    return MetricRecord(entity=Entity(level=level, id=id_, display_name=name), period=period, metrics=metrics)


def test_g04_catches_dead_delivery_and_n01_catches_the_click_to_install_leak() -> None:
    """Division of labor: G04's generic zero-yield rule naturally resolves
    to "0 clicks" for Install (dead spend); N01 is the install-specific
    complement covering "clicks but 0 installs" (the real funnel leak)."""
    dead = _campaign("c_dead", "Dead Delivery", impressions=10_000, clicks=0, installs=0, cost=500_000)
    leaking = _campaign("c_leak", "All Clicks No Installs", impressions=50_000, clicks=2_000, installs=0, cost=2_000_000)
    healthy = _campaign("c_ok", "Healthy", impressions=50_000, clicks=2_000, installs=100, cost=2_000_000)
    ctx = _ctx([dead, leaking, healthy])

    g04_result = G04ZeroYield().run(ctx)
    assert g04_result.coverage_gap is None
    zero_yield = [f for f in g04_result.findings if f.evidence.get("rule") == "zero_yield_spend"]
    assert len(zero_yield) == 1
    assert zero_yield[0].entity.id == "c_dead"

    n01_result = N01FunnelLeak().run(ctx)
    assert n01_result.coverage_gap is None
    assert len(n01_result.findings) == 1
    assert n01_result.findings[0].entity.id == "c_leak"
    assert n01_result.findings[0].claim_frame == "funnel_leak_click_to_install"


def test_n02_flags_cheap_low_quality_and_strong_quality_cohorts() -> None:
    records = [
        _campaign("c_risk", "Cheap Low Quality", impressions=200_000, clicks=10_000, installs=100, cost=150_000),  # cpi=1500, ir=0.01
        _campaign("c_strong", "Strong Quality", impressions=200_000, clicks=10_000, installs=1500, cost=6_000_000),  # cpi=4000, ir=0.15
        _campaign("c_typ_a", "Typical A", impressions=200_000, clicks=10_000, installs=500, cost=1_500_000),  # cpi=3000, ir=0.05
        _campaign("c_typ_b", "Typical B", impressions=200_000, clicks=10_000, installs=550, cost=1_650_000),  # cpi=3000, ir=0.055
    ]
    result = N02CohortQuality().run(_ctx(records))
    assert result.coverage_gap is None
    by_entity = {f.entity.id: f for f in result.findings}
    assert by_entity["c_risk"].claim_frame == "cohort_quality_risk"
    assert by_entity["c_strong"].claim_frame == "cohort_quality_strong"


def test_n03_flags_scale_up_and_scale_down_install_efficiency() -> None:
    account = Entity(level=EntityLevel.ACCOUNT, id="account", display_name="Account")
    account_current = MetricRecord(entity=account, period=CURRENT, metrics={"installs": 5_000.0, "cost": 10_000.0})
    account_prior = MetricRecord(entity=account, period=PRIOR, metrics={"installs": 4_000.0, "cost": 8_000.0})

    def install_record(id_: str, name: str, period: Period, installs: float, cost: float) -> MetricRecord:
        return MetricRecord(entity=Entity(level=EntityLevel.CAMPAIGN, id=id_, display_name=name), period=period, metrics={"installs": installs, "cost": cost})

    records = [
        account_current, account_prior,
        install_record("c_up", "Scale Up", CURRENT, 1_500.0, 2_000.0), install_record("c_up", "Scale Up", PRIOR, 500.0, 1_000.0),  # marginal=1.0 ratio=2.0
        install_record("c_down", "Scale Down", CURRENT, 1_200.0, 3_000.0), install_record("c_down", "Scale Down", PRIOR, 1_000.0, 1_000.0),  # marginal=0.1 ratio=0.2
    ]
    result = N03CpiPaybackProxy().run(_ctx(records))
    assert result.coverage_gap is None
    by_entity = {f.entity.id: f for f in result.findings}
    assert by_entity["c_up"].claim_frame == "cpi_efficiency_scaling"
    assert by_entity["c_down"].claim_frame == "cpi_efficiency_saturating"


def test_n04_flags_an_install_rate_anomaly_as_neutral_low_confidence_and_low_actionability() -> None:
    """PRD explicitly says N04 is "flagged, not asserted" — structurally
    distinct from every directional generator (G02, N02)."""
    records = [
        _campaign("c_anomaly", "Anomaly", impressions=100_000, clicks=5_000, installs=2_500, cost=500_000),  # ir=0.5, way outside cohort
        _campaign("c_typ_a", "Typical A", impressions=100_000, clicks=5_000, installs=250, cost=500_000),  # ir=0.05
        _campaign("c_typ_b", "Typical B", impressions=100_000, clicks=5_000, installs=260, cost=500_000),  # ir=0.052
        _campaign("c_typ_c", "Typical C", impressions=100_000, clicks=5_000, installs=240, cost=500_000),  # ir=0.048
        _campaign("c_typ_d", "Typical D", impressions=100_000, clicks=5_000, installs=255, cost=500_000),  # ir=0.051
    ]
    result = N04InstallAnomaly().run(_ctx(records))
    assert result.coverage_gap is None
    anomaly = next(f for f in result.findings if f.entity.id == "c_anomaly")
    assert anomaly.claim_frame == "install_rate_anomaly"
    assert anomaly.direction.value == "neutral"
    assert anomaly.confidence.value == "low"
    assert anomaly.actionability == "low"


def test_g01_reproduces_depth_parity_with_gmv_on_a_full_install_frame() -> None:
    account = Entity(level=EntityLevel.ACCOUNT, id="account", display_name="Account")
    current = MetricRecord(entity=account, period=CURRENT, metrics={"impressions": 500_000.0, "clicks": 20_000.0, "ir": 0.05, "installs": 1_000.0, "cost": 10_000.0, "ctr": 0.04})
    prior = MetricRecord(entity=account, period=PRIOR, metrics={"impressions": 400_000.0, "clicks": 14_000.0, "ir": 0.04, "installs": 560.0, "cost": 8_000.0, "ctr": 0.035})
    ctx = _ctx([current, prior])

    result = G01IdentityDecomposition().run(ctx)
    assert result.coverage_gap is None
    finding = result.findings[0]
    contribution_sum = sum(v for k, v in finding.evidence.items() if k.endswith("_contribution"))
    assert contribution_sum == pytest.approx(finding.evidence["delta"], rel=1e-6)
