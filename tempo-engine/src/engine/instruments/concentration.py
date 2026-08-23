"""`concentration(level, metric, axis)` — PRD §5.2. Like G03, but the
analyst chooses the level and metric, not the fixed set G03 always checks —
this is the whole point of the probe loop: asking a question the fixed
battery didn't."""

from __future__ import annotations

from engine.contracts import EntityLevel, EntityRef, MetricFrame
from engine.generators._util import finding_level_of, records_by_level
from engine.instruments.base import InstrumentResult
from engine.stats import gini_coefficient, herfindahl_hirschman_index

MIN_ENTITIES = 3


def concentration(frame: MetricFrame, level: EntityLevel, metric: str) -> InstrumentResult:
    records = [r for r in records_by_level(frame, level, "current") if metric in r.metrics]
    if len(records) < MIN_ENTITIES:
        return InstrumentResult(
            instrument="concentration", ok=False,
            reason=f"fewer than {MIN_ENTITIES} {level.value} records carry {metric!r}",
        )

    values = [r.metrics[metric] for r in records]
    total = sum(values)
    if total <= 0:
        return InstrumentResult(instrument="concentration", ok=False, reason=f"total {metric} is zero across {level.value}")

    shares = [v / total for v in values]
    hhi = herfindahl_hirschman_index(shares)
    gini = gini_coefficient(values)
    top_idx = max(range(len(records)), key=lambda i: values[i])

    top_entity = records[top_idx].entity
    return InstrumentResult(
        instrument="concentration", ok=True,
        entity=EntityRef(id=top_entity.id, display_name=top_entity.display_name),
        level=finding_level_of(level),
        data={
            "metric": metric,
            "cohort_level": level.value,
            "cohort_size": len(records),
            "hhi": round(hhi, 4),
            "gini": round(gini, 4),
            "top1_share": round(shares[top_idx], 4),
            "top1_value": values[top_idx],
            "total": total,
        },
    )
