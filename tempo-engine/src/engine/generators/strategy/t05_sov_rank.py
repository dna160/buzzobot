"""T05 — Share of voice & rank (Strategy Report PRD §7.3, P0 §2, §6.5).

Vertical share per metric this window vs the previous one, rebuilt exactly as
TTMS does (Σ brand ÷ Σ brand/share). Category growth uses the exact vertical
total (Σ brand/share), not the PRD's `bench_value × total_brand_count` proxy,
which mixes a Top-N *average* with a count from another source.

Per-metric rank is not stored upstream (P0 §2), so `RANK_MOVED` reports the
audience-stage ranks from the ranking list instead.
"""

from __future__ import annotations

from datetime import timedelta

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Direction
from engine.contracts.strategy import StrategyFrame
from engine.generators.base import GeneratorResult
from engine.generators.strategy._util import (
    bench_vertical_share,
    in_range,
    last_day,
    make_finding,
    pct,
    r,
    value_sum,
    vertical_share,
    vertical_total,
)
from engine.generators.strategy.base import StrategyGenerator, history_confidence

METRICS = ("impressions", "engagements", "video_views_6s", "search_volume", "product_card_clicks")
SHIFT = 0.2  # share moved ≥ 20% relative between windows
GROWTH_GAP = 0.10  # brand vs category growth differ by ≥ 10 points
RANK_MOVE = 2


class T05SovRank(StrategyGenerator):
    id = "T05"
    name = "Share of voice & rank"

    def _generate(self, frame: StrategyFrame) -> GeneratorResult:
        conf = history_confidence(frame)
        findings = []
        for m in METRICS:
            if m.upper() in frame.unavailable_metrics:
                continue
            cur = in_range(frame.insight(m), frame.current_start, frame.as_of)
            pri = in_range(frame.insight(m), frame.prior_start, frame.prior_end)
            s_now, s_pri = vertical_share(cur), vertical_share(pri)
            if s_now is None or s_pri is None or s_pri == 0:
                continue
            change = (s_now - s_pri) / s_pri
            b_now = bench_vertical_share(cur, frame.benchmark)
            brand_g = pct(value_sum(cur), value_sum(pri))
            cat_g = pct(vertical_total(cur), vertical_total(pri))
            evidence = {
                "metric": m,
                "share_now": r(s_now, 6),
                "share_prior": r(s_pri, 6),
                "share_change_rel": r(change),
                "bench_share": r(b_now, 6) if b_now is not None else None,
                "brand_growth": r(brand_g) if brand_g is not None else None,
                "category_growth": r(cat_g) if cat_g is not None else None,
            }
            sections = [106] if m == "product_card_clicks" else [106, 108]
            # Product-card clicks always report — they are the shop class's T6
            # anchor (PRD §5.3) — the rest only when they moved.
            if abs(change) >= SHIFT or m == "product_card_clicks":
                gaining = change >= 0
                stable = abs(change) < 0.05
                findings.append(
                    make_finding(
                        frame, id=f"t05_sov_{m}", generator=self.id, sections=sections,
                        claim_frame=(ClaimFrame.SOV_STABLE if stable else ClaimFrame.SOV_GAINING if gaining else ClaimFrame.SOV_LOSING).value,
                        evidence=evidence,
                        comparison=Comparison(
                            basis=ComparisonBasis.PRIOR_PERIOD, baseline_value=r(s_pri, 6), current_value=r(s_now, 6),
                            delta_abs=r(s_now - s_pri, 6), delta_pct=r(change), label="periode sebelumnya",
                        ),
                        magnitude=min(1.0, abs(change) / 2),
                        direction=Direction.NEUTRAL if stable else Direction.POSITIVE if gaining else Direction.NEGATIVE,
                        actionability="medium" if not gaining else "low",
                        confidence=conf,
                    )
                )
            if m in ("impressions", "engagements") and brand_g is not None and cat_g is not None:
                gap = brand_g - cat_g
                if abs(gap) >= GROWTH_GAP:
                    faster = gap > 0
                    findings.append(
                        make_finding(
                            frame, id=f"t05_growth_{m}", generator=self.id, sections=[106, 108],
                            claim_frame=(ClaimFrame.GROWING_FASTER_THAN_CATEGORY if faster else ClaimFrame.GROWING_SLOWER_THAN_CATEGORY).value,
                            evidence=evidence,
                            magnitude=min(1.0, abs(gap) / 2),
                            direction=Direction.POSITIVE if faster else Direction.NEGATIVE,
                            actionability="low" if faster else "medium",
                            confidence=conf,
                        )
                    )

        for stage in ("acc", "awareness", "consideration", "conversion"):
            series = frame.audience.get(stage, [])
            now, before = last_day(series, frame.as_of), last_day(series, frame.as_of - timedelta(days=7))
            if not now or not before or now.rank is None or before.rank is None:
                continue
            moved = before.rank - now.rank  # positive = climbed
            if abs(moved) < RANK_MOVE:
                continue
            findings.append(
                make_finding(
                    frame, id=f"t05_rank_{stage}", generator=self.id, sections=[106, 108],
                    claim_frame=ClaimFrame.RANK_MOVED.value,
                    evidence={"stage": stage, "rank_now": now.rank, "rank_7d": before.rank, "rank_change": moved, "rank_n": now.rank_n},
                    magnitude=min(1.0, abs(moved) / 10),
                    direction=Direction.POSITIVE if moved > 0 else Direction.NEGATIVE,
                    actionability="low", confidence=conf,
                )
            )
        if not findings:
            return self.gap("no share or rank movement above threshold, or no share data")
        return GeneratorResult(findings=findings)
