"""Small lookups shared across generator implementations. Not part of the
public API — generators import directly from here.
"""

from __future__ import annotations

from engine.contracts import (
    EntityLevel,
    FindingLevel,
    IdentityEquation,
    MetricFrame,
    MetricRecord,
    ObjectiveContract,
)


def account_record(frame: MetricFrame, period_label: str) -> MetricRecord | None:
    period = frame.current_period if period_label == "current" else frame.prior_period
    if period is None:
        return None
    for r in frame.records:
        if r.entity.level == EntityLevel.ACCOUNT and r.period == period:
            return r
    return None


def records_by_level(frame: MetricFrame, level: EntityLevel, period_label: str = "current") -> list[MetricRecord]:
    period = frame.current_period if period_label == "current" else frame.prior_period
    if period is None:
        return []
    return [r for r in frame.records if r.entity.level == level and r.period == period]


def non_account_records(frame: MetricFrame, period_label: str = "current") -> list[MetricRecord]:
    period = frame.current_period if period_label == "current" else frame.prior_period
    if period is None:
        return []
    return [r for r in frame.records if r.entity.level != EntityLevel.ACCOUNT and r.period == period]


def finding_level_of(entity_level: EntityLevel) -> FindingLevel:
    """Convert a `MetricRecord`'s (broader) `EntityLevel` to the narrower
    `FindingLevel` a `Finding` must declare. Raises for a level that has no
    `Finding`-level counterpart (e.g. `placement`, `geo`) — those axes exist
    for `dimensions` grouping (G06), not as a `Finding`'s own subject, so a
    generator hitting this is a sign it built an `entity`/`level` pair the
    contract does not support, not something to paper over with a fallback.
    """
    try:
        return FindingLevel(entity_level.value)
    except ValueError as exc:
        raise ValueError(
            f"EntityLevel {entity_level.value!r} has no corresponding FindingLevel — "
            "a Finding cannot be produced directly about this kind of thing"
        ) from exc


def flatten_identity_chain(contract: ObjectiveContract) -> tuple[list[str], float]:
    """Expand `primary_outcome` down to its root (non-derived) factors, e.g.
    GMV's chain -> (["aov", "cvr", "ctr", "impressions"], 1.0)."""
    by_outcome: dict[str, IdentityEquation] = {eq.outcome: eq for eq in contract.identity_chain}

    def expand(metric: str) -> tuple[list[str], float]:
        eq = by_outcome.get(metric)
        if eq is None:
            return [metric], 1.0
        leaves: list[str] = []
        divisor = eq.divisor
        for factor in eq.factors:
            sub_leaves, sub_divisor = expand(factor)
            leaves.extend(sub_leaves)
            divisor *= sub_divisor
        return leaves, divisor

    return expand(contract.primary_outcome)
