"""Pure statistical primitives shared by the generators (PRD §6.3).

No dependency on pydantic/contracts — plain-number functions, independently
testable. Dependency-free (no scipy/statsmodels — the PRD's stack lists them
for the v1.1 advanced statistical layer, §6.4, explicitly gated on >=12
periods and explicitly "do not build before B7"; nothing at B2 needs them,
and every formula here — LMDI-I, MAD-based robust z, Welch's t, BH-FDR — is
closed-form and short enough that adding scipy for it now would cost more in
image size and audit surface than it saves).
"""

from __future__ import annotations

import math
from dataclasses import dataclass


# --- G01: LMDI-I (Log-Mean Divisia Index, additive) -------------------------


def logarithmic_mean(a: float, b: float) -> float:
    """L(a,b) = (a-b) / (ln a - ln b). Degenerates to `a` when a == b."""
    if a <= 0 or b <= 0:
        raise ValueError(f"logarithmic_mean requires positive inputs, got a={a}, b={b}")
    if math.isclose(a, b, rel_tol=1e-12):
        return a
    return (a - b) / (math.log(a) - math.log(b))


def lmdi_additive_decomposition(
    current_factors: dict[str, float], prior_factors: dict[str, float]
) -> dict[str, float]:
    """Exact, additive attribution of the delta in `product(factors)` to
    each factor. Per-factor contributions sum to exactly `V1 - V0`."""
    if current_factors.keys() != prior_factors.keys():
        raise ValueError("current_factors and prior_factors must share the same keys")

    v1 = math.prod(current_factors.values())
    v0 = math.prod(prior_factors.values())
    weight = logarithmic_mean(v1, v0)

    return {
        name: weight * math.log(current_factors[name] / prior_factors[name])
        for name in current_factors
    }


# --- G02: robust z-score (median + MAD), both tails -------------------------


def median(values: list[float]) -> float:
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 == 1 else (s[mid - 1] + s[mid]) / 2


def mad(values: list[float], center: float | None = None) -> float:
    m = center if center is not None else median(values)
    return median([abs(v - m) for v in values])


MAD_TO_SIGMA = 1.4826  # 1/Phi^-1(0.75) — makes MAD consistent with std for normal data.


def robust_z_scores(values: list[float]) -> list[float]:
    """Median + MAD robust z-score per value. 0.0 for every value when MAD
    is 0 (a degenerate cohort with no spread has no outliers to flag)."""
    m = median(values)
    spread = mad(values, center=m) * MAD_TO_SIGMA
    if spread == 0:
        return [0.0 for _ in values]
    return [(v - m) / spread for v in values]


# --- G03: HHI and Gini concentration -----------------------------------------


def herfindahl_hirschman_index(shares: list[float]) -> float:
    """HHI on 0..1-normalized shares."""
    return sum(s * s for s in shares)


def gini_coefficient(values: list[float]) -> float:
    n = len(values)
    if n == 0:
        return 0.0
    total = sum(values)
    if total == 0:
        return 0.0
    s = sorted(values)
    cumulative = sum((i + 1) * v for i, v in enumerate(s))
    return (2 * cumulative) / (n * total) - (n + 1) / n


# --- marginal_return (probe-loop instrument, B7 — the G05 generator itself
# is deferred to B8, but the underlying math is needed now: PRD §5.2 lists
# `marginal_return(entity_level, window)` as one of the analyst's six
# allowlisted instruments) ------------------------------------------------


def marginal_return(delta_outcome: float, delta_spend: float) -> float | None:
    """Δoutcome / Δspend. None when spend did not move (division is
    meaningless, not a signal of infinite efficiency)."""
    if math.isclose(delta_spend, 0.0, abs_tol=1e-9):
        return None
    return delta_outcome / delta_spend


# --- G06: Welch's t-test + Benjamini-Hochberg FDR ----------------------------


@dataclass(frozen=True)
class TTestResult:
    t_statistic: float
    degrees_of_freedom: float
    p_value: float
    effect_size: float  # Cohen's d (pooled), standardized mean difference


def _sample_variance(values: list[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    m = sum(values) / n
    return sum((v - m) ** 2 for v in values) / (n - 1)


def welch_t_test(sample_a: list[float], sample_b: list[float]) -> TTestResult | None:
    """Two-sample Welch's t-test (unequal variance), closed-form, no scipy.
    None when either sample has fewer than 2 observations."""
    n_a, n_b = len(sample_a), len(sample_b)
    if n_a < 2 or n_b < 2:
        return None

    mean_a, mean_b = sum(sample_a) / n_a, sum(sample_b) / n_b
    var_a, var_b = _sample_variance(sample_a), _sample_variance(sample_b)

    se_sq = var_a / n_a + var_b / n_b
    if se_sq <= 0:
        return None
    se = math.sqrt(se_sq)

    t_stat = (mean_a - mean_b) / se

    denom = ((var_a / n_a) ** 2) / (n_a - 1) + ((var_b / n_b) ** 2) / (n_b - 1)
    dof = se_sq**2 / denom if denom > 0 else n_a + n_b - 2

    p_value = _two_sided_p_from_t(t_stat, dof)

    pooled_sd = math.sqrt((var_a + var_b) / 2)
    effect_size = (mean_a - mean_b) / pooled_sd if pooled_sd > 0 else 0.0

    return TTestResult(t_statistic=t_stat, degrees_of_freedom=dof, p_value=p_value, effect_size=effect_size)


def _two_sided_p_from_t(t: float, dof: float) -> float:
    """x = dof/(dof+t^2) depends only on t^2, so this is sign-symmetric in t."""
    x = dof / (dof + t * t)
    p_one_tail = 0.5 * _regularized_incomplete_beta(x, dof / 2, 0.5)
    return min(1.0, 2 * p_one_tail)


def _regularized_incomplete_beta(x: float, a: float, b: float) -> float:
    """I_x(a, b) via a continued fraction (Numerical Recipes formulation)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0

    ln_beta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x)
    front = math.exp(ln_beta) / a

    if x < (a + 1) / (a + b + 2):
        return front * _beta_continued_fraction(x, a, b)
    return 1.0 - (math.exp(ln_beta) / b) * _beta_continued_fraction(1 - x, b, a)


def _beta_continued_fraction(x: float, a: float, b: float, max_iter: int = 200, eps: float = 1e-10) -> float:
    qab, qap, qam = a + b, a + 1, a - 1
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < 1e-30:
        d = 1e-30
    d = 1.0 / d
    h = d

    for m in range(1, max_iter + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < 1e-30:
            d = 1e-30
        c = 1.0 + aa / c
        if abs(c) < 1e-30:
            c = 1e-30
        d = 1.0 / d
        h *= d * c

        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < 1e-30:
            d = 1e-30
        c = 1.0 + aa / c
        if abs(c) < 1e-30:
            c = 1e-30
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break

    return h


def benjamini_hochberg(p_values: list[float]) -> list[float]:
    """Benjamini-Hochberg FDR-adjusted p-values, order preserved."""
    n = len(p_values)
    if n == 0:
        return []
    indexed = sorted(range(n), key=lambda i: p_values[i])
    adjusted = [0.0] * n

    running_min = 1.0
    for rank in range(n, 0, -1):
        i = indexed[rank - 1]
        candidate = p_values[i] * n / rank
        running_min = min(running_min, candidate)
        adjusted[i] = min(1.0, running_min)

    return adjusted
