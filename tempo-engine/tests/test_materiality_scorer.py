"""materiality = sqrt(magnitude_pct) x actionability_weight x confidence_weight."""

from __future__ import annotations

import math

import pytest

from engine.contracts import Comparison, ComparisonBasis, EntityRef, Finding, FindingLevel
from engine.materiality.scorer import score_finding


def _finding(**overrides) -> Finding:  # noqa: ANN003
    defaults = dict(
        id="f1",
        generator="G02",
        tenant_id="t1",
        brief_type="gmv",
        section_affinity=[3],
        entity=EntityRef(id="e1", display_name="Entity 1"),
        level=FindingLevel.SESSION,
        claim_frame="efficiency_outlier_positive",
        evidence={"roi": 10.0},
        comparison=None,
        magnitude_pct=0.25,
        direction="positive",
        actionability="high",
        confidence="high",
        materiality=0.0,
    )
    defaults.update(overrides)
    return Finding(**defaults)


def test_score_is_sqrt_magnitude_times_weights() -> None:
    finding = _finding(magnitude_pct=0.25, actionability="high", confidence="high")
    scored = score_finding(finding, "gmv")
    assert scored.materiality == pytest.approx(math.sqrt(0.25) * 1.0 * 1.0)


def test_low_confidence_and_actionability_reduce_score() -> None:
    high = score_finding(_finding(magnitude_pct=0.5, actionability="high", confidence="high"), "gmv")
    low = score_finding(_finding(magnitude_pct=0.5, actionability="low", confidence="low"), "gmv")
    assert low.materiality < high.materiality


def test_sqrt_compresses_magnitude_so_big_does_not_dominate_everything() -> None:
    """A finding at 4% magnitude should not score 25x below one at 100% —
    that ratio would be true of a raw product, not sqrt."""
    small = score_finding(_finding(magnitude_pct=0.04, actionability="high", confidence="high"), "gmv")
    large = score_finding(_finding(magnitude_pct=1.0, actionability="high", confidence="high"), "gmv")
    ratio = large.materiality / small.materiality
    assert ratio == pytest.approx(5.0)  # sqrt(1.0)/sqrt(0.04) = 1/0.2 = 5, not 25


def test_scoring_does_not_mutate_the_input_finding() -> None:
    original = _finding(materiality=0.0)
    score_finding(original, "gmv")
    assert original.materiality == 0.0  # Finding is frozen; scorer returns a copy
