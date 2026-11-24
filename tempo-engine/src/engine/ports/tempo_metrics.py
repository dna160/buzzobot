"""Versioned Python port of `@tempo/core`'s METRICS catalog
(`packages/core/src/metrics/catalog.ts` in `dna160/buzzobot`).

Per the boundary contract (PRD §1, rule 3): "The engine never re-derives a
metric Tempo already defines. It calls a thin port over `@tempo/core`'s
METRICS catalog semantics... with a CI check that fails on drift." This is
that port. A generator that needs a metric's label, format, or "which
direction is good" reads it from here — never redefines it.

The source has `'paid'`, `'organic'` and — since Strategy Report P1 —
`'market_scope'` surfaces (`DataSurface` in
`packages/core/src/domain/enums.ts`). There is still no separate Shop metric
set: see
`docs/PRD_tempo_intelligence_engine.md`'s companion contradiction note on
§3.3: TikTok Shop GMV already flows through the generic paid `conversions`/
`conversionValue` keys below, disambiguated only by a client's `north_star`.

Not ported: `labelId`, `category`, `bands`, `pickerVisible` (added to the
source at Brief Deck M1). They are presentation concerns — which Bahasa label
a tile prints, how a picker groups it, when it turns yellow — and the engine
neither renders tiles nor grades them. The drift check still fires when they
change, which is correct: it forces a look at whether the change was
presentational or semantic, rather than assuming.

Drift is caught two ways (see `tests/test_tempo_metrics_drift.py`):
1. Always: a golden test asserts this port matches a hand-verified snapshot
   of the source, catching any transcription error in this file itself.
2. When both repos are checked out together (local dev, or a CI job that
   checks out `dna160/buzzobot` alongside this repo): `CATALOG_SOURCE_SHA256`
   below is compared against a fresh hash of the live `catalog.ts`, so any
   change to the source — not just a mis-port — fails loudly until this
   file and the pin are deliberately updated together.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict

# sha256 of packages/core/src/metrics/catalog.ts in dna160/buzzobot, re-pinned
# at Strategy Report P1 (52 Market Scope keys and the `rank` format added;
# previously Brief Deck M1). Update this (and the entries below) together
# whenever the source file changes — never one without the other.
CATALOG_SOURCE_SHA256 = "08978404dab49da4e9e527329ed60a49da6ad2a44e004d5b41f7e708a4683424"
CATALOG_SOURCE_PATH = "packages/core/src/metrics/catalog.ts"


class DataSurface(str, Enum):
    PAID = "paid"
    ORGANIC = "organic"
    # TikTok Market Scope, mirrored into market_scope_* (Strategy Report PRD §6.5).
    MARKET_SCOPE = "market_scope"


class MetricFormat(str, Enum):
    CURRENCY = "currency"
    NUMBER = "number"
    PERCENT = "percent"
    DURATION = "duration"
    RATIO = "ratio"
    RANK = "rank"


class MetricDirection(str, Enum):
    UP = "up"
    DOWN = "down"
    NEUTRAL = "neutral"


MetricKey = Literal[
    # Paid
    "spend",
    "impressions",
    "clicks",
    "conversions",
    "conversionValue",
    "ctr",
    "cpm",
    "cpc",
    "cpa",
    "conversionRate",
    "roas",
    # Paid video & delivery — added Brief Deck M1, when the deck's KPI grid
    # needed to name the columns the day-grain brief rollup already sums.
    "videoViews",
    "videoWatched6s",
    "engagedView15s",
    "engagements",
    "vtr6s",
    "vtr15s",
    "frequency",
    "cpv",
    # Organic
    "views",
    "likes",
    "comments",
    "shares",
    "reach",
    "newFollowers",
    "engagementRate",
    "avgWatchTimeSec",
]


class MetricDef(BaseModel):
    model_config = ConfigDict(frozen=True)

    key: str
    label: str
    short_label: str
    surface: DataSurface
    format: MetricFormat
    good_direction: MetricDirection
    description: str
    precision: int | None = None


METRICS: dict[str, MetricDef] = {
    "spend": MetricDef(
        key="spend", label="Ad Spend", short_label="Spend", surface=DataSurface.PAID,
        format=MetricFormat.CURRENCY, good_direction=MetricDirection.NEUTRAL,
        description="Total amount invested across paid campaigns.",
    ),
    "impressions": MetricDef(
        key="impressions", label="Impressions", short_label="Impr.", surface=DataSurface.PAID,
        format=MetricFormat.NUMBER, good_direction=MetricDirection.UP,
        description="Number of times ads were served.",
    ),
    "clicks": MetricDef(
        key="clicks", label="Clicks", short_label="Clicks", surface=DataSurface.PAID,
        format=MetricFormat.NUMBER, good_direction=MetricDirection.UP,
        description="Total clicks driven by paid campaigns.",
    ),
    "conversions": MetricDef(
        key="conversions", label="Conversions", short_label="Conv.", surface=DataSurface.PAID,
        format=MetricFormat.NUMBER, good_direction=MetricDirection.UP,
        description="Completed conversion events attributed to ads.",
    ),
    "conversionValue": MetricDef(
        key="conversionValue", label="Conversion Value", short_label="Conv. Value",
        surface=DataSurface.PAID, format=MetricFormat.CURRENCY, good_direction=MetricDirection.UP,
        description="Total revenue attributed to converting clicks.",
    ),
    "ctr": MetricDef(
        key="ctr", label="Click-Through Rate", short_label="CTR", surface=DataSurface.PAID,
        format=MetricFormat.PERCENT, good_direction=MetricDirection.UP,
        description="Clicks divided by impressions.", precision=2,
    ),
    "cpm": MetricDef(
        key="cpm", label="Cost per 1K Impressions", short_label="CPM", surface=DataSurface.PAID,
        format=MetricFormat.CURRENCY, good_direction=MetricDirection.DOWN,
        description="Spend per one thousand impressions.",
    ),
    "cpc": MetricDef(
        key="cpc", label="Cost per Click", short_label="CPC", surface=DataSurface.PAID,
        format=MetricFormat.CURRENCY, good_direction=MetricDirection.DOWN,
        description="Average cost of a single click.", precision=2,
    ),
    "cpa": MetricDef(
        key="cpa", label="Cost per Acquisition", short_label="CPA", surface=DataSurface.PAID,
        format=MetricFormat.CURRENCY, good_direction=MetricDirection.DOWN,
        description="Spend divided by conversions.", precision=2,
    ),
    "conversionRate": MetricDef(
        key="conversionRate", label="Conversion Rate", short_label="CVR", surface=DataSurface.PAID,
        format=MetricFormat.PERCENT, good_direction=MetricDirection.UP,
        description="Conversions divided by clicks.", precision=2,
    ),
    "roas": MetricDef(
        key="roas", label="Return on Ad Spend", short_label="ROAS", surface=DataSurface.PAID,
        format=MetricFormat.RATIO, good_direction=MetricDirection.UP,
        description="Conversion value divided by spend.", precision=2,
    ),
    "videoViews": MetricDef(
        key="videoViews", label="Paid Video Views", short_label="Video Views",
        surface=DataSurface.PAID, format=MetricFormat.NUMBER, good_direction=MetricDirection.UP,
        description="Video views delivered by paid campaigns (distinct from organic `views`).",
    ),
    "videoWatched6s": MetricDef(
        key="videoWatched6s", label="Video Views at 6s", short_label="6s Views",
        surface=DataSurface.PAID, format=MetricFormat.NUMBER, good_direction=MetricDirection.UP,
        description="Paid video views that reached six seconds.",
    ),
    "engagedView15s": MetricDef(
        key="engagedView15s", label="Engaged Views at 15s", short_label="15s Views",
        surface=DataSurface.PAID, format=MetricFormat.NUMBER, good_direction=MetricDirection.UP,
        description="Paid video views that reached fifteen seconds.",
    ),
    "engagements": MetricDef(
        key="engagements", label="Paid Engagements", short_label="Engagements",
        surface=DataSurface.PAID, format=MetricFormat.NUMBER, good_direction=MetricDirection.UP,
        description="Interactions attributed to paid delivery.",
    ),
    "vtr6s": MetricDef(
        key="vtr6s", label="View-Through Rate (6s)", short_label="VTR 6s",
        surface=DataSurface.PAID, format=MetricFormat.PERCENT, good_direction=MetricDirection.UP,
        description="Six-second video views divided by impressions.", precision=2,
    ),
    "vtr15s": MetricDef(
        key="vtr15s", label="View-Through Rate (15s)", short_label="VTR 15s",
        surface=DataSurface.PAID, format=MetricFormat.PERCENT, good_direction=MetricDirection.UP,
        description="Fifteen-second engaged views divided by impressions.", precision=2,
    ),
    "frequency": MetricDef(
        key="frequency", label="Frequency", short_label="Freq.",
        surface=DataSurface.PAID, format=MetricFormat.RATIO, good_direction=MetricDirection.NEUTRAL,
        description="Impressions divided by reach over the window.", precision=2,
    ),
    "cpv": MetricDef(
        key="cpv", label="Cost per Video View", short_label="CPV",
        surface=DataSurface.PAID, format=MetricFormat.CURRENCY, good_direction=MetricDirection.DOWN,
        description="Spend divided by paid video views.", precision=2,
    ),
    "views": MetricDef(
        key="views", label="Video Views", short_label="Views", surface=DataSurface.ORGANIC,
        format=MetricFormat.NUMBER, good_direction=MetricDirection.UP,
        description="Total organic video views.",
    ),
    "likes": MetricDef(
        key="likes", label="Likes", short_label="Likes", surface=DataSurface.ORGANIC,
        format=MetricFormat.NUMBER, good_direction=MetricDirection.UP,
        description="Total likes on organic content.",
    ),
    "comments": MetricDef(
        key="comments", label="Comments", short_label="Comments", surface=DataSurface.ORGANIC,
        format=MetricFormat.NUMBER, good_direction=MetricDirection.UP,
        description="Total comments on organic content.",
    ),
    "shares": MetricDef(
        key="shares", label="Shares", short_label="Shares", surface=DataSurface.ORGANIC,
        format=MetricFormat.NUMBER, good_direction=MetricDirection.UP,
        description="Total shares of organic content.",
    ),
    "reach": MetricDef(
        key="reach", label="Reach", short_label="Reach", surface=DataSurface.ORGANIC,
        format=MetricFormat.NUMBER, good_direction=MetricDirection.UP,
        description=(
            "Unique accounts that saw the content. Also reported for paid delivery, where the "
            "brief window sums it across hourly rows (not deduped — the accepted convention here)."
        ),
    ),
    "newFollowers": MetricDef(
        key="newFollowers", label="New Followers", short_label="Followers", surface=DataSurface.ORGANIC,
        format=MetricFormat.NUMBER, good_direction=MetricDirection.UP,
        description="Net new followers gained in the period.",
    ),
    "engagementRate": MetricDef(
        key="engagementRate", label="Engagement Rate", short_label="Eng. Rate", surface=DataSurface.ORGANIC,
        format=MetricFormat.PERCENT, good_direction=MetricDirection.UP,
        description="(Likes + comments + shares) divided by views.", precision=2,
    ),
    "avgWatchTimeSec": MetricDef(
        key="avgWatchTimeSec", label="Avg. Watch Time", short_label="Watch Time", surface=DataSurface.ORGANIC,
        format=MetricFormat.DURATION, good_direction=MetricDirection.UP,
        description="Average seconds watched per view.", precision=1,
    ),
}


# ─── Market Scope (TTMS) ─────────────────────────────────────────────────────
# Mirrors the generated families in catalog.ts (Strategy Report PRD §6.5 with
# the P0 corrections: `size_ratio` not `move_on_rate`, no per-metric insight
# rank, no cost per new Conversion, neutral content-type shares). Generated
# from the same tables as the source so the two cannot disagree key-by-key;
# the golden test lists every key by hand regardless.

TTMS_STAGES = ("acc", "awareness", "consideration", "conversion")
TTMS_INSIGHT_METRICS = (
    "impressions", "engagements", "video_views_p100", "video_views_6s", "search_volume",
    "likes", "comments", "shares", "clicks", "product_card_clicks", "nsr",
)
TTMS_CONTENT_TYPES = (
    "paid", "non_paid", "ads", "creator_boosted", "creator_organic",
    "bgc_boosted", "bgc_organic", "ugc_boosted", "ugc_organic",
)

_STAGE_NAME = {"acc": "ACC", "awareness": "Awareness", "consideration": "Consideration", "conversion": "Conversion"}

# metric -> (label, short_label, format)
_INSIGHT: dict[str, tuple[str, str, MetricFormat]] = {
    "impressions": ("Brand Impressions", "Impr.", MetricFormat.NUMBER),
    "engagements": ("Brand Engagements", "Eng.", MetricFormat.NUMBER),
    "video_views_p100": ("Brand Video Views (100%)", "100% Views", MetricFormat.NUMBER),
    "video_views_6s": ("Brand Video Views (6s)", "6s Views", MetricFormat.NUMBER),
    "search_volume": ("Brand Search Volume", "Search", MetricFormat.NUMBER),
    "likes": ("Brand Likes", "Likes", MetricFormat.NUMBER),
    "comments": ("Brand Comments", "Comments", MetricFormat.NUMBER),
    "shares": ("Brand Shares", "Shares", MetricFormat.NUMBER),
    "clicks": ("Brand Clicks", "Clicks", MetricFormat.NUMBER),
    "product_card_clicks": ("Product Card Clicks", "Card Clicks", MetricFormat.NUMBER),
    "nsr": ("Net Sentiment Rate", "NSR", MetricFormat.RATIO),
}

_CONTENT_LABEL = {
    "paid": "Paid content", "non_paid": "Non-paid content", "ads": "Ads",
    "creator_boosted": "Creator content, boosted", "creator_organic": "Creator content, organic",
    "bgc_boosted": "Brand content, boosted", "bgc_organic": "Brand content, organic",
    "ugc_boosted": "User content, boosted", "ugc_organic": "User content, organic",
}


def _ms(
    key: str, label: str, short_label: str, fmt: MetricFormat, direction: MetricDirection,
    description: str, precision: int | None = None,
) -> tuple[str, MetricDef]:
    return key, MetricDef(
        key=key, label=label, short_label=short_label, surface=DataSurface.MARKET_SCOPE,
        format=fmt, good_direction=direction, description=description, precision=precision,
    )


def _market_scope_metrics() -> dict[str, MetricDef]:
    up, down, neutral = MetricDirection.UP, MetricDirection.DOWN, MetricDirection.NEUTRAL
    out: list[tuple[str, MetricDef]] = []
    for s in TTMS_STAGES:
        n = _STAGE_NAME[s]
        out += [
            _ms(f"ttms.audience.{s}.total", f"{n} Audience", n, MetricFormat.NUMBER, up,
                f"People in the brand's {n} stage on the day (TTMS, rolling window; a stock, not a flow)."),
            _ms(f"ttms.audience.{s}.new", f"New {n} Audience", f"New {n}", MetricFormat.NUMBER, up,
                f"People in the {n} stage today but not yesterday, summed over the period."),
            _ms(f"ttms.audience.{s}.outflow", f"{n} Outflow", f"{n} out", MetricFormat.NUMBER, down,
                f"People in the {n} stage yesterday but not today, summed over the period."),
            _ms(f"ttms.audience.{s}.rank", f"{n} Rank", "Rank", MetricFormat.RANK, down,
                f"Position in the TTMS ranking list for the {n} stage (ties share a rank)."),
        ]
    out += [
        _ms("ttms.audience.awareness.size_ratio", "Consideration ÷ Awareness Size", "Cons./Aw.",
            MetricFormat.PERCENT, up,
            "Consideration audience ÷ Awareness audience on the same day. A ratio of two stocks — "
            "never a share of people moving on.", 1),
        _ms("ttms.audience.consideration.size_ratio", "Conversion ÷ Consideration Size", "Conv./Cons.",
            MetricFormat.PERCENT, up,
            "Conversion audience ÷ Consideration audience on the same day. Can exceed 100% — the stages "
            "use different windows.", 1),
    ]
    for m in TTMS_INSIGHT_METRICS:
        label, short, fmt = _INSIGHT[m]
        out.append(_ms(f"ttms.{m}", label, short, fmt, up,
                       f"{label} on content mentioning the brand (TTMS brand insights, all content types).",
                       2 if m == "nsr" else None))
        if m != "nsr":
            out.append(_ms(f"ttms.{m}.share", f"{label} Share of Category", f"{short} share",
                           MetricFormat.PERCENT, up,
                           f"The brand's {label.lower()} ÷ the whole vertical's, over the period.", 2))
    for c in TTMS_CONTENT_TYPES:
        label = _CONTENT_LABEL[c]
        out.append(_ms(f"ttms.impressions.share.{c}", f"Impressions Share: {label}", label,
                       MetricFormat.PERCENT, neutral,
                       f"Impressions from {label.lower()} ÷ all brand impressions. Only paid + non-paid add up "
                       "to 100%; the other content types overlap and are never summed or stacked.", 1))
    out += [
        _ms("ttms.halo_ratio", "Earned Halo", "Halo", MetricFormat.RATIO, up,
            "Non-paid impressions ÷ paid impressions on content mentioning the brand.", 2),
        _ms("strategy.cost_per_1k_new.awareness", "Cost per 1K New Awareness", "Cost/1K new Aw.",
            MetricFormat.CURRENCY, down,
            'Ad spend ÷ new Awareness audience × 1,000. TTMS "new" counts paid and organic entrants alike.'),
        _ms("strategy.cost_per_1k_new.consideration", "Cost per 1K New Consideration", "Cost/1K new Cons.",
            MetricFormat.CURRENCY, down,
            'Ad spend ÷ new Consideration audience × 1,000. TTMS "new" counts paid and organic entrants alike.'),
        _ms("strategy.spend_cap_daily", "Suggested Daily Spend Cap", "Daily cap", MetricFormat.CURRENCY, neutral,
            "Daily spend above which new Consideration per rupiah falls off — shown only when the fit passes "
            "its gate."),
    ]
    return dict(out)


METRICS.update(_market_scope_metrics())


def metrics_by_surface(surface: DataSurface) -> list[MetricDef]:
    return [m for m in METRICS.values() if m.surface == surface]
