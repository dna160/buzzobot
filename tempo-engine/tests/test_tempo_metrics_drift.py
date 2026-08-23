"""PRD §1 rule 3: "a CI check that fails on drift" between this port and
`@tempo/core`'s METRICS catalog. Two layers:

1. A golden test (always runs, no dependency on Tempo being checked out):
   catches any transcription error in `tempo_metrics.py` itself against a
   hand-verified snapshot of every field.
2. A live-hash test (skipped unless the Tempo repo is findable): computes
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
    "avgWatchTimeSec": (
        "Avg. Watch Time", "Watch Time", DataSurface.ORGANIC, MetricFormat.DURATION, MetricDirection.UP, 1,
    ),
}


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
        "../Tempo LM",  # sibling checkout, the common local-dev layout
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
