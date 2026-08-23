"""Fixture: the Sovella TTS Weekly reference report, back-derived into a
MetricFrame. Gold standard for B2/B3 exit criteria (PRD §12).

What is real vs. reconstructed — see the equivalent note this carries
forward unchanged from the prior build: current-period account totals, the
8 GMV Max live sessions, the 8 non-GMV Max ad groups, and the 3 product rows
are the report's own figures. The prior period is reconstructed (documented
inline below) to reproduce PRD §6.3's named G07 scenario — a 4-active-day
current window nominally reading as a decline against a 7-active-day prior
window whose per-active-day rate is actually higher. impressions/clicks/
CTR/CVR/AOV are back-solved from GMV/cost/ROI/orders (the only account-level
figures the report actually prints) so the identity chain holds exactly.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from engine.contracts import Entity, EntityLevel, MetricFrame, MetricRecord, Period
from engine.contracts.presets import GMV_OBJECTIVE_CONTRACT

TENANT_ID = "sovella"

CURRENT_PERIOD = Period(
    start_date=date(2026, 6, 25),
    end_date=date(2026, 7, 1),
    active_days=4,  # only 25-28 Jun synced by report generation time
    label="current",
)
PRIOR_PERIOD = Period(
    start_date=date(2026, 6, 18),
    end_date=date(2026, 6, 24),
    active_days=7,
    label="prior",
)


def _account_metrics(
    *, gmv: float, cost: float, orders: float, ctr: float, cvr: float
) -> dict[str, float]:
    """Back-solve impressions/clicks/AOV so the identity chain holds
    exactly. impressions/clicks round to whole counts first; ctr/cvr are
    then recomputed from those rounded counts (not kept at their input
    values) so `clicks == impressions*ctr` and `orders == clicks*cvr` hold
    exactly, not approximately. AOV is a currency average, not a count, so
    it stays unrounded — `orders*aov` must reconstruct `gmv` exactly."""
    clicks = round(orders / cvr)
    impressions = round(clicks / ctr)
    aov = gmv / orders
    roi = gmv / cost
    return {
        "impressions": impressions,
        "clicks": clicks,
        "ctr": clicks / impressions,
        "cvr": orders / clicks,
        "orders": orders,
        "aov": aov,
        "gmv": gmv,
        "cost": cost,
        "roi": round(roi, 4),
    }


def build_sovella_gmv_metric_frame() -> MetricFrame:
    account = Entity(level=EntityLevel.ACCOUNT, id="sovella", display_name="Sovella")

    current_account = _account_metrics(gmv=506_058_865, cost=53_799_429, orders=2932, ctr=0.012, cvr=0.035)
    prior_account = _account_metrics(
        # Sized so the nominal GMV delta reads ~-21% while the per-active-day
        # rate (506,058,865/4 vs 642,010,558/7) is actually higher this
        # period — see module docstring.
        gmv=642_010_558, cost=73_283_000, orders=2_414, ctr=0.011, cvr=0.033,
    )

    records = [
        MetricRecord(entity=account, period=CURRENT_PERIOD, metrics=current_account),
        MetricRecord(entity=account, period=PRIOR_PERIOD, metrics=prior_account),
        *_campaign_records(),
        *_session_records(),
        *_product_records(),
        *_non_gmv_ad_group_records(),
    ]

    return MetricFrame(
        tenant_id=TENANT_ID,
        brief_type="gmv",
        current_period=CURRENT_PERIOD,
        prior_period=PRIOR_PERIOD,
        records=records,
        currency="IDR",
        timezone="Asia/Jakarta",
        generated_at=datetime(2026, 8, 19, 17, 18, 41, tzinfo=timezone.utc),
    )


def _campaign_records() -> list[MetricRecord]:
    all_products_gmv = round(506_058_865 * 0.1918)
    all_products_cost = round(all_products_gmv / 9.71)
    all_products = Entity(level=EntityLevel.CAMPAIGN, id="camp_all_products", display_name="All Products")
    lennon = Entity(level=EntityLevel.CAMPAIGN, id="camp_lennon", display_name="Lennon")

    return [
        MetricRecord(
            entity=all_products,
            period=CURRENT_PERIOD,
            metrics={"gmv": all_products_gmv, "cost": all_products_cost, "roi": 9.71},
            dimensions={"campaign_type": "gmv_max"},
        ),
        MetricRecord(
            entity=lennon,
            period=CURRENT_PERIOD,
            metrics={"gmv": 60_059_187, "cost": 7_569_245, "orders": 493, "roi": 7.93},
            dimensions={"campaign_type": "gmv_max", "product": "Lennon"},
        ),
    ]


_LIVE_SESSIONS = [
    ("Promo Special Payday Sale #1", 9_319_163, 1_386_212, 52, 6.72, 4204),
    ("Harga Special Hanya Di Live #1", 7_297_972, 979_635, 40, 7.45, 4276),
    ("Promo Special Payday Sale #2", 6_825_500, 249_609, 38, 27.34, 3841),
    ("Harga Special Hanya Di Live #2", 6_795_949, 1_134_742, 37, 5.99, 4681),
    ("Harga Special Hanya Di Live #3", 6_043_540, 979_227, 33, 6.17, 3674),
    ("Harga Special Hanya Di Live #4", 5_655_360, 543_926, 31, 10.40, 4885),
    ("Harga Special Hanya Di Live #5", 5_391_526, 516_563, 30, 10.44, 4167),
    ("Promo Special Payday Sale #3", 5_178_699, 507_907, 29, 10.20, 3980),
]


def _session_records() -> list[MetricRecord]:
    return [
        MetricRecord(
            entity=Entity(level=EntityLevel.SESSION, id=f"live_{i:02d}", display_name=name),
            period=CURRENT_PERIOD,
            metrics={"gmv": gmv, "cost": cost, "orders": orders, "roi": roi, "views": views},
            dimensions={"campaign_type": "gmv_max"},
        )
        for i, (name, gmv, cost, orders, roi, views) in enumerate(_LIVE_SESSIONS, start=1)
    ]


_PRODUCTS = [
    ("SOVELLA Lennon", 60_059_187, 7_569_245, 493, 7.93),
    ("SOVELLA Alexa", 58_960_703, 7_568_070, 336, 7.79),
    ("SOVELLA Marsha", 52_157_191, 5_906_711, 270, 8.83),
]


def _product_records() -> list[MetricRecord]:
    return [
        MetricRecord(
            entity=Entity(level=EntityLevel.PRODUCT, id=f"sku_{name.split()[-1].lower()}", display_name=name),
            period=CURRENT_PERIOD,
            metrics={"gmv": gmv, "cost": cost, "orders": orders, "roi": roi},
            dimensions={"campaign_type": "gmv_max"},
        )
        for name, gmv, cost, orders, roi in _PRODUCTS
    ]


_NON_GMV_ADS = [
    ("19951234", 235_351, 298, 0.0018, 72),
    ("19139345", 162_319, 160, 0.0012, 17),
    ("49777826", 71_802, 38, 0.0009, 6),
    ("19951250", 0, 0, 0.0, 0),
    ("69723634", 0, 0, 0.0, 0),
    ("79645698", 0, 0, 0.0, 0),
    ("46259698", 0, 0, 0.0, 0),
    ("19949954", 0, 0, 0.0, 0),
]


def _non_gmv_ad_group_records() -> list[MetricRecord]:
    return [
        MetricRecord(
            entity=Entity(level=EntityLevel.AD_GROUP, id=f"ad_{ad_id}", display_name=f"Iklan {ad_id}"),
            period=CURRENT_PERIOD,
            metrics={"cost": cost, "consideration": consideration, "ctr": ctr, "clicks": clicks},
            dimensions={"campaign_type": "non_gmv_max"},
        )
        for ad_id, cost, consideration, ctr, clicks in _NON_GMV_ADS
    ]


__all__ = ["TENANT_ID", "CURRENT_PERIOD", "PRIOR_PERIOD", "build_sovella_gmv_metric_frame", "GMV_OBJECTIVE_CONTRACT"]
