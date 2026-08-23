"""M04 — SKU Lifecycle Contribution. PRD §6.3: "New vs. mature SKU share of
GMV delta."

Honest scope note: computing a genuine new-vs-mature split needs a SKU
launch-date dimension neither the Sovella fixture nor live Tempo data
carries (Tempo's schema has no product/SKU table at all — see the
tempo-engine B0 contradiction report on Shop). Rather than fabricate a
lifecycle bucket from data that doesn't exist, this generator computes the
closest thing that *is* computable and genuinely useful: which SKUs
contribute how much of current-period GMV, and which one is most efficient
— the same two facts the reference report's own §5 leads with ("Produk
SOVELLA Lennon mendominasi penjualan... SOVELLA Marsha mencatatkan ROI
tertinggi"). A real lifecycle split is a v1.1 extension once product
metadata exists upstream, not something to approximate here.
"""

from __future__ import annotations

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityLevel, EntityRef, Finding, FindingLevel
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import records_by_level

MIN_PRODUCTS = 2


class M04SkuLifecycleContribution(Generator):
    id = "M04"
    name = "SKU Lifecycle Contribution (GMV-share proxy)"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        products = records_by_level(ctx.metric_frame, EntityLevel.PRODUCT, "current")
        scoreable = [r for r in products if "gmv" in r.metrics]
        if len(scoreable) < MIN_PRODUCTS:
            return GeneratorResult(
                coverage_gap=CoverageGap(generator=self.id, reason=f"fewer than {MIN_PRODUCTS} product-level records with gmv", missing_metrics=["gmv"])
            )

        total_gmv = sum(r.metrics["gmv"] for r in scoreable)
        if total_gmv <= 0:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="total product GMV is zero"))

        top = max(scoreable, key=lambda r: r.metrics["gmv"])
        top_share = top.metrics["gmv"] / total_gmv

        findings = [self._contribution_finding(ctx, top, top_share, len(scoreable), total_gmv)]

        roi_scoreable = [r for r in scoreable if "roi" in r.metrics]
        if roi_scoreable:
            best_roi = max(roi_scoreable, key=lambda r: r.metrics["roi"])
            if best_roi.entity.id != top.entity.id:
                findings.append(self._efficiency_finding(ctx, best_roi, total_gmv))

        return GeneratorResult(findings=findings)

    def _contribution_finding(self, ctx: GeneratorContext, record, share: float, product_count: int, total_gmv: float) -> Finding:  # noqa: ANN001
        frame = ctx.metric_frame
        return Finding(
            id=f"m04_contribution_{record.entity.id}",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[5],
            entity=EntityRef(id=record.entity.id, display_name=record.entity.display_name),
            level=FindingLevel.PRODUCT,
            claim_frame=ClaimFrame.SKU_LIFECYCLE_CONTRIBUTION.value,
            evidence={
                "gmv": record.metrics["gmv"],
                "gmv_share": round(share, 4),
                "product_count": product_count,
                "total_gmv": total_gmv,
                **({"roi": record.metrics["roi"]} if "roi" in record.metrics else {}),
            },
            comparison=Comparison(
                basis=ComparisonBasis.ACCOUNT_BASELINE,
                baseline_value=total_gmv / product_count,
                current_value=record.metrics["gmv"],
                delta_abs=record.metrics["gmv"] - total_gmv / product_count,
                delta_pct=None,
                label="vs. even split across products",
            ),
            magnitude_pct=round(share, 4),
            direction=Direction.NEUTRAL,
            actionability="medium",
            confidence=Confidence.MEDIUM,
            caveats=["computed from current-period GMV share only — no SKU launch-date data exists to compute a true new-vs-mature lifecycle split"],
            materiality=0.0,
            provenance=[f"product:{record.entity.id}:current"],
        )

    def _efficiency_finding(self, ctx: GeneratorContext, record, total_gmv: float) -> Finding:  # noqa: ANN001
        frame = ctx.metric_frame
        return Finding(
            id=f"m04_efficiency_{record.entity.id}",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[5],
            entity=EntityRef(id=record.entity.id, display_name=record.entity.display_name),
            level=FindingLevel.PRODUCT,
            claim_frame=ClaimFrame.SKU_LIFECYCLE_CONTRIBUTION.value,
            evidence={"gmv": record.metrics["gmv"], "roi": record.metrics["roi"]},
            comparison=None,
            magnitude_pct=min(1.0, record.metrics["gmv"] / total_gmv) if total_gmv else 0.0,
            direction=Direction.POSITIVE,
            actionability="medium",
            confidence=Confidence.MEDIUM,
            materiality=0.0,
            provenance=[f"product:{record.entity.id}:current"],
        )
