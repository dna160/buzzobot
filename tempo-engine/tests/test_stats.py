"""Correctness tests for the pure math primitives generators rely on."""

from __future__ import annotations

import math

import pytest

from engine.stats import (
    benjamini_hochberg,
    gini_coefficient,
    herfindahl_hirschman_index,
    lmdi_additive_decomposition,
    logarithmic_mean,
    mad,
    median,
    robust_z_scores,
    welch_t_test,
)


def test_logarithmic_mean_degenerates_to_input_when_equal() -> None:
    assert logarithmic_mean(5.0, 5.0) == 5.0


def test_logarithmic_mean_known_value() -> None:
    assert logarithmic_mean(math.e, 1.0) == pytest.approx(math.e - 1)


def test_lmdi_decomposition_is_exactly_additive() -> None:
    current = {"impressions": 6_980_917.0, "ctr": 0.012, "cvr": 0.035, "aov": 172_595.0}
    prior = {"impressions": 6_650_182.0, "ctr": 0.011, "cvr": 0.033, "aov": 265_900.0}
    v1 = math.prod(current.values())
    v0 = math.prod(prior.values())
    contributions = lmdi_additive_decomposition(current, prior)
    assert sum(contributions.values()) == pytest.approx(v1 - v0, rel=1e-9)


def test_lmdi_decomposition_requires_matching_keys() -> None:
    with pytest.raises(ValueError):
        lmdi_additive_decomposition({"a": 1.0}, {"b": 1.0})


def test_lmdi_no_change_gives_zero_contribution() -> None:
    factors = {"a": 10.0, "b": 20.0}
    contributions = lmdi_additive_decomposition(factors, dict(factors))
    assert contributions["a"] == pytest.approx(0.0, abs=1e-12)
    assert contributions["b"] == pytest.approx(0.0, abs=1e-12)


def test_median_odd_and_even() -> None:
    assert median([1.0, 3.0, 2.0]) == 2.0
    assert median([1.0, 2.0, 3.0, 4.0]) == 2.5


def test_mad_of_constant_series_is_zero() -> None:
    assert mad([5.0, 5.0, 5.0]) == 0.0


def test_robust_z_scores_flags_the_obvious_outlier() -> None:
    values = [8.0, 8.2, 7.9, 8.1, 27.34]
    z = robust_z_scores(values)
    assert z[-1] > 3.0
    assert all(abs(x) < 1.5 for x in z[:-1])


def test_robust_z_scores_all_equal_returns_zeros_not_nan() -> None:
    assert robust_z_scores([5.0, 5.0, 5.0, 5.0]) == [0.0, 0.0, 0.0, 0.0]


def test_hhi_perfect_equality_vs_monopoly() -> None:
    n = 5
    assert herfindahl_hirschman_index([1 / n] * n) == pytest.approx(1 / n)
    assert herfindahl_hirschman_index([1.0, 0.0, 0.0, 0.0, 0.0]) == pytest.approx(1.0)


def test_gini_perfect_equality_is_zero() -> None:
    assert gini_coefficient([10.0, 10.0, 10.0, 10.0]) == pytest.approx(0.0, abs=1e-9)


def test_gini_maximal_inequality_approaches_one() -> None:
    assert gini_coefficient([0.0, 0.0, 0.0, 100.0]) > 0.7


def test_welch_t_test_identical_samples_high_p_value() -> None:
    result = welch_t_test([10.0, 10.1, 9.9, 10.05], [10.0, 9.95, 10.02, 10.1])
    assert result is not None
    assert result.p_value > 0.5


def test_welch_t_test_clearly_separated_samples_low_p_value() -> None:
    result = welch_t_test([1.0, 1.1, 0.9, 1.05, 0.95], [10.0, 10.1, 9.9, 10.05, 9.95])
    assert result is not None
    assert result.p_value < 0.01
    assert abs(result.effect_size) > 5


def test_welch_t_test_returns_none_for_too_small_sample() -> None:
    assert welch_t_test([1.0], [1.0, 2.0]) is None


def test_benjamini_hochberg_all_significant_when_all_tiny() -> None:
    adjusted = benjamini_hochberg([0.001, 0.002, 0.0005])
    assert all(p < 0.01 for p in adjusted)


def test_benjamini_hochberg_controls_false_discovery_vs_raw() -> None:
    p_values = [0.001, 0.04, 0.03, 0.02, 0.5]
    adjusted = benjamini_hochberg(p_values)
    assert all(adj >= raw - 1e-12 for adj, raw in zip(adjusted, p_values, strict=True))
    order = sorted(range(len(p_values)), key=lambda i: p_values[i])
    assert all(adjusted[order[i]] <= adjusted[order[i + 1]] for i in range(len(order) - 1))


def test_benjamini_hochberg_empty_input() -> None:
    assert benjamini_hochberg([]) == []
