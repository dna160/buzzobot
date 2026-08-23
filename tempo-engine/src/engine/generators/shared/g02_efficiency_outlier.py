"""G02 — Efficiency Outlier. PRD §6.3: robust z-score (median + MAD), both
tails, volume floor. Cohorts are entities of the SAME level only — never a
live session compared to a campaign (Hard Rule 2).
"""

from __future__ import annotations

from collections import defaultdict

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityRef, Finding, MetricRecord
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import finding_level_of, non_account_records
from engine.stats import median, robust_z_scores

MIN_COHORT_SIZE = 4
VOLUME_FLOOR_SHARE = 0.01
Z_THRESHOLD = 2.0  # small cohorts (tens, not thousands); reviewed against materiality preset tuning (B3+).


class G02EfficiencyOutlier(Generator):
    id = "G02"
    name = "Efficiency Outlier"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        contract = ctx.objective_contract
        metric = contract.efficiency_metric
        records = non_account_records(ctx.metric_frame, "current")

        if not any(metric in r.metrics for r in records):
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason=f"no entity carries the efficiency metric {metric!r}", missing_metrics=[metric]))

        cohorts: dict[str, list[MetricRecord]] = defaultdict(list)
        for r in records:
            cohorts[r.entity.level.value].append(r)

        findings: list[Finding] = []
        for level, cohort in cohorts.items():
            findings.extend(self._score_cohort(ctx, level, cohort, metric))

        if not findings:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no cohort had >=4 volume-qualified entities with an outlier beyond the z-threshold"))
        return GeneratorResult(findings=findings)

    def _score_cohort(self, ctx: GeneratorContext, level: str, cohort: list[MetricRecord], metric: str) -> list[Finding]:
        cost_key = "cost" if all("cost" in r.metrics for r in cohort) else None
        total_cost = sum(r.metrics.get(cost_key, 0.0) for r in cohort) if cost_key else None

        qualified = [
            r
            for r in cohort
            if metric in r.metrics
            and (total_cost is None or total_cost == 0 or (r.metrics.get(cost_key, 0.0) / total_cost) >= VOLUME_FLOOR_SHARE)  # type: ignore[arg-type]
        ]
        if len(qualified) < MIN_COHORT_SIZE:
            return []

        values = [r.metrics[metric] for r in qualified]
        z_scores = robust_z_scores(values)
        cohort_median = median(values)

        findings: list[Finding] = []
        for record, z in zip(qualified, z_scores, strict=True):
            if abs(z) < Z_THRESHOLD:
                continue
            value = record.metrics[metric]
            findings.append(
                Finding(
                    id=f"g02_{record.entity.id}",
                    generator=self.id,
                    tenant_id=ctx.metric_frame.tenant_id,
                    brief_type=ctx.metric_frame.brief_type,
                    section_affinity=[3, 4],
                    entity=EntityRef(id=record.entity.id, display_name=record.entity.display_name),
                    level=finding_level_of(record.entity.level),
                    claim_frame=(ClaimFrame.EFFICIENCY_OUTLIER_POSITIVE.value if z > 0 else ClaimFrame.EFFICIENCY_OUTLIER_NEGATIVE.value),
                    evidence={
                        "metric": metric,
                        "value": value,
                        "cohort_median": cohort_median,
                        "z_score": round(z, 3),
                        "cohort_level": level,
                        "cohort_size": len(qualified),
                    },
                    comparison=Comparison(
                        basis=ComparisonBasis.COHORT_MEDIAN,
                        baseline_value=cohort_median,
                        current_value=value,
                        delta_abs=value - cohort_median,
                        delta_pct=(value - cohort_median) / cohort_median if cohort_median != 0 else None,
                    ),
                    magnitude_pct=self._magnitude_pct(record, cohort, cost_key),
                    direction=Direction.POSITIVE if z > 0 else Direction.NEGATIVE,
                    actionability="high",
                    confidence=Confidence.HIGH if len(qualified) >= 6 else Confidence.MEDIUM,
                    materiality=0.0,
                    provenance=[f"{level}:{record.entity.id}:current"],
                )
            )
        return findings

    @staticmethod
    def _magnitude_pct(record: MetricRecord, cohort: list[MetricRecord], cost_key: str | None) -> float:
        if cost_key is None:
            return 0.0
        total = sum(r.metrics.get(cost_key, 0.0) for r in cohort)
        if total == 0:
            return 0.0
        return min(1.0, record.metrics.get(cost_key, 0.0) / total)
