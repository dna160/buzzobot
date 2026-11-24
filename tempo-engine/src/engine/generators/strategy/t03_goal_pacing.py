"""T03 — Goal pacing (Strategy Report PRD §7.3).

Weekly series of the goal's metric (last stored day of each ISO week),
Theil–Sen pace over the last 8 weeks, projection to the deadline with the
pace's interquartile range, and feasibility = required pace ÷ current pace:
≤ 1.2 on track, ≤ 4 off track, beyond that unreachable.

Rank goals are paced in **ranks per week** only. TTMS gives competitors'
ranks, not their sizes, so "people per day needed to reach #25" cannot be
computed and is never claimed (P0 §8, definitions R4).
"""

from __future__ import annotations

from datetime import date, timedelta

from engine.contracts import ClaimFrame, Direction
from engine.contracts.strategy import StrategyFrame
from engine.generators.base import GeneratorResult
from engine.generators.strategy._util import (
    iso_week_end_series,
    last_day,
    make_finding,
    r,
    vertical_share,
)
from engine.generators.strategy.base import StrategyGenerator
from engine.stats import theil_sen_slope

PACE_WEEKS = 8
MIN_WEEKS = 6
LOWER_IS_BETTER = {"rank", "cost_per_new"}


def weekly_goal_series(frame: StrategyFrame) -> list[tuple[date, float]]:
    g = frame.goal
    if g is None:
        return []
    if g.kind == "rank" and g.stage:
        return iso_week_end_series(frame.audience.get(g.stage, []), lambda d: d.rank)
    if g.kind == "size_ratio" and g.stage:
        nxt = {"awareness": "consideration", "consideration": "conversion"}[g.stage]
        nxt_series = frame.audience.get(nxt, [])

        def ratio(d):
            nd = last_day(nxt_series, d.date)
            return nd.total / d.total if nd and d.total and nd.total is not None else None

        return iso_week_end_series(frame.audience.get(g.stage, []), ratio)
    by_week: dict[date, list] = {}
    if g.kind == "share" and g.metric:
        for d in frame.insight(g.metric):
            by_week.setdefault(d.date - timedelta(days=d.date.weekday()), []).append(d)
        return [(max(x.date for x in days), v) for _, days in sorted(by_week.items()) if (v := vertical_share(days)) is not None]
    if g.kind == "cost_per_new" and g.stage:
        spend = {s.date: s.spend for s in frame.spend}
        for d in frame.audience.get(g.stage, []):
            by_week.setdefault(d.date - timedelta(days=d.date.weekday()), []).append(d)
        out = []
        for _, days in sorted(by_week.items()):
            new = sum(d.new or 0 for d in days)
            sp = sum(spend.get(d.date, 0.0) for d in days)
            if new > 0 and sp > 0:
                out.append((max(d.date for d in days), sp / new * 1000))
        return out
    return []


class T03GoalPacing(StrategyGenerator):
    id = "T03"
    name = "Goal pacing"

    def _generate(self, frame: StrategyFrame) -> GeneratorResult:
        g = frame.goal
        if g is None:
            return GeneratorResult(
                findings=[
                    make_finding(
                        frame, id="t03_no_goal", generator=self.id, sections=[105],
                        claim_frame=ClaimFrame.DATA_COVERAGE_GAP.value,
                        evidence={"signal": "goal", "reason": "no_goal"},
                        magnitude=0.05, direction=Direction.NEUTRAL, actionability="low", confidence="high",
                        caveats=["Belum ada target: tetapkan target di panel Strategy Report."],
                    )
                ]
            )
        weekly = weekly_goal_series(frame)
        if len(weekly) < MIN_WEEKS:
            return GeneratorResult(
                findings=[
                    make_finding(
                        frame, id="t03_short_history", generator=self.id, sections=[105],
                        claim_frame=ClaimFrame.DATA_COVERAGE_GAP.value,
                        evidence={"signal": "goal", "reason": "insufficient_history", "weeks": len(weekly), "weeks_needed": MIN_WEEKS},
                        magnitude=0.05, direction=Direction.NEUTRAL, actionability="low", confidence="high",
                    )
                ]
            )

        recent = weekly[-PACE_WEEKS:]
        slope = theil_sen_slope(list(range(len(recent))), [v for _, v in recent])
        current = recent[-1][1]
        weeks_left = (g.deadline - frame.as_of).days / 7
        lower_better = g.kind in LOWER_IS_BETTER
        better = (lambda a, b: a <= b) if lower_better else (lambda a, b: a >= b)
        pace, p25, p75 = slope if slope else (0.0, 0.0, 0.0)

        if better(current, g.value):
            status, feasibility, required = "on_track", 0.0, 0.0
        elif weeks_left <= 0:
            status, feasibility, required = "unreachable", None, None
        else:
            required = (g.value - current) / weeks_left
            if pace == 0 or (pace > 0) != (required > 0):
                status, feasibility = "unreachable", None
            else:
                feasibility = required / pace
                status = "on_track" if feasibility <= 1.2 else ("off_track" if feasibility <= 4 else "unreachable")

        wl = max(weeks_left, 0)
        projected = current + pace * wl
        lo_hi = sorted([current + p25 * wl, current + p75 * wl])
        if g.kind == "rank":
            projected, lo_hi = max(1.0, projected), [max(1.0, v) for v in lo_hi]
        claim = {"on_track": ClaimFrame.GOAL_ON_TRACK, "off_track": ClaimFrame.GOAL_OFF_TRACK}.get(status, ClaimFrame.GOAL_UNREACHABLE)
        nd = 0 if g.kind in ("rank", "cost_per_new") else 4
        return GeneratorResult(
            findings=[
                make_finding(
                    frame, id="t03_goal", generator=self.id, sections=[105],
                    claim_frame=claim.value,
                    evidence={
                        "goal_kind": g.kind,
                        "goal_stage": g.stage,
                        "goal_metric": g.metric,
                        "target": g.value,
                        "deadline": g.deadline.isoformat(),
                        "current": r(current, nd),
                        "projected": r(projected, nd),
                        "projected_low": r(lo_hi[0], nd),
                        "projected_high": r(lo_hi[1], nd),
                        "pace_per_week": r(pace, 4),
                        "required_per_week": r(required, 4) if required is not None else None,
                        "feasibility": r(feasibility, 2) if feasibility is not None else None,
                        "weeks_left": r(weeks_left, 1),
                        "status": status,
                    },
                    magnitude={"on_track": 0.1, "off_track": 0.45, "unreachable": 0.6}[status],
                    direction=Direction.POSITIVE if status == "on_track" else Direction.NEGATIVE,
                    actionability="medium" if status != "on_track" else "low",
                    confidence="medium" if len(recent) >= PACE_WEEKS else "low",
                    caveats=["Proyeksi dari laju 8 minggu terakhir; rentang menunjukkan kuartil laju mingguan."],
                )
            ]
        )
