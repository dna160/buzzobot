"""B1 exit criteria: "Types validate against real read-model output."
Validated here against the Sovella fixture (a real reference report); B2's
tests additionally validate the live Tempo adapter path.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from engine.contracts import (
    Comparison,
    ComparisonBasis,
    EntityRef,
    Finding,
    FindingLevel,
    IdentityEquation,
    MetricAvailability,
    MetricTier,
    ObjectiveContract,
    Origin,
)
from eval.fixtures.sovella_gmv_week import GMV_OBJECTIVE_CONTRACT, TENANT_ID, build_sovella_gmv_metric_frame


def test_metric_frame_builds_and_validates() -> None:
    frame = build_sovella_gmv_metric_frame()
    assert frame.tenant_id == TENANT_ID
    assert frame.brief_type == "gmv"
    assert len(frame.records) == 1 + 1 + 2 + 8 + 3 + 8  # account*2periods + campaigns + sessions + products + ads


def test_comparability_scenario_is_present() -> None:
    frame = build_sovella_gmv_metric_frame()
    assert frame.current_period.active_days == 4
    assert frame.prior_period is not None
    assert frame.prior_period.active_days == 7

    from engine.contracts import EntityLevel

    account_records = {r.period.label: r for r in frame.records if r.entity.level == EntityLevel.ACCOUNT}
    current_gmv = account_records["current"].metrics["gmv"]
    prior_gmv = account_records["prior"].metrics["gmv"]
    nominal_delta = (current_gmv - prior_gmv) / prior_gmv

    current_per_day = current_gmv / frame.current_period.active_days
    prior_per_day = prior_gmv / frame.prior_period.active_days
    per_day_delta = (current_per_day - prior_per_day) / prior_per_day

    assert nominal_delta < 0
    assert per_day_delta > 0


def test_identity_chain_holds_exactly_for_account_records() -> None:
    from engine.contracts import EntityLevel

    frame = build_sovella_gmv_metric_frame()
    for record in frame.records:
        if record.entity.level != EntityLevel.ACCOUNT:
            continue
        m = record.metrics
        for eq in GMV_OBJECTIVE_CONTRACT.identity_chain:
            product = 1.0
            for factor in eq.factors:
                product *= m[factor]
            product /= eq.divisor
            assert m[eq.outcome] == pytest.approx(product, rel=1e-6)


def test_objective_contract_carries_additivity_trap_documentation() -> None:
    assert "ratio" in GMV_OBJECTIVE_CONTRACT.additivity_trap.lower()
    assert "averaged" in GMV_OBJECTIVE_CONTRACT.additivity_trap.lower()


def test_objective_contract_metric_tiering_is_declarable() -> None:
    contract = GMV_OBJECTIVE_CONTRACT
    assert contract.tier_of("gmv") == MetricAvailability.REQUIRED
    assert contract.tier_of("nonexistent_metric") is None
    assert set(contract.required_metrics()) == {"impressions", "clicks", "orders", "gmv", "cost", "roi"}


def test_identity_chain_must_reference_declared_core_metrics() -> None:
    with pytest.raises(ValidationError):
        ObjectiveContract(
            brief_type="gmv",
            primary_outcome="gmv",
            efficiency_metric="roi",
            identity_chain=[IdentityEquation(outcome="gmv", factors=["orders", "undeclared_metric"])],
            core_metrics=["gmv", "orders"],
            metric_tiers=[MetricTier(metric="gmv", availability=MetricAvailability.REQUIRED)],
            waste_definition="n/a",
            additivity_trap="n/a",
        )


def test_finding_rejects_unregistered_claim_frame() -> None:
    with pytest.raises(ValidationError):
        Finding(
            id="f_001",
            generator="G02",
            tenant_id=TENANT_ID,
            brief_type="gmv",
            section_affinity=[3],
            entity=EntityRef(id="live_03", display_name="test"),
            level=FindingLevel.SESSION,
            claim_frame="made_up_claim",
            evidence={"roi": 27.34},
            comparison=None,
            magnitude_pct=0.1,
            direction="positive",
            actionability="high",
            confidence="high",
            materiality=0.5,
        )


def test_finding_rejects_section_affinity_for_s1() -> None:
    with pytest.raises(ValidationError):
        Finding(
            id="f_002",
            generator="G01",
            tenant_id=TENANT_ID,
            brief_type="gmv",
            section_affinity=[1],
            entity=EntityRef(id="sovella", display_name="Sovella"),
            level=FindingLevel.ACCOUNT,
            claim_frame="identity_decomposition",
            evidence={"gmv": 506_058_865},
            comparison=None,
            magnitude_pct=1.0,
            direction="positive",
            actionability="high",
            confidence="high",
            materiality=0.9,
        )


def test_finding_accepts_a_real_g02_style_outlier_and_defaults_origin_to_generator() -> None:
    finding = Finding(
        id="eff_002",
        generator="G02",
        tenant_id=TENANT_ID,
        brief_type="gmv",
        section_affinity=[3],
        entity=EntityRef(id="live_03", display_name="Promo Special Payday Sale #2"),
        level=FindingLevel.SESSION,
        claim_frame="efficiency_outlier_positive",
        evidence={"roi": 27.34, "cohort_median_roi": 8.02, "cost": 249_609, "gmv": 6_825_500},
        comparison=Comparison(
            basis=ComparisonBasis.COHORT_MEDIAN,
            baseline_value=8.02,
            current_value=27.34,
            delta_abs=19.32,
            delta_pct=2.409,
        ),
        magnitude_pct=0.05,
        direction="positive",
        actionability="high",
        confidence="high",
        materiality=0.0,
        provenance=["paid_hourly_metrics:live_session=live_03"],
    )
    assert finding.claim_frame == "efficiency_outlier_positive"
    assert finding.origin == Origin.GENERATOR


def test_finding_can_declare_probe_origin() -> None:
    finding = Finding(
        id="probe_001",
        generator="analyst_probe",
        tenant_id=TENANT_ID,
        brief_type="gmv",
        section_affinity=[5],
        entity=EntityRef(id="sku_lennon", display_name="SOVELLA Lennon"),
        level=FindingLevel.PRODUCT,
        claim_frame="concentration_dependency",
        evidence={"share": 0.42},
        comparison=None,
        magnitude_pct=0.42,
        direction="neutral",
        actionability="medium",
        confidence="medium",
        materiality=0.0,
        origin=Origin.PROBE,
    )
    assert finding.origin == Origin.PROBE
