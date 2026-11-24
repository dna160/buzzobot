"""T04 — Content mix & earned halo (Strategy Report PRD §7.3, P0 §6.6).

Only `paid` + `non_paid` partition all brand impressions; the other content
types overlap (a boosted creator video is also an ad — BARDI's `ads` is 101% of
`all`). So "paid-heavy" is judged on the paid share, not on `ads` as the PRD
sketched, and no two sub-types are ever summed. Halo = non-paid ÷ paid
impressions, against the same ratio on the benchmark. UGC is available on Lite
(P0 §2), so it is never reported as a gap here.
"""

from __future__ import annotations

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Direction
from engine.contracts.strategy import StrategyFrame
from engine.generators.base import GeneratorResult
from engine.generators.strategy._util import (
    bench_sum,
    in_range,
    make_finding,
    r,
    spend_sum,
    value_sum,
)
from engine.generators.strategy.base import StrategyGenerator, history_confidence

PAID_HEAVY_SHARE = 0.6
HALO_BELOW = 0.7  # brand halo below 70% of the benchmark's
#: Non-paid content the brand can actually make more of. UGC is reported in the
#: mix but is not a lever: users write it, the brand cannot commission it.
NON_PAID_LEVERS = ("bgc_organic", "creator_organic")


class T04ContentMix(StrategyGenerator):
    id = "T04"
    name = "Content mix & earned halo"

    def _generate(self, frame: StrategyFrame) -> GeneratorResult:
        lv = frame.benchmark
        win = lambda ct: in_range(frame.insight("impressions", ct), frame.current_start, frame.as_of)  # noqa: E731
        total = value_sum(win("all"))
        paid, non_paid = value_sum(win("paid")), value_sum(win("non_paid"))
        if not total or paid is None or non_paid is None:
            return self.gap("no content-type split of brand impressions in the window", ["ttms.impressions.share.*"])

        share = {ct: (value_sum(win(ct)) or 0) / total for ct in ("paid", "non_paid", "ads", "bgc_organic", "bgc_boosted", "creator_organic", "creator_boosted", "ugc_organic", "ugc_boosted")}
        b_all = bench_sum(win("all"), lv)
        b_share = {ct: (bench_sum(win(ct), lv) or 0) / b_all for ct in NON_PAID_LEVERS} if b_all else {}
        halo = non_paid / paid if paid else None
        b_paid, b_non = bench_sum(win("paid"), lv), bench_sum(win("non_paid"), lv)
        b_halo = b_non / b_paid if b_paid and b_non is not None else None

        # The non-paid type furthest below the benchmark's share — what the
        # content_mix lever would move first.
        gaps = {ct: b_share[ct] - share[ct] for ct in NON_PAID_LEVERS if ct in b_share}
        weakest = max(gaps, key=gaps.get) if gaps else "bgc_organic"
        conf = history_confidence(frame)
        base = {
            "impressions_all": total,
            "paid_share": r(share["paid"]),
            "non_paid_share": r(share["non_paid"]),
            "ads_share": r(share["ads"]),
            "weakest_type": weakest,
            "weakest_share": r(share[weakest]),
            "weakest_bench_share": r(b_share[weakest]) if weakest in b_share else None,
        }
        findings = []
        heavy = share["paid"] >= PAID_HEAVY_SHARE
        findings.append(
            make_finding(
                frame, id="t04_mix", generator=self.id, sections=[107],
                claim_frame=(ClaimFrame.CONTENT_MIX_PAID_HEAVY if heavy else ClaimFrame.CONTENT_MIX_BALANCED).value,
                evidence=base,
                magnitude=share["paid"] - 0.5 if heavy else 0.1,
                direction=Direction.NEGATIVE if heavy else Direction.NEUTRAL,
                actionability="medium" if heavy else "low",
                confidence=conf,
                caveats=["Jenis konten saling tumpang tindih kecuali berbayar + non-berbayar; porsi tidak pernah dijumlahkan."],
            )
        )
        if halo is not None and b_halo:
            below = halo < HALO_BELOW * b_halo
            if below:
                findings.append(
                    make_finding(
                        frame, id="t04_halo", generator=self.id, sections=[107],
                        claim_frame=ClaimFrame.HALO_BELOW_BENCHMARK.value,
                        evidence={**base, "halo": r(halo), "bench_halo": r(b_halo)},
                        comparison=Comparison(
                            basis=ComparisonBasis.COHORT_MEDIAN, baseline_value=r(b_halo), current_value=r(halo),
                            delta_abs=r(halo - b_halo), delta_pct=r((halo - b_halo) / b_halo), label=f"rata-rata {lv.replace('top', 'Top ')}",
                        ),
                        magnitude=(b_halo - halo) / b_halo,
                        direction=Direction.NEGATIVE, actionability="high", confidence=conf,
                    )
                )

        if frame.creator_fee_monthly:
            creator = (value_sum(win("creator_boosted")) or 0) + (value_sum(win("creator_organic")) or 0)
            ads = value_sum(win("ads"))
            spend = spend_sum(frame, frame.current_start, frame.as_of)
            if creator > 0 and ads and spend > 0:
                fee = frame.creator_fee_monthly * frame.window_days / 30
                creator_cpm, ads_cpm = fee / creator * 1000, spend / ads * 1000
                cheaper = creator_cpm < ads_cpm
                findings.append(
                    make_finding(
                        frame, id="t04_creator_cost", generator=self.id, sections=[107],
                        claim_frame=(ClaimFrame.CREATOR_COST_EFFICIENT if cheaper else ClaimFrame.CREATOR_COST_HIGHER).value,
                        evidence={
                            "creator_fee_window": round(fee),
                            "creator_impressions": creator,
                            "creator_cost_per_1k": round(creator_cpm),
                            "ads_cost_per_1k": round(ads_cpm),
                        },
                        magnitude=min(1.0, abs(creator_cpm - ads_cpm) / max(creator_cpm, ads_cpm)),
                        direction=Direction.POSITIVE if cheaper else Direction.NEGATIVE,
                        actionability="medium", confidence="medium",
                        caveats=["Biaya kreator diisi AM; impresi kreator yang di-boost juga dibayar sebagai iklan."],
                    )
                )
        return GeneratorResult(findings=findings)
