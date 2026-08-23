"""N02 — Cohort Quality. PRD §6.3: "cohort quality."

PRD's usual sense of install "cohort quality" is post-install (D1/D7
retention, LTV) — none of that exists in this data (see
`INSTALL_OBJECTIVE_CONTRACT.additivity_trap`). The honest available proxy:
install rate (`ir` = installs/clicks) is a "how convert-prone were the
people who clicked" signal — a click that converts is inherently a
higher-intent event than one that doesn't, even with no downstream data.
This generator cross-references CPI against IR per entity (both vs. cohort
median) to flag the quadrant PRD's underlying concern actually targets:
cheap CPI bought via a LOW install rate (volume from low-intent clicks,
overpaying-per-outcome despite looking cheap on the surface) vs. strong IR
that justifies its CPI (real conversion quality, worth protecting/scaling).
This is deliberately a proxy, documented as one — not a claim about
retention or LTV this data cannot support.
"""

from __future__ import annotations

from collections import defaultdict

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityRef, Finding, MetricRecord
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import finding_level_of, non_account_records
from engine.stats import median

MIN_COHORT_SIZE = 4


class N02CohortQuality(Generator):
    id = "N02"
    name = "Cohort Quality"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        records = non_account_records(ctx.metric_frame, "current")
        cohorts: dict[str, list[MetricRecord]] = defaultdict(list)
        for r in records:
            if "ir" in r.metrics and "cpi" in r.metrics:
                cohorts[r.entity.level.value].append(r)

        findings: list[Finding] = []
        for cohort in cohorts.values():
            findings.extend(self._score_cohort(ctx, cohort))

        if not findings:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no cohort had >=4 entities with both ir and cpi", missing_metrics=["ir", "cpi"]))
        return GeneratorResult(findings=findings)

    def _score_cohort(self, ctx: GeneratorContext, cohort: list[MetricRecord]) -> list[Finding]:
        if len(cohort) < MIN_COHORT_SIZE:
            return []
        cpi_median = median([r.metrics["cpi"] for r in cohort])
        ir_median = median([r.metrics["ir"] for r in cohort])
        if cpi_median <= 0 or ir_median <= 0:
            return []

        findings: list[Finding] = []
        for r in cohort:
            cheap = r.metrics["cpi"] < cpi_median
            low_ir = r.metrics["ir"] < ir_median
            strong_ir = r.metrics["ir"] > ir_median
            if cheap and low_ir:
                findings.append(self._finding(ctx, r, cpi_median, ir_median, ClaimFrame.COHORT_QUALITY_RISK, Direction.NEGATIVE))
            elif strong_ir and not cheap:
                findings.append(self._finding(ctx, r, cpi_median, ir_median, ClaimFrame.COHORT_QUALITY_STRONG, Direction.POSITIVE))
        return findings

    def _finding(self, ctx: GeneratorContext, record: MetricRecord, cpi_median: float, ir_median: float, claim: ClaimFrame, direction: Direction) -> Finding:
        frame = ctx.metric_frame
        return Finding(
            id=f"n02_{claim.value}_{record.entity.id}",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[3, 4],
            entity=EntityRef(id=record.entity.id, display_name=record.entity.display_name),
            level=finding_level_of(record.entity.level),
            claim_frame=claim.value,
            evidence={
                "cpi": round(record.metrics["cpi"], 4),
                "cohort_median_cpi": round(cpi_median, 4),
                "ir": round(record.metrics["ir"], 4),
                "cohort_median_ir": round(ir_median, 4),
            },
            comparison=Comparison(
                basis=ComparisonBasis.COHORT_MEDIAN,
                baseline_value=ir_median,
                current_value=record.metrics["ir"],
                delta_abs=record.metrics["ir"] - ir_median,
                delta_pct=(record.metrics["ir"] - ir_median) / ir_median if ir_median else None,
            ),
            magnitude_pct=0.05,
            direction=direction,
            actionability="medium",
            confidence=Confidence.MEDIUM,
            caveats=["no post-install (retention/LTV) data exists in this source — 'quality' here means install rate (convert-prone clicks), not verified retention"],
            materiality=0.0,
            provenance=[f"{record.entity.level.value}:{record.entity.id}:current"],
        )
