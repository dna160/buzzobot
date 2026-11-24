"""PRD §1 rule 3: "a CI check that fails on drift" between this port and
`@tempo/core`'s METRICS catalog. Two layers:

1. A golden test (always runs, no dependency on Tempo being checked out):
   catches any transcription error in `tempo_metrics.py` itself against a
   hand-verified snapshot of every field.
2. A live-hash test (now effectively always, since the two projects are
   co-located — see `_find_tempo_repo`): computes
   sha256 of the actual `catalog.ts` and compares it to the pinned constant
   in `tempo_metrics.py`. Any change to the source — not just a mis-port —
   fails this until the port and the pin are updated together.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import pytest

from engine.ports.tempo_metrics import (
    CATALOG_SOURCE_PATH,
    CATALOG_SOURCE_SHA256,
    METRICS,
    DataSurface,
    MetricDirection,
    MetricFormat,
)

# Hand-verified against packages/core/src/metrics/catalog.ts, field for field.
_EXPECTED = {
    "spend": ("Ad Spend", "Spend", DataSurface.PAID, MetricFormat.CURRENCY, MetricDirection.NEUTRAL, None),
    "impressions": ("Impressions", "Impr.", DataSurface.PAID, MetricFormat.NUMBER, MetricDirection.UP, None),
    "clicks": ("Clicks", "Clicks", DataSurface.PAID, MetricFormat.NUMBER, MetricDirection.UP, None),
    "conversions": ("Conversions", "Conv.", DataSurface.PAID, MetricFormat.NUMBER, MetricDirection.UP, None),
    "conversionValue": (
        "Conversion Value", "Conv. Value", DataSurface.PAID, MetricFormat.CURRENCY, MetricDirection.UP, None,
    ),
    "ctr": ("Click-Through Rate", "CTR", DataSurface.PAID, MetricFormat.PERCENT, MetricDirection.UP, 2),
    "cpm": ("Cost per 1K Impressions", "CPM", DataSurface.PAID, MetricFormat.CURRENCY, MetricDirection.DOWN, None),
    "cpc": ("Cost per Click", "CPC", DataSurface.PAID, MetricFormat.CURRENCY, MetricDirection.DOWN, 2),
    "cpa": ("Cost per Acquisition", "CPA", DataSurface.PAID, MetricFormat.CURRENCY, MetricDirection.DOWN, 2),
    "conversionRate": ("Conversion Rate", "CVR", DataSurface.PAID, MetricFormat.PERCENT, MetricDirection.UP, 2),
    "roas": ("Return on Ad Spend", "ROAS", DataSurface.PAID, MetricFormat.RATIO, MetricDirection.UP, 2),
    "views": ("Video Views", "Views", DataSurface.ORGANIC, MetricFormat.NUMBER, MetricDirection.UP, None),
    "likes": ("Likes", "Likes", DataSurface.ORGANIC, MetricFormat.NUMBER, MetricDirection.UP, None),
    "comments": ("Comments", "Comments", DataSurface.ORGANIC, MetricFormat.NUMBER, MetricDirection.UP, None),
    "shares": ("Shares", "Shares", DataSurface.ORGANIC, MetricFormat.NUMBER, MetricDirection.UP, None),
    "reach": ("Reach", "Reach", DataSurface.ORGANIC, MetricFormat.NUMBER, MetricDirection.UP, None),
    "newFollowers": (
        "New Followers", "Followers", DataSurface.ORGANIC, MetricFormat.NUMBER, MetricDirection.UP, None,
    ),
    "engagementRate": (
        "Engagement Rate", "Eng. Rate", DataSurface.ORGANIC, MetricFormat.PERCENT, MetricDirection.UP, 2,
    ),
    # Paid video & delivery (Brief Deck M1).
    "videoViews": ("Paid Video Views", "Video Views", DataSurface.PAID, MetricFormat.NUMBER, MetricDirection.UP, None),
    "videoWatched6s": ("Video Views at 6s", "6s Views", DataSurface.PAID, MetricFormat.NUMBER, MetricDirection.UP, None),
    "engagedView15s": (
        "Engaged Views at 15s", "15s Views", DataSurface.PAID, MetricFormat.NUMBER, MetricDirection.UP, None,
    ),
    "engagements": ("Paid Engagements", "Engagements", DataSurface.PAID, MetricFormat.NUMBER, MetricDirection.UP, None),
    "vtr6s": ("View-Through Rate (6s)", "VTR 6s", DataSurface.PAID, MetricFormat.PERCENT, MetricDirection.UP, 2),
    "vtr15s": ("View-Through Rate (15s)", "VTR 15s", DataSurface.PAID, MetricFormat.PERCENT, MetricDirection.UP, 2),
    "frequency": ("Frequency", "Freq.", DataSurface.PAID, MetricFormat.RATIO, MetricDirection.NEUTRAL, 2),
    "cpv": ("Cost per Video View", "CPV", DataSurface.PAID, MetricFormat.CURRENCY, MetricDirection.DOWN, 2),
    "avgWatchTimeSec": (
        "Avg. Watch Time", "Watch Time", DataSurface.ORGANIC, MetricFormat.DURATION, MetricDirection.UP, 1,
    ),
}

# Market Scope (Strategy Report P1), written out key by key — not generated —
# so a slip in the port's generator shows up here.
_MS, _N, _P, _R, _C, _RK = (
    DataSurface.MARKET_SCOPE, MetricFormat.NUMBER, MetricFormat.PERCENT, MetricFormat.RATIO,
    MetricFormat.CURRENCY, MetricFormat.RANK,
)
_UP, _DOWN, _NEUTRAL = MetricDirection.UP, MetricDirection.DOWN, MetricDirection.NEUTRAL
_EXPECTED.update({
    "ttms.audience.acc.total": ("ACC Audience", "ACC", _MS, _N, _UP, None),
    "ttms.audience.acc.new": ("New ACC Audience", "New ACC", _MS, _N, _UP, None),
    "ttms.audience.acc.outflow": ("ACC Outflow", "ACC out", _MS, _N, _DOWN, None),
    "ttms.audience.acc.rank": ("ACC Rank", "Rank", _MS, _RK, _DOWN, None),
    "ttms.audience.awareness.total": ("Awareness Audience", "Awareness", _MS, _N, _UP, None),
    "ttms.audience.awareness.new": ("New Awareness Audience", "New Awareness", _MS, _N, _UP, None),
    "ttms.audience.awareness.outflow": ("Awareness Outflow", "Awareness out", _MS, _N, _DOWN, None),
    "ttms.audience.awareness.rank": ("Awareness Rank", "Rank", _MS, _RK, _DOWN, None),
    "ttms.audience.consideration.total": ("Consideration Audience", "Consideration", _MS, _N, _UP, None),
    "ttms.audience.consideration.new": ("New Consideration Audience", "New Consideration", _MS, _N, _UP, None),
    "ttms.audience.consideration.outflow": ("Consideration Outflow", "Consideration out", _MS, _N, _DOWN, None),
    "ttms.audience.consideration.rank": ("Consideration Rank", "Rank", _MS, _RK, _DOWN, None),
    "ttms.audience.conversion.total": ("Conversion Audience", "Conversion", _MS, _N, _UP, None),
    "ttms.audience.conversion.new": ("New Conversion Audience", "New Conversion", _MS, _N, _UP, None),
    "ttms.audience.conversion.outflow": ("Conversion Outflow", "Conversion out", _MS, _N, _DOWN, None),
    "ttms.audience.conversion.rank": ("Conversion Rank", "Rank", _MS, _RK, _DOWN, None),
    "ttms.audience.awareness.size_ratio": ("Consideration ÷ Awareness Size", "Cons./Aw.", _MS, _P, _UP, 1),
    "ttms.audience.consideration.size_ratio": ("Conversion ÷ Consideration Size", "Conv./Cons.", _MS, _P, _UP, 1),
    "ttms.impressions": ("Brand Impressions", "Impr.", _MS, _N, _UP, None),
    "ttms.impressions.share": ("Brand Impressions Share of Category", "Impr. share", _MS, _P, _UP, 2),
    "ttms.engagements": ("Brand Engagements", "Eng.", _MS, _N, _UP, None),
    "ttms.engagements.share": ("Brand Engagements Share of Category", "Eng. share", _MS, _P, _UP, 2),
    "ttms.video_views_p100": ("Brand Video Views (100%)", "100% Views", _MS, _N, _UP, None),
    "ttms.video_views_p100.share": ("Brand Video Views (100%) Share of Category", "100% Views share", _MS, _P, _UP, 2),
    "ttms.video_views_6s": ("Brand Video Views (6s)", "6s Views", _MS, _N, _UP, None),
    "ttms.video_views_6s.share": ("Brand Video Views (6s) Share of Category", "6s Views share", _MS, _P, _UP, 2),
    "ttms.search_volume": ("Brand Search Volume", "Search", _MS, _N, _UP, None),
    "ttms.search_volume.share": ("Brand Search Volume Share of Category", "Search share", _MS, _P, _UP, 2),
    "ttms.likes": ("Brand Likes", "Likes", _MS, _N, _UP, None),
    "ttms.likes.share": ("Brand Likes Share of Category", "Likes share", _MS, _P, _UP, 2),
    "ttms.comments": ("Brand Comments", "Comments", _MS, _N, _UP, None),
    "ttms.comments.share": ("Brand Comments Share of Category", "Comments share", _MS, _P, _UP, 2),
    "ttms.shares": ("Brand Shares", "Shares", _MS, _N, _UP, None),
    "ttms.shares.share": ("Brand Shares Share of Category", "Shares share", _MS, _P, _UP, 2),
    "ttms.clicks": ("Brand Clicks", "Clicks", _MS, _N, _UP, None),
    "ttms.clicks.share": ("Brand Clicks Share of Category", "Clicks share", _MS, _P, _UP, 2),
    "ttms.product_card_clicks": ("Product Card Clicks", "Card Clicks", _MS, _N, _UP, None),
    "ttms.product_card_clicks.share": ("Product Card Clicks Share of Category", "Card Clicks share", _MS, _P, _UP, 2),
    "ttms.nsr": ("Net Sentiment Rate", "NSR", _MS, _R, _UP, 2),
    "ttms.impressions.share.paid": ("Impressions Share: Paid content", "Paid content", _MS, _P, _NEUTRAL, 1),
    "ttms.impressions.share.non_paid": ("Impressions Share: Non-paid content", "Non-paid content", _MS, _P, _NEUTRAL, 1),
    "ttms.impressions.share.ads": ("Impressions Share: Ads", "Ads", _MS, _P, _NEUTRAL, 1),
    "ttms.impressions.share.creator_boosted": (
        "Impressions Share: Creator content, boosted", "Creator content, boosted", _MS, _P, _NEUTRAL, 1,
    ),
    "ttms.impressions.share.creator_organic": (
        "Impressions Share: Creator content, organic", "Creator content, organic", _MS, _P, _NEUTRAL, 1,
    ),
    "ttms.impressions.share.bgc_boosted": (
        "Impressions Share: Brand content, boosted", "Brand content, boosted", _MS, _P, _NEUTRAL, 1,
    ),
    "ttms.impressions.share.bgc_organic": (
        "Impressions Share: Brand content, organic", "Brand content, organic", _MS, _P, _NEUTRAL, 1,
    ),
    "ttms.impressions.share.ugc_boosted": (
        "Impressions Share: User content, boosted", "User content, boosted", _MS, _P, _NEUTRAL, 1,
    ),
    "ttms.impressions.share.ugc_organic": (
        "Impressions Share: User content, organic", "User content, organic", _MS, _P, _NEUTRAL, 1,
    ),
    "ttms.halo_ratio": ("Earned Halo", "Halo", _MS, _R, _UP, 2),
    "strategy.cost_per_1k_new.awareness": ("Cost per 1K New Awareness", "Cost/1K new Aw.", _MS, _C, _DOWN, None),
    "strategy.cost_per_1k_new.consideration": (
        "Cost per 1K New Consideration", "Cost/1K new Cons.", _MS, _C, _DOWN, None,
    ),
    "strategy.spend_cap_daily": ("Suggested Daily Spend Cap", "Daily cap", _MS, _C, _NEUTRAL, None),
})


def test_port_has_exactly_the_expected_keys() -> None:
    assert set(METRICS.keys()) == set(_EXPECTED.keys())


@pytest.mark.parametrize("key", list(_EXPECTED.keys()))
def test_port_field_values_match_golden_snapshot(key: str) -> None:
    label, short_label, surface, fmt, direction, precision = _EXPECTED[key]
    m = METRICS[key]
    assert m.key == key
    assert m.label == label
    assert m.short_label == short_label
    assert m.surface == surface
    assert m.format == fmt
    assert m.good_direction == direction
    assert m.precision == precision


def _find_tempo_repo() -> Path | None:
    candidates = [
        os.environ.get("TEMPO_REPO_PATH"),
        # Co-located: tempo-engine/ now lives inside dna160/buzzobot, so the
        # repo root is this file's great-grandparent. That makes the live-hash
        # half of this check run everywhere — including CI — instead of
        # skipping unless someone happened to have both checkouts side by side.
        str(Path(__file__).resolve().parents[2]),
        "../Tempo LM",  # sibling checkout, the older local-dev layout
    ]
    for c in candidates:
        if not c:
            continue
        path = Path(c) / CATALOG_SOURCE_PATH
        if path.is_file():
            return path
    return None


def test_source_hash_matches_pin_when_tempo_repo_available() -> None:
    source = _find_tempo_repo()
    if source is None:
        pytest.skip("Tempo repo not found locally (set TEMPO_REPO_PATH to enable this check)")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    assert digest == CATALOG_SOURCE_SHA256, (
        "catalog.ts has changed since this port was written — update tempo_metrics.py "
        "and CATALOG_SOURCE_SHA256 together, then re-pin"
    )
