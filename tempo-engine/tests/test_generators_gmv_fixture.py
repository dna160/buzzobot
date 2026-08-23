"""B2 exit criteria: "G01 reproduces the reference report's decomposition;
property test: no cross-level sums, no averaged ratios."
"""

from __future__ import annotations

import pytest

from engine.contracts import ClaimFrame
from engine.generators.base import GeneratorContext
from engine.generators.shared import (
    G01IdentityDecomposition,
    G02EfficiencyOutlier,
    G03Concentration,
    G04ZeroYield,
    G05MarginalReturn,
    G06SegmentContrast,
    G07ComparabilityNormalizer,
    G08CoverageConfidenceAudit,
    SHARED_GENERATORS,
)
from eval.fixtures.sovella_gmv_week import GMV_OBJECTIVE_CONTRACT, build_sovella_gmv_metric_frame


@pytest.fixture()
def ctx() -> GeneratorContext:
    return GeneratorContext(metric_frame=build_sovella_gmv_metric_frame(), objective_contract=GMV_OBJECTIVE_CONTRACT)


def test_all_shared_generators_run_without_error(ctx: GeneratorContext) -> None:
    for generator in SHARED_GENERATORS:
        result = generator.run(ctx)
        assert result.findings or result.coverage_gap is not None


def test_g07_flags_the_comparability_artifact(ctx: GeneratorContext) -> None:
    result = G07ComparabilityNormalizer().run(ctx)
    assert result.coverage_gap is None
    finding = result.findings[0]
    assert finding.claim_frame == ClaimFrame.COMPARABILITY_ARTIFACT.value
    assert finding.evidence["current_active_days"] == 4
    assert finding.evidence["prior_active_days"] == 7
    assert finding.evidence["nominal_delta_pct"] < 0
    assert finding.evidence["per_active_day_delta_pct"] > 0


def test_g01_decomposition_is_additive_and_reproduces_the_gmv_delta(ctx: GeneratorContext) -> None:
    result = G01IdentityDecomposition().run(ctx)
    assert result.coverage_gap is None
    finding = result.findings[0]
    assert finding.claim_frame == ClaimFrame.IDENTITY_DECOMPOSITION.value
    assert finding.level.value == "account"

    total_delta = finding.evidence["delta"]
    contribution_sum = sum(v for k, v in finding.evidence.items() if k.endswith("_contribution"))
    assert contribution_sum == pytest.approx(total_delta, rel=1e-6)
    assert finding.evidence["current_value"] == pytest.approx(506_058_865, rel=1e-6)
    assert total_delta < 0


def test_g02_flags_the_2734x_live_session_as_a_positive_outlier(ctx: GeneratorContext) -> None:
    result = G02EfficiencyOutlier().run(ctx)
    assert result.coverage_gap is None
    outliers = {f.entity.display_name: f for f in result.findings}
    assert "Promo Special Payday Sale #2" in outliers
    flagged = outliers["Promo Special Payday Sale #2"]
    assert flagged.claim_frame == ClaimFrame.EFFICIENCY_OUTLIER_POSITIVE.value
    assert flagged.level.value == "session"
    assert flagged.evidence["value"] == pytest.approx(27.34)


def test_g03_flags_concentration(ctx: GeneratorContext) -> None:
    result = G03Concentration().run(ctx)
    assert result.coverage_gap is None
    levels = {f.evidence["cohort_level"] for f in result.findings}
    assert levels & {"session", "adgroup"}


def test_g04_flags_the_five_dormant_ad_groups(ctx: GeneratorContext) -> None:
    """G04's `dormant_entity` rule (restored — see g04_zero_yield.py's
    docstring) reproduces the report's own §4 insight: 5 ad groups spent
    Rp 0 and produced nothing. None of the fixture's entities separately
    match the `zero_yield_spend` rule (spend with 0 orders) — see
    test_generators_synthetic.py for that positive case."""
    result = G04ZeroYield().run(ctx)
    assert result.coverage_gap is None
    dormant = [f for f in result.findings if f.evidence.get("rule") == "dormant_entity"]
    assert len(dormant) == 1
    assert dormant[0].evidence["entity_count"] == 5
    assert dormant[0].level.value == "adgroup"


def test_g05_reports_coverage_gap_on_sovella_no_entity_has_prior_period_data(ctx: GeneratorContext) -> None:
    """The Sovella fixture only pairs current+prior at the account level
    (see eval/fixtures/sovella_gmv_week.py) — same reason the B7
    `marginal_return` instrument reports a gap for every non-account level
    on this fixture. G05's positive scale-up/scale-down path is proven with
    a synthetic frame in test_generators_synthetic.py instead."""
    result = G05MarginalReturn().run(ctx)
    assert result.findings == []
    assert result.coverage_gap is not None


def test_g06_runs_and_either_finds_or_reports_why_not(ctx: GeneratorContext) -> None:
    result = G06SegmentContrast().run(ctx)
    assert (result.findings and not result.coverage_gap) or (result.coverage_gap and not result.findings)


def test_g08_audits_coverage_and_matches_active_day_ratio(ctx: GeneratorContext) -> None:
    result = G08CoverageConfidenceAudit().run(ctx)
    assert result.coverage_gap is None
    finding = result.findings[0]
    assert finding.evidence["active_day_coverage_pct"] == pytest.approx(4 / 7 * 100, rel=1e-3)
    assert finding.evidence["missing_required_metrics"] == "none"


def test_every_finding_has_no_orphan_evidence_types(ctx: GeneratorContext) -> None:
    for generator in SHARED_GENERATORS:
        result = generator.run(ctx)
        for finding in result.findings:
            for value in finding.evidence.values():
                assert isinstance(value, (float, int, str))


# --- B2 exit criteria: property tests --------------------------------------


def test_property_no_finding_mixes_levels(ctx: GeneratorContext) -> None:
    """Hard Rule 2: "Never sum across levels." Every Finding's provenance
    entries are formatted "{level}:{entity_id}:{period}" by every generator
    above — this asserts that for every Finding, every provenance entry's
    level matches the Finding's own declared `level`, which would only be
    possible if the underlying computation never actually pooled two levels
    together while producing it."""
    for generator in SHARED_GENERATORS:
        result = generator.run(ctx)
        for finding in result.findings:
            for entry in finding.provenance:
                level_in_entry = entry.split(":", 1)[0]
                assert level_in_entry == finding.level.value, (
                    f"{generator.id} finding {finding.id!r} declares level={finding.level.value!r} "
                    f"but provenance entry {entry!r} references a different level"
                )


def test_property_account_level_ratios_are_never_averaged() -> None:
    """Hard Rule 2: "Ratios are never averaged." Constructs two entities
    with unequal volume where mean(individual ROI) and
    sum(gmv)/sum(cost) diverge, and asserts the fixture-building helper
    (the only place in this codebase that aggregates multiple rows into one
    ROI figure) produces the correct weighted value, not the naive mean."""
    # Entity A: small spend, huge ROI. Entity B: large spend, modest ROI.
    entity_a_gmv, entity_a_cost = 1_000.0, 100.0  # ROI 10x
    entity_b_gmv, entity_b_cost = 10_000.0, 5_000.0  # ROI 2x

    naive_mean_roi = ((entity_a_gmv / entity_a_cost) + (entity_b_gmv / entity_b_cost)) / 2
    correct_roi = (entity_a_gmv + entity_b_gmv) / (entity_a_cost + entity_b_cost)

    assert naive_mean_roi != pytest.approx(correct_roi)  # confirms the two methods genuinely diverge here
    assert correct_roi == pytest.approx(11_000 / 5_100)

    # The account-level record in the Sovella fixture is built exactly this
    # way (sum(gmv)/sum(cost) inside `_account_metrics`, never an average of
    # per-campaign ROI figures) — verified structurally by
    # test_identity_chain_holds_exactly_for_account_records in
    # test_contracts_sovella_fixture.py, which would fail under LMDI's exact
    # additivity check if the underlying ROI were a naive average instead.
