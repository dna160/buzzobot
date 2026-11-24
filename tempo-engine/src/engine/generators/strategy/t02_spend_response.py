"""T02 — Spend → new-audience response (Strategy Report PRD §7.3).

Daily spend against new Consideration audience `LAG_DAYS` later, fitted with
`y = a(1 − e^{−s/b})`. The knee is where marginal response halves.

Two choices differ from the PRD sketch, both from P0:
- **The lag is fixed** (2 days) rather than picked per run as the best of
  {2, 3, 4}: choosing the best of three on every report inflates the fit it
  then reports (`strategy_definitions.md` S3). On BARDI no lag 0–7 reaches
  R² 0.4 anyway.
- **The response stage is Consideration for both classes**, falling back to
  Awareness: Conversion-stage flow is 0 for 14 of 15 accounts (P0 §6.3).

Correlation, never causation — every finding says so, and confidence is never
above medium. `SpendResponse` is shared with the chart builder so the report
draws exactly the points the finding was computed from.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta

from engine.contracts import ClaimFrame, Direction
from engine.contracts.strategy import StrategyFrame
from engine.generators.base import GeneratorResult
from engine.generators.strategy._util import flow_sum, has_flow, make_finding, r, spend_sum
from engine.generators.strategy.base import StrategyGenerator
from engine.stats import SaturatingFit, fit_saturating, spearman_rho

LAG_DAYS = 2
SAMPLE_DAYS = 56
MIN_PAIRS = 21
MIN_SPEND_DAYS = 15
UNRELATED_R2 = 0.3

CAVEATS = [
    "Korelasi, bukan sebab-akibat: belanja dan audiens baru bergerak bersama, tetapi data ini tidak membuktikan belanja penyebabnya.",
    "Hari TTMS memakai UTC, hari iklan memakai waktu lokal akun (WIB); keduanya dicocokkan per tanggal.",
]


@dataclass
class SpendResponse:
    stage: str
    points: list[tuple[float, float]] = field(default_factory=list)
    fit: SaturatingFit | None = None
    rho: float | None = None
    spend_days: int = 0


def spend_response(frame: StrategyFrame) -> SpendResponse | None:
    since = frame.as_of - timedelta(days=SAMPLE_DAYS - 1)
    stage = next(
        (s for s in ("consideration", "awareness") if has_flow(frame.audience.get(s, []), since, frame.as_of)),
        None,
    )
    if stage is None:
        return None
    new_by_day = {d.date: d.new for d in frame.audience[stage] if d.new is not None}
    points = []
    for s in frame.spend:
        if s.spend <= 0 or s.date < since - timedelta(days=LAG_DAYS):
            continue
        y = new_by_day.get(s.date + timedelta(days=LAG_DAYS))
        if y is not None and s.date + timedelta(days=LAG_DAYS) <= frame.as_of:
            points.append((s.spend, y))
    sr = SpendResponse(stage=stage, points=points, spend_days=sum(1 for s in frame.spend if s.spend > 0 and s.date >= since))
    if len(points) >= 5:
        sr.fit = fit_saturating([p[0] for p in points], [p[1] for p in points])
        sr.rho = spearman_rho([p[0] for p in points], [p[1] for p in points])
    return sr


class T02SpendResponse(StrategyGenerator):
    id = "T02"
    name = "Spend → stage response"

    def _generate(self, frame: StrategyFrame) -> GeneratorResult:
        window_spend = spend_sum(frame, frame.current_start, frame.as_of)
        if window_spend <= 0:
            return self.gap("no ad spend in the report window", ["spend"])
        sr = spend_response(frame)
        if sr is None:
            return self.gap("no stage with daily new/outflow to respond to spend", ["ttms.audience.*.new"])
        if len(sr.points) < MIN_PAIRS or sr.spend_days < MIN_SPEND_DAYS or sr.fit is None:
            return self.gap(f"needs ≥ {MIN_PAIRS} paired days and ≥ {MIN_SPEND_DAYS} spend days; has {len(sr.points)} and {sr.spend_days}")

        fit = sr.fit
        new = flow_sum(frame.audience[sr.stage], frame.current_start, frame.as_of, "new") or 0
        cost_per_1k = window_spend / new * 1000 if new > 0 else None
        spends = [p[0] for p in sr.points]
        lo, hi = min(spends), max(spends)
        knee = fit.knee
        if fit.r2 < UNRELATED_R2:
            claim, magnitude = ClaimFrame.SPEND_RESPONSE_UNRELATED, 0.15
        elif lo <= knee <= hi:
            claim = ClaimFrame.SPEND_RESPONSE_DIMINISHING
            magnitude = sum(max(0.0, s - knee) for s in spends) / sum(spends)
        else:
            claim, magnitude = ClaimFrame.SPEND_RESPONSE_LINEAR, 0.2

        evidence: dict = {
            "stage": sr.stage,
            "lag_days": LAG_DAYS,
            "r2": r(fit.r2, 2),
            "n_days": len(sr.points),
            "spearman_rho": r(sr.rho, 2) if sr.rho is not None else None,
            "window_spend": round(window_spend),
            "window_new": new,
            "cost_per_1k_new": round(cost_per_1k) if cost_per_1k else None,
            "spend_min_day": round(lo),
            "spend_max_day": round(hi),
        }
        if claim == ClaimFrame.SPEND_RESPONSE_DIMINISHING:
            below = [(s, y) for s, y in sr.points if s <= knee]
            above = [(s, y) for s, y in sr.points if s > knee]
            cost = lambda pts: sum(p[0] for p in pts) / sum(p[1] for p in pts) * 1000 if pts and sum(p[1] for p in pts) > 0 else None  # noqa: E731
            window_days_above = [s for s in frame.spend if frame.current_start <= s.date <= frame.as_of and s.spend > knee]
            evidence.update(
                {
                    "knee_daily_spend": round(knee),
                    "cost_per_1k_below_knee": round(cost(below)) if cost(below) else None,
                    "cost_per_1k_above_knee": round(cost(above)) if cost(above) else None,
                    "days_above_knee": len(window_days_above),
                    "spend_above_knee_window": round(sum(s.spend - knee for s in window_days_above)),
                }
            )
        return GeneratorResult(
            findings=[
                make_finding(
                    frame,
                    id="t02_spend_response",
                    generator=self.id,
                    sections=[104],
                    claim_frame=claim.value,
                    evidence=evidence,
                    magnitude=magnitude,
                    direction=Direction.NEGATIVE if claim == ClaimFrame.SPEND_RESPONSE_DIMINISHING else Direction.NEUTRAL,
                    actionability="high" if claim == ClaimFrame.SPEND_RESPONSE_DIMINISHING and fit.r2 >= 0.5 else "low",
                    confidence="medium" if fit.r2 >= 0.5 else "low",
                    caveats=CAVEATS,
                    provenance=[f"paid_hourly_metrics:spend:{frame.as_of - timedelta(days=SAMPLE_DAYS - 1)}..{frame.as_of}"],
                )
            ]
        )
