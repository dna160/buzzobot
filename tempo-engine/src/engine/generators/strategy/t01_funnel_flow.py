"""T01 — Funnel stage flow (Strategy Report PRD §7.3, with P0 §6.2–6.3).

Compares each stage's **size ratio** with the benchmark's: Consideration ÷
Awareness and Conversion ÷ Consideration on the as-of day. These are ratios of
rolling-window stocks, not the share of people who move on — TTMS has no
transition data — so a ratio above 1 (BDL's Conversion is 12.5× its
Consideration) is skipped rather than read as a 1,250% "move-on rate".

Also reports where outflow cancels most of a stage's new audience over the
window (`STAGE_INFLOW_OFFSET`), only for stages TTMS reports flow on.
"""

from __future__ import annotations

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Direction
from engine.contracts.strategy import StrategyFrame
from engine.generators.base import GeneratorResult
from engine.generators.strategy._util import flow_sum, has_flow, last_day, make_finding, r
from engine.generators.strategy.base import StrategyGenerator, history_confidence

LEAK_RATIO = 0.7  # brand ratio below 70% of the benchmark's
OFFSET_RATIO = 0.8  # outflow ≥ 80% of new over the window

PAIRS = (("awareness", "consideration"), ("consideration", "conversion"))


class T01FunnelFlow(StrategyGenerator):
    id = "T01"
    name = "Funnel stage flow"

    def _generate(self, frame: StrategyFrame) -> GeneratorResult:
        lv = frame.benchmark
        conf = history_confidence(frame)
        findings = []
        for stage, nxt in PAIRS:
            d = last_day(frame.audience.get(stage, []), frame.as_of)
            nd = last_day(frame.audience.get(nxt, []), frame.as_of)
            if not d or not nd or not d.total or nd.total is None:
                continue
            ratio = nd.total / d.total
            bt, bnt = d.bench_total.get(lv), nd.bench_total.get(lv)
            bench = bnt / bt if bt and bnt is not None else None
            if bench is None or ratio > 1 or bench > 1:
                # Not comparable as a funnel step: the stages use different
                # windows (P0 §6.2). T10 reports the skip.
                continue
            leak = ratio < LEAK_RATIO * bench
            findings.append(
                make_finding(
                    frame,
                    id=f"t01_{'leak' if leak else 'ok'}_{stage}",
                    generator=self.id,
                    sections=[103, 106] if stage == "consideration" else [103],
                    claim_frame=(ClaimFrame.STAGE_LEAK if leak else ClaimFrame.STAGE_HEALTHY).value,
                    evidence={
                        "stage": stage,
                        "next_stage": nxt,
                        "size_ratio": r(ratio),
                        "bench_size_ratio": r(bench),
                        "gap_pt": r((ratio - bench) * 100, 2),
                        "stage_total": d.total,
                        "next_total": nd.total,
                        "bench_stage_total": r(bt, 0),
                        "bench_next_total": r(bnt, 0),
                        "rank": nd.rank,
                        "rank_n": nd.rank_n,
                    },
                    comparison=Comparison(
                        basis=ComparisonBasis.COHORT_MEDIAN, baseline_value=r(bench), current_value=r(ratio),
                        delta_abs=r(ratio - bench), delta_pct=r((ratio - bench) / bench) if bench else None,
                        label=f"rata-rata {lv.replace('top', 'Top ')}",
                    ),
                    magnitude=(bench - ratio) / bench if leak else 0.1,
                    direction=Direction.NEGATIVE if leak else (Direction.POSITIVE if ratio >= bench else Direction.NEUTRAL),
                    actionability="high" if leak else "low",
                    confidence=conf,
                    caveats=["Rasio ukuran dua tahap pada hari yang sama, bukan persentase orang yang berpindah tahap."],
                    provenance=[f"market_scope_audience_daily:{stage}:{frame.as_of}", f"market_scope_audience_daily:{nxt}:{frame.as_of}"],
                )
            )

        for stage in ("awareness", "consideration", "conversion"):
            series = frame.audience.get(stage, [])
            if not has_flow(series, frame.current_start, frame.as_of):
                continue
            new = flow_sum(series, frame.current_start, frame.as_of, "new")
            out = flow_sum(series, frame.current_start, frame.as_of, "outflow")
            if not new or out is None or out < OFFSET_RATIO * new:
                continue
            findings.append(
                make_finding(
                    frame,
                    id=f"t01_offset_{stage}",
                    generator=self.id,
                    sections=[103],
                    claim_frame=ClaimFrame.STAGE_INFLOW_OFFSET.value,
                    evidence={
                        "stage": stage,
                        "new_total": new,
                        "outflow_total": out,
                        "offset_ratio": r(out / new),
                        "net_change": new - out,
                        "window_days": frame.window_days,
                    },
                    magnitude=out / new - 0.5,
                    direction=Direction.NEGATIVE,
                    actionability="medium",
                    confidence=conf,
                    provenance=[f"market_scope_audience_daily:{stage}:{frame.current_start}..{frame.as_of}"],
                )
            )

        if not findings:
            return self.gap("no comparable stage pair (size ratio > 1 or no benchmark) and no stage with flow")
        return GeneratorResult(findings=findings)
