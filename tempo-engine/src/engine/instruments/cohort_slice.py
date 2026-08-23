"""`cohort_slice(dimension, value)` — PRD §5.2. Returns aggregated totals
for every entity where `dimensions[dimension] == value` — a raw filtered
view, not a statistic. Ratios are recomputed from summed numerators/
denominators (never averaged, Hard Rule 2) exactly like every generator's
own rollup."""

from __future__ import annotations

from engine.contracts import EntityRef, MetricFrame
from engine.instruments.base import InstrumentResult


def cohort_slice(frame: MetricFrame, dimension: str, value: str) -> InstrumentResult:
    records = [r for r in frame.records if r.period == frame.current_period and r.dimensions.get(dimension) == value]
    if not records:
        return InstrumentResult(instrument="cohort_slice", ok=False, reason=f"no current-period entity has {dimension}={value!r}")

    all_metric_keys = {k for r in records for k in r.metrics}
    totals: dict[str, float] = {}
    for key in all_metric_keys:
        # Additive metrics only — never sum a ratio (Hard Rule 2). A key
        # that looks like a rate/ratio is skipped here; the caller recomputes
        # any ratio it needs from the additive totals returned (e.g. cost,
        # gmv, orders, impressions, clicks), the same discipline every
        # generator's own `finish()`/`derive_*` step already follows.
        if key in {"ctr", "cvr", "aov", "roi", "cpm", "cpc", "cpa", "conversion_rate", "vtr6s", "vtr15s", "frequency"}:
            continue
        totals[key] = sum(r.metrics.get(key, 0.0) for r in records)

    return InstrumentResult(
        instrument="cohort_slice", ok=True,
        entity=EntityRef(id=f"{dimension}={value}", display_name=f"{dimension}={value}"),
        data={"dimension": dimension, "value": value, "entity_count": len(records), "totals": totals},
    )
