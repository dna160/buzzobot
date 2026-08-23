"""Concrete `ObjectiveContract` instances, one per brief type. Install is
added at B10.

GMV's metric tiers match exactly what `tempo_read.py` can supply from
`paid_hourly_metrics`: impressions/clicks/orders/gmv/cost/roi are always
present; ctr/cvr/aov are derived and only present when their denominator is
nonzero (PREFERRED, not REQUIRED).

Awareness (B9) is built against the same table's awareness-surface columns
(`reach`, `video_watched_6s`, `engaged_view_15s`) — see
`ports/tempo_read.py::build_awareness_metric_frame`'s module docstring for
the full accounting of what PRD §6.2's Awareness row does and doesn't match
in Tempo's live schema.

`efficiency_metric` is deliberately `qualified_reach_per_cost`, not the
PRD's literal "CPM / Cost per Qualified Reach" (a cost-denominated, lower-
is-better figure): G02 (Efficiency Outlier) has one hard-coded polarity —
`z > 0` is always labeled the *positive* direction — proven correct for
GMV's `roi` (higher is better) but silently wrong for a cost-per-outcome
metric, where a high z-score means "expensive," not "efficient." Storing
the reciprocal (higher = better, matching ROI's own polarity) is the fix
that keeps G02 generic across contracts without adding a per-contract
direction flag to a shared generator. `cost_per_qualified_reach` and `cpm`
are still computed and exposed as core metrics for evidence/narration.
"""

from __future__ import annotations

from engine.contracts.metric_frame import BriefType
from engine.contracts.objective import IdentityEquation, MetricAvailability, MetricTier, ObjectiveContract

GMV_OBJECTIVE_CONTRACT = ObjectiveContract(
    brief_type="gmv",
    primary_outcome="gmv",
    efficiency_metric="roi",
    identity_chain=[
        IdentityEquation(outcome="clicks", factors=["impressions", "ctr"]),
        IdentityEquation(outcome="orders", factors=["clicks", "cvr"]),
        IdentityEquation(outcome="gmv", factors=["orders", "aov"]),
    ],
    core_metrics=["impressions", "clicks", "ctr", "cvr", "orders", "aov", "gmv", "cost", "roi"],
    entity_axes=["campaign_type", "product", "creator", "session", "adgroup"],
    metric_tiers=[
        MetricTier(metric="impressions", availability=MetricAvailability.REQUIRED),
        MetricTier(metric="clicks", availability=MetricAvailability.REQUIRED),
        MetricTier(metric="orders", availability=MetricAvailability.REQUIRED),
        MetricTier(metric="gmv", availability=MetricAvailability.REQUIRED),
        MetricTier(metric="cost", availability=MetricAvailability.REQUIRED),
        MetricTier(metric="roi", availability=MetricAvailability.REQUIRED),
        MetricTier(metric="ctr", availability=MetricAvailability.PREFERRED),
        MetricTier(metric="cvr", availability=MetricAvailability.PREFERRED),
        MetricTier(metric="aov", availability=MetricAvailability.PREFERRED),
    ],
    waste_definition="spend with 0 orders; live sessions absorbing budget at 0 conversion",
    additivity_trap="ROI is a ratio, never averaged — always recomputed from summed GMV / summed cost.",
)

AWARENESS_OBJECTIVE_CONTRACT = ObjectiveContract(
    brief_type="awareness",
    primary_outcome="qualified_reach",
    efficiency_metric="qualified_reach_per_cost",
    identity_chain=[
        IdentityEquation(outcome="impressions", factors=["reach", "frequency"]),
        IdentityEquation(outcome="qualified_reach", factors=["reach", "vtr6s"]),
    ],
    core_metrics=[
        "impressions", "reach", "frequency", "vtr6s", "vtr15s", "qualified_reach",
        "cost", "cpm", "cost_per_qualified_reach", "qualified_reach_per_cost",
    ],
    # PRD §6.2 lists placement/audience/creative/format/daypart — none of these
    # are columns in Tempo's live schema (verified against packages/db/src/
    # schema.ts); campaign/adgroup are the only axes tempo_read.py can
    # actually populate today, same documented gap GMV's own entity_axes has
    # for creator/session/product on live (non-fixture) data.
    entity_axes=["campaign", "adgroup"],
    metric_tiers=[
        MetricTier(metric="impressions", availability=MetricAvailability.REQUIRED),
        MetricTier(metric="reach", availability=MetricAvailability.REQUIRED),
        MetricTier(metric="cost", availability=MetricAvailability.REQUIRED),
        MetricTier(metric="frequency", availability=MetricAvailability.PREFERRED),
        MetricTier(metric="vtr6s", availability=MetricAvailability.PREFERRED),
        MetricTier(metric="vtr15s", availability=MetricAvailability.PREFERRED),
        MetricTier(metric="qualified_reach", availability=MetricAvailability.PREFERRED),
        MetricTier(metric="cpm", availability=MetricAvailability.PREFERRED),
        MetricTier(metric="cost_per_qualified_reach", availability=MetricAvailability.PREFERRED),
        MetricTier(metric="qualified_reach_per_cost", availability=MetricAvailability.PREFERRED),
    ],
    waste_definition="frequency above cap with no offsetting qualified-reach gain; spend at VTR6s ≈ 0",
    additivity_trap=(
        "reach is non-additive — campaign-level reach as reported by TikTok is NOT the sum of its "
        "adgroups' reach (cross-adgroup audience overlap is deduped at campaign grain, not by "
        "summing), and there is no ad-account-level deduped reach reported by TikTok at all. Account-"
        "level reach in this engine is a SUM of campaign-level reach — an overlap-inflated upper "
        "bound, not true deduped reach; every account-level Finding using it carries that caveat."
    ),
)

INSTALL_OBJECTIVE_CONTRACT = ObjectiveContract(
    brief_type="install",
    primary_outcome="installs",
    efficiency_metric="installs_per_cost",
    identity_chain=[
        IdentityEquation(outcome="clicks", factors=["impressions", "ctr"]),
        IdentityEquation(outcome="installs", factors=["clicks", "ir"]),
    ],
    core_metrics=["impressions", "clicks", "ctr", "ir", "installs", "cost", "cpi", "installs_per_cost"],
    # Same aspirational-vs-live-adapter gap as GMV/Awareness: PRD §6.2 lists
    # channel/campaign/creative/device/OS/geo, but Tempo's schema (verified
    # against packages/db/src/schema.ts) has none of device/OS/geo/channel/
    # creative as columns anywhere — campaign/adgroup are what the live
    # adapter actually populates.
    entity_axes=["channel", "campaign", "creative", "device", "os", "geo"],
    metric_tiers=[
        MetricTier(metric="impressions", availability=MetricAvailability.REQUIRED),
        MetricTier(metric="clicks", availability=MetricAvailability.REQUIRED),
        MetricTier(metric="installs", availability=MetricAvailability.REQUIRED),
        MetricTier(metric="cost", availability=MetricAvailability.REQUIRED),
        MetricTier(metric="ctr", availability=MetricAvailability.PREFERRED),
        MetricTier(metric="ir", availability=MetricAvailability.PREFERRED),
        MetricTier(metric="cpi", availability=MetricAvailability.PREFERRED),
        MetricTier(metric="installs_per_cost", availability=MetricAvailability.PREFERRED),
    ],
    waste_definition=(
        "spend with 0 clicks (dead delivery, caught by G04's generic zero-yield rule since the "
        "install funnel has no deeper count factor than clicks); clicks with 0 installs (the real "
        "click-to-install funnel leak — see N01, install-specific because G04 can't see past "
        "'clicks' for this contract); anomalous CTR/IR clusters (see N04, flagged not asserted)."
    ),
    additivity_trap=(
        "CPI is a ratio, never averaged — always recomputed from summed cost / summed installs. "
        "PRD's 'Activated Installs' / 'ActRate' concept (a post-install activation or retention "
        "event) does not exist anywhere in Tempo's schema — `conversions` is a single generic "
        "platform-reported event (installs, for an 'app_install' client; verified live against the "
        "'treasury' client: conversion_value is always 0, and paid_hourly_metrics has no second "
        "conversion-stage column at all). Every generator here targets raw installs, never a "
        "fabricated 'activation' figure."
    ),
)

OBJECTIVE_CONTRACTS: dict[BriefType, ObjectiveContract] = {
    "gmv": GMV_OBJECTIVE_CONTRACT,
    "awareness": AWARENESS_OBJECTIVE_CONTRACT,
    "install": INSTALL_OBJECTIVE_CONTRACT,
}
