"""A02 — Retention Curve (Hook vs. Hold). PRD §6.3: "retention curve (hook
vs hold)."

Tempo's schema names this pair explicitly — `video_watched_6s` ("the
headline quality metric for a view-objective FMCG brand", per its own
column comment) is the hook, `engaged_view_15s` is the hold. Both are
already derived as `vtr6s`/`vtr15s` (fraction of impressions) by
`tempo_read.py`. This generator is the one place they're compared to each
other rather than to a cohort of other entities: `retention_ratio =
vtr15s / vtr6s` is the fraction of people who were hooked at 6s and were
still watching at 15s — a genuine creative-diagnosis signal (steep drop-off
= strong opener, weak body; high retention = the content holds attention
once it has it), not a proxy for anything unavailable in the data.
"""

from __future__ import annotations

from collections import defaultdict

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityRef, Finding, MetricRecord
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import finding_level_of, non_account_records
from engine.stats import median

MIN_COHORT_SIZE = 3
MIN_VTR6S_FLOOR = 0.01  # entities with near-zero hook rate make the ratio noise, not signal


class A02RetentionCurve(Generator):
    id = "A02"
    name = "Retention Curve (Hook vs. Hold)"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        records = non_account_records(ctx.metric_frame, "current")
        cohorts: dict[str, list[MetricRecord]] = defaultdict(list)
        for r in records:
            if r.metrics.get("vtr6s", 0.0) >= MIN_VTR6S_FLOOR and "vtr15s" in r.metrics:
                cohorts[r.entity.level.value].append(r)

        findings: list[Finding] = []
        for cohort in cohorts.values():
            findings.extend(self._score_cohort(ctx, cohort))

        if not findings:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no cohort had >=3 entities with both vtr6s (above floor) and vtr15s", missing_metrics=["vtr6s", "vtr15s"]))
        return GeneratorResult(findings=findings)

    def _score_cohort(self, ctx: GeneratorContext, cohort: list[MetricRecord]) -> list[Finding]:
        if len(cohort) < MIN_COHORT_SIZE:
            return []
        ratios = {r.entity.id: r.metrics["vtr15s"] / r.metrics["vtr6s"] for r in cohort}
        cohort_median = median(list(ratios.values()))
        best_id = max(ratios, key=lambda k: ratios[k])
        worst_id = min(ratios, key=lambda k: ratios[k])
        by_id = {r.entity.id: r for r in cohort}

        findings = [self._finding(ctx, by_id[worst_id], ratios[worst_id], cohort_median, ClaimFrame.RETENTION_HOOK_WITHOUT_HOLD, Direction.NEGATIVE)]
        if best_id != worst_id:
            findings.append(self._finding(ctx, by_id[best_id], ratios[best_id], cohort_median, ClaimFrame.RETENTION_STRONG_HOLD, Direction.POSITIVE))
        return findings

    def _finding(self, ctx: GeneratorContext, record: MetricRecord, ratio: float, cohort_median: float, claim: ClaimFrame, direction: Direction) -> Finding:
        frame = ctx.metric_frame
        evidence = {
            "vtr6s": round(record.metrics["vtr6s"], 4),
            "vtr15s": round(record.metrics["vtr15s"], 4),
            "retention_ratio": round(ratio, 4),
            "cohort_median_retention_ratio": round(cohort_median, 4),
        }
        return Finding(
            id=f"a02_{claim.value}_{record.entity.id}",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[3, 5],
            entity=EntityRef(id=record.entity.id, display_name=record.entity.display_name),
            level=finding_level_of(record.entity.level),
            claim_frame=claim.value,
            evidence=evidence,
            comparison=Comparison(
                basis=ComparisonBasis.COHORT_MEDIAN,
                baseline_value=cohort_median,
                current_value=ratio,
                delta_abs=ratio - cohort_median,
                delta_pct=(ratio - cohort_median) / cohort_median if cohort_median else None,
            ),
            magnitude_pct=0.05,
            direction=direction,
            actionability="high",
            confidence=Confidence.MEDIUM,
            materiality=0.0,
            provenance=[f"{record.entity.level.value}:{record.entity.id}:current"],
        )
