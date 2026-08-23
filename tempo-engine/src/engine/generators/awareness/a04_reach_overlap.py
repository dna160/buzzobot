"""A04 — Reach Overlap Proxy. PRD §6.3 names this "placement overlap
proxy," calling it out as "the one place reach non-additivity is the
signal, not the trap." Tempo has no placement dimension at all (see
`ClaimFrame.ADGROUP_REACH_OVERLAP`'s docstring), so this generator uses the
one overlap signal the schema actually reports: a campaign's own reach
(`adgroup_id IS NULL`, TikTok's deduped campaign-level figure) vs. the sum
of that same campaign's adgroup-level reach rows. Because adgroup-level
reach is NOT deduped across adgroups (the same person reached by two
adgroups in one campaign counts once in the campaign figure, twice in the
adgroup sum), `sum(adgroup reach) > campaign reach` is expected and its
size IS the cross-adgroup audience-overlap estimate — exactly what B9's
exit criterion asks for: "A04 validated against deduped rollups."

`tempo_read.py::build_awareness_metric_frame` tags each adgroup-level
`MetricRecord` with `dimensions={"campaign_id": ...}` so this generator can
regroup adgroups by parent campaign without a foreign-key field on `Entity`
itself.
"""

from __future__ import annotations

from collections import defaultdict

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityRef, Finding, FindingLevel, MetricRecord
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import records_by_level
from engine.contracts.metric_frame import EntityLevel

MIN_ADGROUPS_PER_CAMPAIGN = 2
OVERLAP_FLAG_THRESHOLD = 0.15  # >=15% inflation from cross-adgroup overlap


class A04ReachOverlap(Generator):
    id = "A04"
    name = "Reach Overlap Proxy"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        frame = ctx.metric_frame
        campaigns = {r.entity.id: r for r in records_by_level(frame, EntityLevel.CAMPAIGN, "current") if "reach" in r.metrics}
        adgroups = [r for r in records_by_level(frame, EntityLevel.AD_GROUP, "current") if "reach" in r.metrics]

        by_campaign: dict[str, list[MetricRecord]] = defaultdict(list)
        for r in adgroups:
            campaign_id = r.dimensions.get("campaign_id")
            if campaign_id:
                by_campaign[campaign_id].append(r)

        findings: list[Finding] = []
        for campaign_id, campaign_adgroups in by_campaign.items():
            campaign_record = campaigns.get(campaign_id)
            if campaign_record is None or len(campaign_adgroups) < MIN_ADGROUPS_PER_CAMPAIGN:
                continue
            campaign_reach = campaign_record.metrics["reach"]
            if campaign_reach <= 0:
                continue
            summed_adgroup_reach = sum(r.metrics["reach"] for r in campaign_adgroups)
            overlap_ratio = (summed_adgroup_reach - campaign_reach) / campaign_reach
            if overlap_ratio < OVERLAP_FLAG_THRESHOLD:
                continue
            findings.append(self._finding(ctx, campaign_record, summed_adgroup_reach, overlap_ratio, len(campaign_adgroups)))

        if not findings:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason=f"no campaign had >={MIN_ADGROUPS_PER_CAMPAIGN} reach-bearing adgroups with overlap >= {OVERLAP_FLAG_THRESHOLD:.0%}", missing_metrics=["reach"]))
        return GeneratorResult(findings=findings)

    def _finding(self, ctx: GeneratorContext, campaign_record: MetricRecord, summed_adgroup_reach: float, overlap_ratio: float, adgroup_count: int) -> Finding:
        frame = ctx.metric_frame
        campaign_reach = campaign_record.metrics["reach"]
        return Finding(
            id=f"a04_{campaign_record.entity.id}",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[4],
            entity=EntityRef(id=campaign_record.entity.id, display_name=campaign_record.entity.display_name),
            level=FindingLevel.CAMPAIGN,
            claim_frame=ClaimFrame.ADGROUP_REACH_OVERLAP.value,
            evidence={
                "campaign_reach": campaign_reach,
                "summed_adgroup_reach": summed_adgroup_reach,
                "overlap_ratio": round(overlap_ratio, 4),
                "adgroup_count": adgroup_count,
            },
            comparison=Comparison(
                basis=ComparisonBasis.ACCOUNT_BASELINE,
                baseline_value=campaign_reach,
                current_value=summed_adgroup_reach,
                delta_abs=summed_adgroup_reach - campaign_reach,
                delta_pct=overlap_ratio,
            ),
            magnitude_pct=0.05,
            direction=Direction.NEGATIVE,
            actionability="medium",
            confidence=Confidence.MEDIUM,
            caveats=["adgroup-level reach is not deduped across adgroups within a campaign — the overlap_ratio is an estimate of cross-adgroup audience overlap, not a TikTok-reported figure"],
            materiality=0.0,
            provenance=[f"campaign:{campaign_record.entity.id}:current"],
        )
