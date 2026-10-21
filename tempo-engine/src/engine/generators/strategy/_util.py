"""Shared helpers for the strategy generators (T01–T11). Pure functions of a
`StrategyFrame`; nothing here reads a database or calls a model.

`metric_value` is the one place a catalog metric key is evaluated against the
frame. The Target Solver (T09) sets `current` with it and the re-measurement
generator (T11) measures with it, so an action is always judged by the same
arithmetic that sized it.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, timedelta
from typing import Literal

from engine.contracts import Comparison, Confidence, Direction, EntityRef, Finding, FindingLevel
from engine.contracts.strategy import AudienceDay, InsightDay, StrategyFrame

Window = Literal["current", "prior"]


def window_bounds(frame: StrategyFrame, which: Window) -> tuple[date, date]:
    return (frame.current_start, frame.as_of) if which == "current" else (frame.prior_start, frame.prior_end)


def in_range(days: Iterable, start: date, end: date) -> list:
    return [d for d in days if start <= d.date <= end]


def last_day(series: list[AudienceDay], on: date) -> AudienceDay | None:
    """The row for `on`, or the latest earlier one (a series may skip a day)."""
    earlier = [d for d in series if d.date <= on]
    return earlier[-1] if earlier else None


def flow_sum(series: list[AudienceDay], start: date, end: date, field: Literal["new", "outflow"]) -> float | None:
    vals = [getattr(d, field) for d in in_range(series, start, end) if getattr(d, field) is not None]
    return sum(vals) if vals else None


def has_flow(series: list[AudienceDay], start: date, end: date) -> bool:
    """TTMS reports 0 new / 0 outflow every day for stages it does not track
    flow on (Conversion for 14 of 15 accounts, P0 §6.3). All-zero is absent."""
    return any((d.new or 0) > 0 or (d.outflow or 0) > 0 for d in in_range(series, start, end))


def vertical_share(days: list[InsightDay]) -> float | None:
    """Period share of vertical, rebuilt exactly as TTMS does (the portal's
    `ttmsAggregateInsight`): Σ brand ÷ Σ (brand ÷ daily share)."""
    total = vertical = 0.0
    for d in days:
        if d.value is None:
            continue
        total += d.value
        if d.share and d.share > 0:
            vertical += d.value / d.share
        elif d.value != 0:
            return None
    return total / vertical if vertical > 0 else None


def vertical_total(days: list[InsightDay]) -> float | None:
    """Σ (brand ÷ daily share): the whole vertical's total over the days."""
    v = 0.0
    seen = False
    for d in days:
        if d.value and d.share and d.share > 0:
            v += d.value / d.share
            seen = True
    return v if seen else None


def bench_vertical_share(days: list[InsightDay], level: str) -> float | None:
    total = vertical = 0.0
    for d in days:
        bv, bs = d.bench_value.get(level), d.bench_share.get(level)
        if bv is None or not bs:
            continue
        total += bv
        vertical += bv / bs
    return total / vertical if vertical > 0 else None


def value_sum(days: list[InsightDay]) -> float | None:
    vals = [d.value for d in days if d.value is not None]
    return sum(vals) if vals else None


def bench_sum(days: list[InsightDay], level: str) -> float | None:
    vals = [d.bench_value.get(level) for d in days if d.bench_value.get(level) is not None]
    return sum(vals) if vals else None  # type: ignore[arg-type]


def spend_sum(frame: StrategyFrame, start: date, end: date) -> float:
    return sum(s.spend for s in frame.spend if start <= s.date <= end)


def iso_week_end_series(series: list, value) -> list[tuple[date, float]]:
    """Last stored day of each ISO week → value (the portal's audience rollup
    rule: rank and totals = last day of the bucket)."""
    out: dict[date, tuple[date, float]] = {}
    for d in series:
        v = value(d)
        if v is None:
            continue
        monday = d.date - timedelta(days=d.date.weekday())
        out[monday] = (d.date, float(v))
    return [out[k] for k in sorted(out)]


def pct(a: float | None, b: float | None) -> float | None:
    return None if a is None or b is None or b == 0 else (a - b) / abs(b)


def clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def r(v: float, n: int = 4) -> float:
    return round(float(v), n)


def brand_entity(frame: StrategyFrame) -> EntityRef:
    return EntityRef(id=f"ttms:{frame.ttms_account_id}", display_name=frame.brand_name)


def make_finding(
    frame: StrategyFrame,
    *,
    id: str,
    generator: str,
    sections: list[int],
    claim_frame: str,
    evidence: dict,
    magnitude: float,
    direction: Direction | str,
    actionability: str,
    confidence: Confidence | str,
    level: FindingLevel = FindingLevel.BRAND,
    entity: EntityRef | None = None,
    comparison: Comparison | None = None,
    caveats: list[str] | None = None,
    provenance: list[str] | None = None,
) -> Finding:
    return Finding(
        id=id,
        generator=generator,
        tenant_id=frame.tenant_id,
        brief_type="strategy",
        section_affinity=sections,
        entity=entity or brand_entity(frame),
        level=level,
        claim_frame=claim_frame,
        evidence={k: v for k, v in evidence.items() if v is not None},
        comparison=comparison,
        magnitude_pct=r(clamp01(magnitude)),
        direction=direction,
        actionability=actionability,
        confidence=confidence,
        caveats=caveats or [],
        materiality=0.0,
        provenance=provenance or [],
    )


# ─── metric_value: one evaluator for sizing (T09) and measuring (T11) ───────


def metric_value(frame: StrategyFrame, key: str, end: date | None = None, days: int | None = None) -> float | None:
    """Value of a catalog metric key over the `days` ending `end` (default: the
    report window). Stocks (totals, ranks, size ratios) read the last day;
    flows and shares aggregate over the window."""
    end = end or frame.as_of
    days = days or frame.window_days
    start = end - timedelta(days=days - 1)
    parts = key.split(".")
    if key.startswith("ttms.audience."):
        stage, what = parts[2], parts[3]
        series = frame.audience.get(stage, [])
        day = last_day(series, end)
        if what == "total":
            return day.total if day else None
        if what == "rank":
            return float(day.rank) if day and day.rank is not None else None
        if what in ("new", "outflow"):
            return flow_sum(series, start, end, what)  # type: ignore[arg-type]
        if what == "size_ratio":
            nxt = {"awareness": "consideration", "consideration": "conversion"}.get(stage)
            nd = last_day(frame.audience.get(nxt or "", []), end)
            return nd.total / day.total if day and nd and day.total and nd.total is not None else None
    if key.startswith("ttms.impressions.share."):
        ct = parts[3]
        days_all = in_range(frame.insight("impressions", "all"), start, end)
        days_ct = in_range(frame.insight("impressions", ct), start, end)
        a, c = value_sum(days_all), value_sum(days_ct)
        return c / a if a and c is not None else None
    if key == "ttms.halo_ratio":
        p = value_sum(in_range(frame.insight("impressions", "paid"), start, end))
        n = value_sum(in_range(frame.insight("impressions", "non_paid"), start, end))
        return n / p if p and n is not None else None
    if key.startswith("ttms.") and key.endswith(".share") and len(parts) == 3:
        return vertical_share(in_range(frame.insight(parts[1]), start, end))
    if key.startswith("ttms.") and len(parts) == 2:
        return value_sum(in_range(frame.insight(parts[1]), start, end))
    if key.startswith("strategy.cost_per_1k_new."):
        stage = parts[2]
        new = flow_sum(frame.audience.get(stage, []), start, end, "new")
        sp = spend_sum(frame, start, end)
        return sp / new * 1000 if new and sp > 0 else None
    return None


def bench_metric_value(frame: StrategyFrame, key: str, end: date | None = None, days: int | None = None) -> float | None:
    """The benchmark's value of the same key, where TTMS supplies one."""
    end = end or frame.as_of
    days = days or frame.window_days
    start = end - timedelta(days=days - 1)
    lv = frame.benchmark
    parts = key.split(".")
    if key.startswith("ttms.audience.") and parts[3] == "size_ratio":
        stage = parts[2]
        nxt = {"awareness": "consideration", "consideration": "conversion"}.get(stage)
        d, nd = last_day(frame.audience.get(stage, []), end), last_day(frame.audience.get(nxt or "", []), end)
        a, b = (d.bench_total.get(lv) if d else None), (nd.bench_total.get(lv) if nd else None)
        return b / a if a and b is not None else None
    if key.startswith("ttms.audience.") and parts[3] == "total":
        d = last_day(frame.audience.get(parts[2], []), end)
        return d.bench_total.get(lv) if d else None
    if key.startswith("ttms.impressions.share."):
        all_b = bench_sum(in_range(frame.insight("impressions", "all"), start, end), lv)
        ct_b = bench_sum(in_range(frame.insight("impressions", parts[3]), start, end), lv)
        return ct_b / all_b if all_b and ct_b is not None else None
    if key == "ttms.halo_ratio":
        p = bench_sum(in_range(frame.insight("impressions", "paid"), start, end), lv)
        n = bench_sum(in_range(frame.insight("impressions", "non_paid"), start, end), lv)
        return n / p if p and n is not None else None
    if key.startswith("ttms.") and key.endswith(".share") and len(parts) == 3:
        return bench_vertical_share(in_range(frame.insight(parts[1]), start, end), lv)
    if key.startswith("ttms.") and len(parts) == 2:
        return bench_sum(in_range(frame.insight(parts[1]), start, end), lv)
    return None
