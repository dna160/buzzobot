"""T07 — Search & sentiment (Strategy Report PRD §7.3). Full TTMS plan only.

On Lite (every linked account today, P0 §3) TikTok refuses SEARCH_VOLUME and
NSR, so this emits one locked row per signal (`locked_reason = plan_lite`)
that the report renders as a lock, never as a number. When the data exists:
a 7-day search-share drop (robust z ≤ −2 over 28 days) and a negative
sentiment spike (comments z ≥ 2 while NSR fell ≥ 0.05).
"""

from __future__ import annotations

from datetime import timedelta

from engine.contracts import ClaimFrame, Direction
from engine.contracts.strategy import StrategyFrame
from engine.generators.base import GeneratorResult
from engine.generators.strategy._util import in_range, make_finding, r, value_sum, vertical_share
from engine.generators.strategy.base import StrategyGenerator
from engine.stats import robust_z_scores

SIGNALS = (("search_volume", "SEARCH_VOLUME"), ("nsr", "NSR"))


class T07SearchSentiment(StrategyGenerator):
    id = "T07"
    name = "Search & sentiment"

    def _generate(self, frame: StrategyFrame) -> GeneratorResult:
        findings = []
        for metric, api_name in SIGNALS:
            rows = frame.insight(metric)
            if api_name in frame.unavailable_metrics or not any(d.value is not None for d in rows):
                findings.append(
                    make_finding(
                        frame, id=f"t07_locked_{metric}", generator=self.id, sections=[108],
                        claim_frame=ClaimFrame.DATA_COVERAGE_GAP.value,
                        evidence={"signal": metric, "locked_reason": "plan_lite" if frame.is_lite else "no_data"},
                        magnitude=0.05, direction=Direction.NEUTRAL, actionability="low", confidence="high",
                    )
                )
                continue
            if metric == "search_volume":
                # Daily share series over 28 days; flag the latest 7-day mean.
                days = in_range(rows, frame.as_of - timedelta(days=27), frame.as_of)
                shares = [vertical_share([d]) for d in days]
                vals = [s for s in shares if s is not None]
                if len(vals) >= 14:
                    z = robust_z_scores(vals)
                    recent = sum(z[-7:]) / 7
                    if recent <= -2:
                        findings.append(
                            make_finding(
                                frame, id="t07_search_drop", generator=self.id, sections=[108],
                                claim_frame=ClaimFrame.SEARCH_SHARE_DROP.value,
                                evidence={"search_share_7d": r(sum(vals[-7:]) / 7, 6), "search_share_28d": r(sum(vals) / len(vals), 6), "robust_z": r(recent, 2)},
                                magnitude=min(1.0, abs(recent) / 6), direction=Direction.NEGATIVE,
                                actionability="medium", confidence="medium",
                                caveats=["Volume pencarian biasanya bergerak 1–2 minggu sebelum konversi."],
                            )
                        )
            else:
                comments = in_range(frame.insight("comments"), frame.as_of - timedelta(days=27), frame.as_of)
                nsr_now = value_sum(in_range(rows, frame.as_of - timedelta(days=6), frame.as_of))
                nsr_before = value_sum(in_range(rows, frame.as_of - timedelta(days=13), frame.as_of - timedelta(days=7)))
                cvals = [d.value for d in comments if d.value is not None]
                if len(cvals) >= 14 and nsr_now is not None and nsr_before is not None:
                    z = robust_z_scores(cvals)[-1]
                    d_nsr = (nsr_now - nsr_before) / 7
                    if z >= 2 and d_nsr <= -0.05:
                        findings.append(
                            make_finding(
                                frame, id="t07_sentiment", generator=self.id, sections=[108],
                                claim_frame=ClaimFrame.SENTIMENT_SPIKE_NEGATIVE.value,
                                evidence={"comments_z": r(z, 2), "nsr_change": r(d_nsr, 3)},
                                magnitude=min(1.0, z / 6), direction=Direction.NEGATIVE,
                                actionability="high", confidence="medium",
                            )
                        )
        return GeneratorResult(findings=findings)
