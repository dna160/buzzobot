"""Synthetic Strategy Report frames (PRD §11.1), for what real data cannot show.

Every planted signal here is **synthetic and labelled so** — P0 split the
fixtures so that a planted knee or competitor jump is never cited as a real
client's number (P0_DISCOVERY.md §7). Real figures live in the frozen
`bardi_strategy_frame.json`.

- `brand_full()` — brand class (vtr north star, 15% GMV share), Full TTMS plan:
  a saturating spend → new Consideration response with its knee planted at
  Rp1.6M/day, "Competitor C" climbing #9 → #4 in Consideration, share of voice
  falling, a search-share drop in the last week, and a rank goal.
- `lite_minimal_14d()` — a Lite account with exactly 14 days and no spend:
  every generator that needs history or spend must register a gap, and the
  report must still render.

Deterministic: noise is a fixed sine pattern, never `random`.
"""

from __future__ import annotations

import math
from datetime import UTC, date, datetime, timedelta

from engine.contracts.strategy import (
    AudienceDay,
    Classification,
    CompetitorRank,
    InsightDay,
    SpendDay,
    StrategyFrame,
    StrategyGoal,
)
from engine.ports.strategy_classify import classify

AS_OF = date(2026, 10, 10)
KNEE = 1_600_000.0
B = KNEE / math.log(2)
A = 14_000.0


def _noise(i: int, scale: float) -> float:
    return scale * math.sin(i * 1.7) * 0.5


def _bench(v: float) -> dict[str, float | None]:
    return {"top5": v * 1.6, "top10": v, "top25": v * 0.55, "top50": v * 0.3}


def brand_full() -> StrategyFrame:
    days = 84
    start = AS_OF - timedelta(days=days - 1)
    spend, audience, insights = [], {s: [] for s in ("acc", "awareness", "consideration", "conversion")}, {}
    for i in range(days):
        d = start + timedelta(days=i)
        s = 800_000 + 2_200_000 * (0.5 + 0.5 * math.sin(i * 0.9))  # 0.8M … 3.0M per day
        spend.append(SpendDay(date=d, spend=round(s), gmv_max_spend=round(s * 0.15)))
    by_date = {x.date: x.spend for x in spend}
    for i in range(days):
        d = start + timedelta(days=i)
        s_lag = by_date.get(d - timedelta(days=2), 1_500_000)
        cons_new = A * (1 - math.exp(-s_lag / B)) + _noise(i, 300)
        rank_cons = round(44 - 6 * i / (days - 1))  # 44 → 38 over the series
        audience["acc"].append(AudienceDay(date=d, total=2.1e6 + i * 2000, new=90_000, outflow=80_000, rank=rank_cons - 2, rank_n=56, bench_total=_bench(2.7e7)))
        audience["awareness"].append(AudienceDay(date=d, total=1.9e6 + i * 2000, new=85_000, outflow=78_000, rank=rank_cons - 1, rank_n=56, bench_total=_bench(2.45e7), bench_new=_bench(9e5), bench_outflow=_bench(8.5e5)))
        audience["consideration"].append(AudienceDay(date=d, total=129_600 + i * 50, new=cons_new, outflow=cons_new * 0.97, rank=rank_cons, rank_n=56, bench_total=_bench(2.1e6), bench_new=_bench(6e4), bench_outflow=_bench(5.8e4)))
        audience["conversion"].append(AudienceDay(date=d, total=5_800, new=0, outflow=0, rank=38, rank_n=56, bench_total=_bench(3.35e5)))
        recent = i >= days - 28
        # Share of voice falling: 2.1% prior window → 1.6% current window.
        share = 0.016 if recent else 0.021
        cat = 5e7
        insights.setdefault("impressions|all", []).append(InsightDay(date=d, value=cat * share / 30, share=share, bench_value=_bench(cat * 0.05 / 30), bench_share=_bench(0.05)))
        for ct, part, bpart in (("paid", 0.71, 0.6), ("non_paid", 0.29, 0.4), ("ads", 0.71, 0.55), ("bgc_organic", 0.10, 0.22), ("creator_organic", 0.06, 0.10), ("creator_boosted", 0.09, 0.08), ("bgc_boosted", 0.04, 0.05), ("ugc_organic", 0.02, 0.05), ("ugc_boosted", 0.0, 0.01)):
            insights.setdefault(f"impressions|{ct}", []).append(InsightDay(date=d, value=cat * share / 30 * part, share=None, bench_value=_bench(cat * 0.05 / 30 * bpart)))
        insights.setdefault("engagements|all", []).append(InsightDay(date=d, value=4000 * (0.8 if recent else 1.0), share=0.009 if recent else 0.012, bench_value=_bench(9000), bench_share=_bench(0.03)))
        insights.setdefault("product_card_clicks|all", []).append(InsightDay(date=d, value=600, share=0.01, bench_value=_bench(2000), bench_share=_bench(0.033)))
        search_share = (0.02 if i < days - 7 else 0.008) + 0.001 * math.sin(i * 2.3)
        insights.setdefault("search_volume|all", []).append(InsightDay(date=d, value=1000 * search_share / 0.02, share=search_share, bench_value=_bench(3000), bench_share=_bench(0.06)))
        insights.setdefault("comments|all", []).append(InsightDay(date=d, value=200 + 20 * math.sin(i * 1.3) + (900 if i == days - 1 else 0), share=0.01))
        insights.setdefault("nsr|all", []).append(InsightDay(date=d, value=0.4 if i < days - 7 else 0.3, share=None))

    competitors = {
        "consideration": [
            CompetitorRank(brand="Competitor C", rank_now=4, rank_7d=6, rank_14d=9),
            CompetitorRank(brand="Competitor D", rank_now=36, rank_7d=40, rank_14d=41),
            CompetitorRank(brand="Competitor E", rank_now=12, rank_7d=12, rank_14d=12),
        ]
    }
    return StrategyFrame(
        tenant_id="fixture-brand", client_slug="brand-fixture", client_name="Brand Fixture", north_star="vtr",
        ttms_account_id="synthetic-brand", brand_name="Brand Fixture", vertical="Consumer Electronics",
        plan="TTS Purchase", is_lite=False, unavailable_metrics=[],
        as_of=AS_OF, window_days=28, current_start=AS_OF - timedelta(days=27),
        prior_start=AS_OF - timedelta(days=55), prior_end=AS_OF - timedelta(days=28), history_days=days,
        audience=audience, insights=insights, competitors=competitors, spend=spend,
        goal=StrategyGoal(kind="rank", stage="consideration", value=25, deadline=date(2026, 12, 31)),
        creator_fee_monthly=12_000_000,
        classification=classify(north_star="vtr", gmv_share=0.15, conv_ratio=0.045),
        generated_at=datetime(2026, 10, 10, tzinfo=UTC),
    )


def lite_minimal_14d() -> StrategyFrame:
    start = AS_OF - timedelta(days=13)
    audience = {
        s: [AudienceDay(date=start + timedelta(days=i), total=t, new=0, outflow=0, rank=40, rank_n=50, bench_total=_bench(t * 10)) for i in range(14)]
        for s, t in (("acc", 50_000.0), ("awareness", 45_000.0), ("consideration", 3_000.0), ("conversion", 200.0))
    }
    return StrategyFrame(
        tenant_id="fixture-lite", client_slug="lite-fixture", client_name="Lite Fixture", north_star="shop",
        ttms_account_id="synthetic-lite", brand_name="Lite Fixture", is_lite=True, unavailable_metrics=["SEARCH_VOLUME", "NSR"],
        as_of=AS_OF, window_days=28, current_start=AS_OF - timedelta(days=27),
        prior_start=AS_OF - timedelta(days=55), prior_end=AS_OF - timedelta(days=28), history_days=14,
        audience=audience, classification=Classification(report_class="shop", score=2, inferred_class="shop"),
        generated_at=datetime(2026, 10, 10, tzinfo=UTC),
    )
