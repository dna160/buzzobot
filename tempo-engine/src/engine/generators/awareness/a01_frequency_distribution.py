"""A01 — Frequency Distribution & Effective Reach. PRD §6.3 names this
"frequency distribution & effective reach." G04 already owns the hard
waste rule ("frequency above cap" — see `AWARENESS_OBJECTIVE_CONTRACT.
waste_definition`); A01's distinct job is the leaderboard: which entity is
most over-exposed (high repeat frequency) vs. most under-saturated (room to
raise frequency), evidenced alongside `qualified_reach` so a reader can see
whether the extra repetition is actually buying more effectively-reached
audience or just spend.
"""

from __future__ import annotations

from collections import defaultdict

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityRef, Finding, MetricRecord
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import finding_level_of, non_account_records
from engine.stats import median

MIN_COHORT_SIZE = 3


class A01FrequencyDistribution(Generator):
    id = "A01"
    name = "Frequency Distribution & Effective Reach"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        records = non_account_records(ctx.metric_frame, "current")
        cohorts: dict[str, list[MetricRecord]] = defaultdict(list)
        for r in records:
            if "frequency" in r.metrics:
                cohorts[r.entity.level.value].append(r)

        findings: list[Finding] = []
        for cohort in cohorts.values():
            findings.extend(self._score_cohort(ctx, cohort))

        if not findings:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no cohort had >=3 entities with a computable frequency", missing_metrics=["frequency"]))
        return GeneratorResult(findings=findings)

    def _score_cohort(self, ctx: GeneratorContext, cohort: list[MetricRecord]) -> list[Finding]:
        if len(cohort) < MIN_COHORT_SIZE:
            return []
        frequencies = [r.metrics["frequency"] for r in cohort]
        cohort_median = median(frequencies)
        highest = max(cohort, key=lambda r: r.metrics["frequency"])
        lowest = min(cohort, key=lambda r: r.metrics["frequency"])

        total_cost = sum(r.metrics.get("cost", 0.0) for r in cohort)
        findings = [self._finding(ctx, highest, cohort_median, total_cost, ClaimFrame.FREQUENCY_OVER_EXPOSED, Direction.NEGATIVE)]
        if lowest.entity.id != highest.entity.id:
            findings.append(self._finding(ctx, lowest, cohort_median, total_cost, ClaimFrame.FREQUENCY_UNDER_SATURATED, Direction.POSITIVE))
        return findings

    def _finding(self, ctx: GeneratorContext, record: MetricRecord, cohort_median: float, total_cost: float, claim: ClaimFrame, direction: Direction) -> Finding:
        frame = ctx.metric_frame
        frequency = record.metrics["frequency"]
        evidence: dict[str, float | int | str] = {"frequency": round(frequency, 3), "cohort_median_frequency": round(cohort_median, 3)}
        if "qualified_reach" in record.metrics:
            evidence["qualified_reach"] = record.metrics["qualified_reach"]
        if "reach" in record.metrics:
            evidence["reach"] = record.metrics["reach"]

        return Finding(
            id=f"a01_{claim.value}_{record.entity.id}",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[3, 4],
            entity=EntityRef(id=record.entity.id, display_name=record.entity.display_name),
            level=finding_level_of(record.entity.level),
            claim_frame=claim.value,
            evidence=evidence,
            comparison=Comparison(
                basis=ComparisonBasis.COHORT_MEDIAN,
                baseline_value=cohort_median,
                current_value=frequency,
                delta_abs=frequency - cohort_median,
                delta_pct=(frequency - cohort_median) / cohort_median if cohort_median else None,
            ),
            magnitude_pct=min(1.0, record.metrics.get("cost", 0.0) / total_cost) if total_cost else 0.05,
            direction=direction,
            actionability="medium",
            confidence=Confidence.MEDIUM,
            materiality=0.0,
            provenance=[f"{record.entity.level.value}:{record.entity.id}:current"],
        )
