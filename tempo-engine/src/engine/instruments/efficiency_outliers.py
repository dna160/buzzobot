"""`efficiency_outliers(level, metric, cohort, min_volume)` — PRD §5.2. Like
G02, but the analyst chooses the metric (not fixed to the objective
contract's `efficiency_metric`) — e.g. probing CTR outliers on an Awareness
brief, or views-per-order on a GMV brief."""

from __future__ import annotations

from engine.contracts import EntityLevel, EntityRef, MetricFrame
from engine.generators._util import finding_level_of, records_by_level
from engine.instruments.base import InstrumentResult
from engine.stats import median, robust_z_scores

MIN_COHORT_SIZE = 4
Z_THRESHOLD = 2.0


def efficiency_outliers(
    frame: MetricFrame, level: EntityLevel, metric: str, min_volume_share: float = 0.01
) -> InstrumentResult:
    records = [r for r in records_by_level(frame, level, "current") if metric in r.metrics]
    if len(records) < MIN_COHORT_SIZE:
        return InstrumentResult(
            instrument="efficiency_outliers", ok=False,
            reason=f"fewer than {MIN_COHORT_SIZE} {level.value} records carry {metric!r}",
        )

    cost_key = "cost" if all("cost" in r.metrics for r in records) else None
    total_cost = sum(r.metrics.get(cost_key, 0.0) for r in records) if cost_key else None
    qualified = [
        r for r in records
        if total_cost is None or total_cost == 0 or (r.metrics.get(cost_key, 0.0) / total_cost) >= min_volume_share  # type: ignore[arg-type]
    ]
    if len(qualified) < MIN_COHORT_SIZE:
        return InstrumentResult(instrument="efficiency_outliers", ok=False, reason="fewer than 4 entities cleared the volume floor")

    values = [r.metrics[metric] for r in qualified]
    z_scores = robust_z_scores(values)
    med = median(values)

    outliers = [
        {"entity_id": r.entity.id, "entity_name": r.entity.display_name, "value": v, "z_score": round(z, 3)}
        for r, v, z in zip(qualified, values, z_scores, strict=True)
        if abs(z) >= Z_THRESHOLD
    ]
    if not outliers:
        return InstrumentResult(instrument="efficiency_outliers", ok=False, reason="no entity exceeded the z-score threshold")

    top = max(outliers, key=lambda o: abs(o["z_score"]))
    return InstrumentResult(
        instrument="efficiency_outliers", ok=True,
        entity=EntityRef(id=top["entity_id"], display_name=top["entity_name"]),
        level=finding_level_of(level),
        data={"metric": metric, "cohort_level": level.value, "cohort_median": med, "cohort_size": len(qualified), "outliers": outliers},
    )
