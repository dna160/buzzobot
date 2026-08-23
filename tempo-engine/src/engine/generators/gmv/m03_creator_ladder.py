"""M03 — Creator / Affiliate Ladder. PRD §6.3: "GMV and ROI per creator,
ranked, with volume-adjusted confidence."

Honest scope note: Tempo's schema has no creator/affiliate table at all
(confirmed in tempo-engine's B0 contradiction report — this is the same gap
underlying the Shop-DTO finding). This generator is implemented against
`EntityLevel.CREATOR` records so it works the moment that data exists
upstream, but will report a coverage gap on every real run until it does —
including on the Sovella fixture, which likewise has no creator-level rows
(the report's own §6 names creators only in a data-gap callout: "Ketiadaan
data identitas kreator... creator_highlight null").
"""

from __future__ import annotations

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityLevel, EntityRef, Finding, FindingLevel
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import records_by_level
from engine.stats import median

MIN_CREATORS = 3
MIN_VOLUME_FOR_HIGH_CONFIDENCE = 6


class M03CreatorLadder(Generator):
    id = "M03"
    name = "Creator / Affiliate Ladder"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        creators = records_by_level(ctx.metric_frame, EntityLevel.CREATOR, "current")
        scoreable = [r for r in creators if "gmv" in r.metrics and "roi" in r.metrics]
        if len(scoreable) < MIN_CREATORS:
            return GeneratorResult(
                coverage_gap=CoverageGap(generator=self.id, reason=f"fewer than {MIN_CREATORS} creator-level records with gmv and roi", missing_metrics=["gmv", "roi"])
            )

        rois = [r.metrics["roi"] for r in scoreable]
        med = median(rois)
        best = max(scoreable, key=lambda r: r.metrics["roi"])
        worst = min(scoreable, key=lambda r: r.metrics["roi"])

        findings = [self._rung(ctx, best, med, ClaimFrame.CREATOR_LADDER_LEADER, Direction.POSITIVE)]
        if worst.entity.id != best.entity.id:
            findings.append(self._rung(ctx, worst, med, ClaimFrame.CREATOR_LADDER_LAGGARD, Direction.NEGATIVE))
        return GeneratorResult(findings=findings)

    def _rung(self, ctx: GeneratorContext, record, cohort_median: float, claim: ClaimFrame, direction: Direction) -> Finding:  # noqa: ANN001
        frame = ctx.metric_frame
        orders = record.metrics.get("orders", 0.0)
        return Finding(
            id=f"m03_{claim.value}_{record.entity.id}",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[5],
            entity=EntityRef(id=record.entity.id, display_name=record.entity.display_name),
            level=FindingLevel.CREATOR,
            claim_frame=claim.value,
            evidence={"gmv": record.metrics["gmv"], "roi": record.metrics["roi"], "cohort_median_roi": cohort_median},
            comparison=Comparison(
                basis=ComparisonBasis.COHORT_MEDIAN,
                baseline_value=cohort_median,
                current_value=record.metrics["roi"],
                delta_abs=record.metrics["roi"] - cohort_median,
                delta_pct=(record.metrics["roi"] - cohort_median) / cohort_median if cohort_median else None,
            ),
            magnitude_pct=0.05,
            direction=direction,
            actionability="medium",
            confidence=Confidence.HIGH if orders >= MIN_VOLUME_FOR_HIGH_CONFIDENCE else Confidence.LOW,
            caveats=([] if orders >= MIN_VOLUME_FOR_HIGH_CONFIDENCE else [f"only {orders:.0f} orders behind this creator's ROI — volume-adjusted confidence is low"]),
            materiality=0.0,
            provenance=[f"creator:{record.entity.id}:current"],
        )
