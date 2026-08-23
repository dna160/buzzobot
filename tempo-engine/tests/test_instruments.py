"""The six probe-loop instruments, deterministic and LLM-free — every
instrument is a pure function, tested the same way the generators are."""

from __future__ import annotations

import pytest

from engine.contracts import ClaimFrame, EntityLevel, Origin
from engine.instruments import run_instrument
from engine.instruments.finding_builder import build_finding_from_instrument
from eval.fixtures.sovella_gmv_week import GMV_OBJECTIVE_CONTRACT, TENANT_ID, build_sovella_gmv_metric_frame


@pytest.fixture()
def frame():
    return build_sovella_gmv_metric_frame()


def test_concentration_on_session_level_matches_g03(frame) -> None:  # noqa: ANN001
    result = run_instrument("concentration", frame, GMV_OBJECTIVE_CONTRACT, level="session", metric="gmv")
    assert result.ok
    assert result.data["cohort_level"] == "session"
    assert 0.0 < result.data["top1_share"] <= 1.0


def test_concentration_reports_gap_below_min_entities(frame) -> None:  # noqa: ANN001
    result = run_instrument("concentration", frame, GMV_OBJECTIVE_CONTRACT, level="campaign", metric="orders")
    # only 1 of the 2 campaigns carries "orders" in the fixture
    assert not result.ok


def test_efficiency_outliers_finds_the_2734x_session(frame) -> None:  # noqa: ANN001
    result = run_instrument("efficiency_outliers", frame, GMV_OBJECTIVE_CONTRACT, level="session", metric="roi")
    assert result.ok
    assert any(o["value"] == pytest.approx(27.34) for o in result.data["outliers"])


def test_decompose_at_account_level_matches_g01(frame) -> None:  # noqa: ANN001
    result = run_instrument("decompose", frame, GMV_OBJECTIVE_CONTRACT, level="account")
    assert result.ok
    total_delta = result.data["delta"]
    contribution_sum = sum(result.data["contributions"].values())
    assert contribution_sum == pytest.approx(total_delta, rel=1e-6)


def test_decompose_at_entity_level_reports_gap_without_prior_period(frame) -> None:  # noqa: ANN001
    result = run_instrument("decompose", frame, GMV_OBJECTIVE_CONTRACT, level="product", entity_id="sku_lennon")
    assert not result.ok  # no prior-period product record in this fixture


def test_marginal_return_reports_gap_without_entity_history(frame) -> None:  # noqa: ANN001
    result = run_instrument("marginal_return", frame, GMV_OBJECTIVE_CONTRACT, level="session")
    assert not result.ok


def test_cohort_slice_returns_additive_totals_only(frame) -> None:  # noqa: ANN001
    result = run_instrument("cohort_slice", frame, GMV_OBJECTIVE_CONTRACT, dimension="campaign_type", dimension_value="gmv_max")
    assert result.ok
    assert "gmv" in result.data["totals"]
    assert "roi" not in result.data["totals"]  # ratio, never summed


def test_cohort_slice_reports_gap_for_unknown_value(frame) -> None:  # noqa: ANN001
    result = run_instrument("cohort_slice", frame, GMV_OBJECTIVE_CONTRACT, dimension="campaign_type", dimension_value="does_not_exist")
    assert not result.ok


def test_unknown_instrument_name_is_rejected(frame) -> None:  # noqa: ANN001
    result = run_instrument("raw_sql_query", frame, GMV_OBJECTIVE_CONTRACT)
    assert not result.ok
    assert "not in the allowlist" in result.reason


def test_hallucinated_level_value_degrades_gracefully_instead_of_crashing(frame) -> None:  # noqa: ANN001
    """A small local model does not always comply with the analyst prompt's
    "choose level only from the list you were given" instruction — a bad
    `level` string must fail the probe (real yield-rate signal), never
    raise past `run_instrument` and take down the whole graph run (found
    live: the analyst proposed level='ad1_2_3', an EntityLevel ValueError
    crashed the entire /v1/briefs/sync request with a 500)."""
    result = run_instrument("concentration", frame, GMV_OBJECTIVE_CONTRACT, level="ad1_2_3", metric="gmv")
    assert not result.ok
    assert "invalid parameter value" in result.reason


# --- finding_builder ---------------------------------------------------------


def test_build_finding_from_successful_instrument(frame) -> None:  # noqa: ANN001
    result = run_instrument("efficiency_outliers", frame, GMV_OBJECTIVE_CONTRACT, level="session", metric="roi")
    finding = build_finding_from_instrument(result, finding_id="probe_001", tenant_id=TENANT_ID, brief_type="gmv", probe_id="p1")
    assert finding is not None
    assert finding.origin == Origin.PROBE
    assert finding.claim_frame == ClaimFrame.EFFICIENCY_OUTLIER_POSITIVE.value
    assert finding.generator == "analyst_probe:efficiency_outliers"


def test_build_finding_returns_none_for_failed_instrument(frame) -> None:  # noqa: ANN001
    result = run_instrument("marginal_return", frame, GMV_OBJECTIVE_CONTRACT, level="session")
    finding = build_finding_from_instrument(result, finding_id="probe_002", tenant_id=TENANT_ID, brief_type="gmv", probe_id="p2")
    assert finding is None  # this IS the "zero yield" signal — no Finding fabricated from a null result


def test_build_finding_evidence_is_flat_scalars_only(frame) -> None:  # noqa: ANN001
    result = run_instrument("decompose", frame, GMV_OBJECTIVE_CONTRACT, level="account")
    finding = build_finding_from_instrument(result, finding_id="probe_003", tenant_id=TENANT_ID, brief_type="gmv", probe_id="p3")
    assert finding is not None
    for v in finding.evidence.values():
        assert isinstance(v, (int, float, str))
