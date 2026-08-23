"""M01 — Live Session Efficiency. PRD §6.3: "ROI, orders/minute,
viewers->orders, duration bucket contrast."

Honest scope note: neither the Sovella fixture nor live Tempo data (no
session-duration field exists anywhere in `paid_hourly_metrics`) carries
session duration, so "orders/minute" and "duration bucket contrast" are not
computable. This generator computes what the data actually supports:
ROI-ranked sessions, and views->orders efficiency (orders per 1,000 views) as
the closest real proxy for "viewers->orders." A duration-aware version is a
v1.1 extension once Tempo (or TikTok's own API) exposes session length, not
approximated here.
"""

from __future__ import annotations

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityLevel, EntityRef, Finding, FindingLevel
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import records_by_level
from engine.stats import median

MIN_SESSIONS = 3


class M01LiveSessionEfficiency(Generator):
    id = "M01"
    name = "Live Session Efficiency"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        sessions = records_by_level(ctx.metric_frame, EntityLevel.SESSION, "current")
        scoreable = [r for r in sessions if "roi" in r.metrics]
        if len(scoreable) < MIN_SESSIONS:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason=f"fewer than {MIN_SESSIONS} session-level records with roi", missing_metrics=["roi"]))

        rois = [r.metrics["roi"] for r in scoreable]
        med = median(rois)
        best = max(scoreable, key=lambda r: r.metrics["roi"])
        worst = min(scoreable, key=lambda r: r.metrics["roi"])

        findings = [self._leaderboard_finding(ctx, best, med, ClaimFrame.SESSION_EFFICIENCY_LEADER, Direction.POSITIVE)]
        if worst.entity.id != best.entity.id:
            findings.append(self._leaderboard_finding(ctx, worst, med, ClaimFrame.SESSION_EFFICIENCY_LAGGARD, Direction.NEGATIVE))

        return GeneratorResult(findings=findings)

    def _leaderboard_finding(self, ctx: GeneratorContext, record, cohort_median: float, claim: ClaimFrame, direction: Direction) -> Finding:  # noqa: ANN001
        frame = ctx.metric_frame
        views_efficiency = (
            (record.metrics.get("orders", 0.0) / record.metrics["views"] * 1000) if record.metrics.get("views") else None
        )
        evidence: dict[str, float | int | str] = {"roi": record.metrics["roi"], "cohort_median_roi": cohort_median}
        if views_efficiency is not None:
            evidence["orders_per_1000_views"] = round(views_efficiency, 2)

        return Finding(
            id=f"m01_{claim.value}_{record.entity.id}",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[3],
            entity=EntityRef(id=record.entity.id, display_name=record.entity.display_name),
            level=FindingLevel.SESSION,
            claim_frame=claim.value,
            evidence=evidence,
            comparison=Comparison(
                basis=ComparisonBasis.COHORT_MEDIAN,
                baseline_value=cohort_median,
                current_value=record.metrics["roi"],
                delta_abs=record.metrics["roi"] - cohort_median,
                delta_pct=(record.metrics["roi"] - cohort_median) / cohort_median if cohort_median else None,
            ),
            magnitude_pct=0.05,  # one session's share of account activity is small by construction
            direction=direction,
            actionability="high",
            confidence=Confidence.MEDIUM,
            caveats=["session duration is not available in the source data — this ranks ROI and views->orders efficiency only"],
            materiality=0.0,
            provenance=[f"session:{record.entity.id}:current"],
        )
