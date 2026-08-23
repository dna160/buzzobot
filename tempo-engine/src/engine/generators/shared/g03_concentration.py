"""G03 — Concentration & Dependency. PRD §6.3: Top-N share, HHI, Gini per
axis. Flag at HHI > 0.25 or top-1 > 40%. "Never across levels" — each axis
scored is a single `EntityLevel` cohort, never a pool mixing campaigns and
adgroups (Hard Rule 2).
"""

from __future__ import annotations

from collections import defaultdict

from engine.contracts import ClaimFrame, Confidence, Direction, EntityRef, Finding, MetricRecord
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import finding_level_of, non_account_records
from engine.stats import gini_coefficient, herfindahl_hirschman_index

HHI_THRESHOLD = 0.25
TOP1_SHARE_THRESHOLD = 0.40
MIN_ENTITIES = 3


class G03Concentration(Generator):
    id = "G03"
    name = "Concentration & Dependency"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        records = non_account_records(ctx.metric_frame, "current")
        if not records:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no non-account entities in the current period"))

        by_level: dict[str, list[MetricRecord]] = defaultdict(list)
        for r in records:
            by_level[r.entity.level.value].append(r)

        primary_outcome = ctx.objective_contract.primary_outcome
        findings: list[Finding] = []
        for level, group in by_level.items():
            metric_key = primary_outcome if all(primary_outcome in r.metrics for r in group) else "cost"
            if not all(metric_key in r.metrics for r in group) or len(group) < MIN_ENTITIES:
                continue

            values = [r.metrics[metric_key] for r in group]
            total = sum(values)
            if total <= 0:
                continue

            shares = [v / total for v in values]
            hhi = herfindahl_hirschman_index(shares)
            gini = gini_coefficient(values)
            top_idx = max(range(len(group)), key=lambda i: values[i])
            top_share = shares[top_idx]

            if hhi <= HHI_THRESHOLD and top_share <= TOP1_SHARE_THRESHOLD:
                continue

            top_record = group[top_idx]
            findings.append(
                Finding(
                    id=f"g03_{level}",
                    generator=self.id,
                    tenant_id=ctx.metric_frame.tenant_id,
                    brief_type=ctx.metric_frame.brief_type,
                    section_affinity=[3, 6],
                    entity=EntityRef(id=top_record.entity.id, display_name=top_record.entity.display_name),
                    level=finding_level_of(top_record.entity.level),
                    claim_frame=ClaimFrame.CONCENTRATION_DEPENDENCY.value,
                    evidence={
                        "metric": metric_key,
                        "cohort_level": level,
                        "cohort_size": len(group),
                        "hhi": round(hhi, 4),
                        "gini": round(gini, 4),
                        "top1_share": round(top_share, 4),
                        "top1_value": values[top_idx],
                        "total": total,
                    },
                    comparison=None,
                    magnitude_pct=round(top_share, 4),
                    direction=Direction.NEUTRAL,
                    actionability="medium",
                    confidence=Confidence.HIGH if len(group) >= 6 else Confidence.MEDIUM,
                    caveats=([] if len(group) >= MIN_ENTITIES * 2 else [f"only {len(group)} entities in this cohort"]),
                    materiality=0.0,
                    provenance=[f"{level}:{r.entity.id}:current" for r in group],
                )
            )

        if not findings:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no entity axis exceeded the HHI or top-1-share threshold"))
        return GeneratorResult(findings=findings)
