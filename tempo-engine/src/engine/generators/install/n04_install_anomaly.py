"""N04 — Install Anomaly. PRD §6.3 explicitly qualifies this one: "flagged,
not asserted." Unlike G02 (which asserts a direction — high z is good,
low z is bad, because `installs_per_cost`'s polarity is unambiguous), an
install-rate (`ir`) anomaly is genuinely ambiguous without more context: an
unusually HIGH ir could mean excellent targeting, or it could mean
attribution/tracking noise on a low-volume entity; an unusually LOW ir
could mean weak creative, or bot/low-quality click traffic. This generator
deliberately does not resolve that ambiguity — every finding here carries
`direction=NEUTRAL`, `confidence=LOW`, `actionability=LOW`, and an explicit
"needs human review" caveat, structurally distinct from every other
generator's outlier detection (G02, N02) which DO assert a direction.
"""

from __future__ import annotations

from collections import defaultdict

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityRef, Finding, MetricRecord
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import finding_level_of, non_account_records
from engine.stats import median, robust_z_scores

MIN_COHORT_SIZE = 4
Z_THRESHOLD = 2.5  # stricter than G02's 2.0 — "flagged, not asserted" means a higher bar to even flag


class N04InstallAnomaly(Generator):
    id = "N04"
    name = "Install Anomaly (flagged, not asserted)"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        records = non_account_records(ctx.metric_frame, "current")
        cohorts: dict[str, list[MetricRecord]] = defaultdict(list)
        for r in records:
            if "ir" in r.metrics:
                cohorts[r.entity.level.value].append(r)

        findings: list[Finding] = []
        for cohort in cohorts.values():
            findings.extend(self._score_cohort(ctx, cohort))

        if not findings:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no cohort had >=4 entities with 'ir', or none exceeded the anomaly threshold", missing_metrics=["ir"]))
        return GeneratorResult(findings=findings)

    def _score_cohort(self, ctx: GeneratorContext, cohort: list[MetricRecord]) -> list[Finding]:
        if len(cohort) < MIN_COHORT_SIZE:
            return []
        values = [r.metrics["ir"] for r in cohort]
        z_scores = robust_z_scores(values)
        cohort_median = median(values)

        findings: list[Finding] = []
        for record, z in zip(cohort, z_scores, strict=True):
            if abs(z) < Z_THRESHOLD:
                continue
            findings.append(self._finding(ctx, record, cohort_median, z))
        return findings

    def _finding(self, ctx: GeneratorContext, record: MetricRecord, cohort_median: float, z: float) -> Finding:
        frame = ctx.metric_frame
        ir = record.metrics["ir"]
        return Finding(
            id=f"n04_{record.entity.id}",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[4, 6],
            entity=EntityRef(id=record.entity.id, display_name=record.entity.display_name),
            level=finding_level_of(record.entity.level),
            claim_frame=ClaimFrame.INSTALL_RATE_ANOMALY.value,
            evidence={"ir": round(ir, 4), "cohort_median_ir": round(cohort_median, 4), "z_score": round(z, 3)},
            comparison=Comparison(
                basis=ComparisonBasis.COHORT_MEDIAN,
                baseline_value=cohort_median,
                current_value=ir,
                delta_abs=ir - cohort_median,
                delta_pct=(ir - cohort_median) / cohort_median if cohort_median else None,
            ),
            magnitude_pct=0.05,
            direction=Direction.NEUTRAL,
            actionability="low",
            confidence=Confidence.LOW,
            caveats=["direction of this anomaly (targeting quality vs. tracking noise vs. low-quality traffic) cannot be determined from install rate alone — needs human review before acting on it"],
            materiality=0.0,
            provenance=[f"{record.entity.level.value}:{record.entity.id}:current"],
        )
