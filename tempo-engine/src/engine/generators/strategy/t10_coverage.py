"""T10 — Coverage & plan audit (Strategy Report PRD §7.3). Always runs.

Plan, history depth, spend join coverage, benchmark levels present, stages
with daily flow, locked metrics — the facts that set every other finding's
confidence ceiling and that Lampiran A prints as-is.
"""

from __future__ import annotations

from engine.contracts import ClaimFrame, Direction
from engine.contracts.strategy import StrategyFrame
from engine.generators.base import GeneratorResult
from engine.generators.strategy._util import has_flow, make_finding, r
from engine.generators.strategy.base import StrategyGenerator, history_confidence


def confidence_tier(frame: StrategyFrame) -> str:
    return history_confidence(frame)


class T10Coverage(StrategyGenerator):
    id = "T10"
    name = "Coverage & plan audit"

    def _generate(self, frame: StrategyFrame) -> GeneratorResult:
        aw = frame.audience.get("awareness", [])
        spend_days = sum(1 for s in frame.spend if frame.current_start <= s.date <= frame.as_of and s.spend > 0)
        levels = [lv for lv in ("top5", "top10", "top25", "top50") if any(d.bench_total.get(lv) for d in aw)]
        flow = [s for s in ("acc", "awareness", "consideration", "conversion") if has_flow(frame.audience.get(s, []), frame.current_start, frame.as_of)]
        tier = confidence_tier(frame)
        return GeneratorResult(
            findings=[
                make_finding(
                    frame, id="t10_coverage", generator=self.id, sections=[110],
                    claim_frame=ClaimFrame.DATA_COVERAGE_GAP.value,
                    evidence={
                        "plan": "lite" if frame.is_lite else "full",
                        "history_days": len(aw),
                        "spend_days_in_window": spend_days,
                        "window_days": frame.window_days,
                        "spend_coverage_pct": r(spend_days / frame.window_days * 100, 1),
                        "benchmark_levels": ",".join(levels) or "none",
                        "stages_with_flow": ",".join(flow) or "none",
                        "locked_metrics": ",".join(frame.unavailable_metrics) or "none",
                        "confidence_tier": tier,
                        "as_of": frame.as_of.isoformat(),
                    },
                    magnitude=0.05, direction=Direction.NEUTRAL, actionability="low", confidence="high",
                )
            ]
        )
