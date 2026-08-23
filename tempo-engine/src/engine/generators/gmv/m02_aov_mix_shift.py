"""M02 — AOV & Mix Shift. PRD §6.3: "Decompose AOV delta into intra-SKU
price vs. cross-SKU mix."

Exact two-factor shift-share decomposition (not LMDI — G01 is the only
generator the PRD specifies LMDI for): for each SKU with an order-weighted
share `share_i` and an average price `price_i = gmv_i/orders_i`,

    price_effect = sum(share0_i * (price1_i - price0_i))   # mix held at period 0
    mix_effect   = sum((share1_i - share0_i) * price1_i)   # price held at period 1

`price_effect + mix_effect == AOV1 - AOV0` exactly (verified in the test
suite). Requires product-level records in both periods for at least two
SKUs — the Sovella fixture only has current-period product rows (documented
in its own module), so this reports a coverage gap there; the math is
proved with a synthetic fixture instead.
"""

from __future__ import annotations

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityLevel, EntityRef, Finding, FindingLevel
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import records_by_level

MIN_PAIRED_PRODUCTS = 2


class M02AovMixShift(Generator):
    id = "M02"
    name = "AOV & Mix Shift"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        frame = ctx.metric_frame
        if frame.prior_period is None:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no prior period to compare against"))

        current = {r.entity.id: r for r in records_by_level(frame, EntityLevel.PRODUCT, "current") if {"gmv", "orders"} <= r.metrics.keys()}
        prior = {r.entity.id: r for r in records_by_level(frame, EntityLevel.PRODUCT, "prior") if {"gmv", "orders"} <= r.metrics.keys()}
        paired_ids = sorted(set(current) & set(prior))
        if len(paired_ids) < MIN_PAIRED_PRODUCTS:
            return GeneratorResult(
                coverage_gap=CoverageGap(generator=self.id, reason=f"fewer than {MIN_PAIRED_PRODUCTS} products have both current- and prior-period gmv/orders")
            )

        total_orders_current = sum(current[i].metrics["orders"] for i in paired_ids)
        total_orders_prior = sum(prior[i].metrics["orders"] for i in paired_ids)
        if total_orders_current <= 0 or total_orders_prior <= 0:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="zero total orders in a period"))

        price_effect = 0.0
        mix_effect = 0.0
        for pid in paired_ids:
            c, p = current[pid], prior[pid]
            if c.metrics["orders"] <= 0 or p.metrics["orders"] <= 0:
                continue
            share0 = p.metrics["orders"] / total_orders_prior
            share1 = c.metrics["orders"] / total_orders_current
            price0 = p.metrics["gmv"] / p.metrics["orders"]
            price1 = c.metrics["gmv"] / c.metrics["orders"]
            price_effect += share0 * (price1 - price0)
            mix_effect += (share1 - share0) * price1

        aov_current = sum(current[i].metrics["gmv"] for i in paired_ids) / total_orders_current
        aov_prior = sum(prior[i].metrics["gmv"] for i in paired_ids) / total_orders_prior

        finding = Finding(
            id="m02_aov_mix_shift",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[5],
            entity=EntityRef(id="products", display_name="Product Mix"),
            level=FindingLevel.PRODUCT,
            claim_frame=ClaimFrame.AOV_MIX_SHIFT.value,
            evidence={
                "aov_current": round(aov_current, 2),
                "aov_prior": round(aov_prior, 2),
                "price_effect": round(price_effect, 2),
                "mix_effect": round(mix_effect, 2),
                "product_count": len(paired_ids),
            },
            comparison=Comparison(
                basis=ComparisonBasis.PRIOR_PERIOD,
                baseline_value=aov_prior,
                current_value=aov_current,
                delta_abs=aov_current - aov_prior,
                delta_pct=(aov_current - aov_prior) / aov_prior if aov_prior else None,
            ),
            magnitude_pct=0.3,
            direction=Direction.POSITIVE if aov_current > aov_prior else Direction.NEGATIVE if aov_current < aov_prior else Direction.NEUTRAL,
            actionability="medium",
            confidence=Confidence.MEDIUM if len(paired_ids) >= 3 else Confidence.LOW,
            materiality=0.0,
            provenance=[f"product:{pid}:current+prior" for pid in paired_ids],
        )
        return GeneratorResult(findings=[finding])
