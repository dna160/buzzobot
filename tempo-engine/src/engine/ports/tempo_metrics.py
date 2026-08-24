"""Versioned Python port of `@tempo/core`'s METRICS catalog
(`packages/core/src/metrics/catalog.ts` in `dna160/buzzobot`).

Per the boundary contract (PRD §1, rule 3): "The engine never re-derives a
metric Tempo already defines. It calls a thin port over `@tempo/core`'s
METRICS catalog semantics... with a CI check that fails on drift." This is
that port. A generator that needs a metric's label, format, or "which
direction is good" reads it from here — never redefines it.

Ported only `'paid'` and `'organic'` surfaces exist in the source
(`DataSurface` in `packages/core/src/domain/enums.ts` has no `'shop'` or
`'market_scope'` value) — there is no separate Shop or Market Scope metric
set to port, because none exists in Tempo today. See
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
# at Brief Deck M1 (8 paid video/delivery keys added, plus the deck-only
# presentation fields noted above). Update this (and
# the entries below) together whenever the source file changes — never one
# without the other.
CATALOG_SOURCE_SHA256 = "8eebf94b6a69081890337eea26088d68e013b9c5d72d6335f7d6b688fcc10aee"
CATALOG_SOURCE_PATH = "packages/core/src/metrics/catalog.ts"


class DataSurface(str, Enum):
    PAID = "paid"
    ORGANIC = "organic"


class MetricFormat(str, Enum):
    CURRENCY = "currency"
    NUMBER = "number"
    PERCENT = "percent"
    DURATION = "duration"
    RATIO = "ratio"


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


METRICS: dict[MetricKey, MetricDef] = {
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


def metrics_by_surface(surface: DataSurface) -> list[MetricDef]:
    return [m for m in METRICS.values() if m.surface == surface]
