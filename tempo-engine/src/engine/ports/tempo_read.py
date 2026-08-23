"""Read-only access to Tempo's Postgres (`public.*` in the `tempo` database —
see the note on schema naming below). This is the *only* module in the
engine that imports asyncpg against Tempo; every generator, agent, and graph
node reaches Tempo's data through the typed functions here, never through a
raw connection of its own.

**Schema-naming note**: the PRD's boundary diagram refers to `tempo.*` as
shorthand for "Tempo's tables." Verified against the live schema
(`packages/db/src/schema.ts` in `dna160/buzzobot`): there is no Postgres
*schema* literally named `tempo` — `pgSchema()` is never used, so every
table lives in the default `public` schema of a Postgres *database* that
happens to be named `tempo`. The read-only role below is therefore granted
`SELECT` on `public.*` in that database, and the engine's own tables live in
a real `insight` schema in the same database (see `migrations/`). This is
the corrected reading of PRD §1's diagram, not a deviation from it.

**Data-reality rules this module's queries must never violate (PRD §3.1)**:
- Campaign-level rows (`adgroup_id IS NULL`) and adgroup-level rows
  (`adgroup_id IS NOT NULL`) are parallel decompositions of the same
  activity, never additive — every query here filters on one or the other
  explicitly, never mixes them in a single SUM.
- `reach` is non-additive across adgroups; summing it there is a build
  failure, not a style note (property-tested — see `tests/test_data_reality.py`).
  `build_awareness_metric_frame` (B9) fetches `reach` only at the entity
  level TikTok itself reports it (campaign-level rows and adgroup-level rows
  independently, never one `SUM()`ed out of the other) — GMV's functions
  never touch `reach` at all. Reach IS summed across hourly rows to reach
  day/window grain, matching Tempo's own shipped `daily-brief.ts` convention
  (`acc.reach += r.reach`) — not a deduped figure, but the accepted one.
- Ratios (ROI, CTR, CVR, ...) are always derived from summed numerators and
  denominators in Python, never averaged in SQL or elsewhere — see
  `_derive_gmv_metrics`.
- `span_hours > 1` rows are the first-synced bucket of a day and correctly
  belong in a day/window total (they are real accumulated activity) — the
  trap is only in treating one as a single *hour* in an hourly series. Every
  aggregation in this module is at day/window grain, never hourly, so this
  does not apply here; flagged for whoever adds hourly granularity later.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import asyncpg

DEFAULT_WINDOW_DAYS = 7


def parse_database_url(url: str) -> dict[str, str | int]:
    """Parse `postgres://user:password@host:port/db`, tolerating an
    unescaped `@` in the password (Tempo's own `.env` has one) by splitting
    on the *last* `@` rather than the first."""
    if "://" not in url:
        raise ValueError(f"not a postgres URL: {url!r}")
    _, rest = url.split("://", 1)
    userinfo, hostinfo = rest.rsplit("@", 1)
    user, _, password = userinfo.partition(":")
    host_port, _, database = hostinfo.partition("/")
    host, _, port = host_port.partition(":")
    return {
        "user": user,
        "password": password,
        "host": host,
        "port": int(port) if port else 5432,
        "database": database.split("?", 1)[0] or "postgres",
    }


async def connect(database_url: str) -> asyncpg.Connection:
    return await asyncpg.connect(**parse_database_url(database_url))


@dataclass(frozen=True)
class TempoClient:
    id: str
    name: str
    slug: str
    currency: str
    timezone: str
    north_star: str


async def fetch_client(conn: asyncpg.Connection, slug: str) -> TempoClient | None:
    row = await conn.fetchrow(
        "SELECT id::text, name, slug, currency, timezone, north_star FROM clients WHERE slug = $1",
        slug,
    )
    return TempoClient(**dict(row)) if row else None


async def fetch_available_dates(conn: asyncpg.Connection, client_id: str) -> list[date]:
    rows = await conn.fetch(
        """
        SELECT DISTINCT ph.date
        FROM paid_hourly_metrics ph
        JOIN campaigns c ON c.id = ph.campaign_id
        JOIN tiktok_accounts a ON a.id = c.account_id
        WHERE a.client_id = $1::uuid
        ORDER BY ph.date
        """,
        client_id,
    )
    return [r["date"] for r in rows]


@dataclass(frozen=True)
class RollupRow:
    day: date
    campaign_id: str
    campaign_name: str
    adgroup_id: str | None
    adgroup_name: str | None
    spend: float
    impressions: int
    clicks: int
    conversions: int
    conversion_value: float


async def fetch_paid_rollup(
    conn: asyncpg.Connection, client_id: str, start: date, end: date
) -> list[RollupRow]:
    """Day-grain sums per (campaign, adgroup-or-null), never per hour — see
    the module docstring's `span_hours` note for why that grain is safe."""
    rows = await conn.fetch(
        """
        SELECT
          ph.date AS day,
          ph.campaign_id::text AS campaign_id,
          c.name AS campaign_name,
          ph.adgroup_id::text AS adgroup_id,
          ag.name AS adgroup_name,
          SUM(ph.spend) AS spend,
          SUM(ph.impressions) AS impressions,
          SUM(ph.clicks) AS clicks,
          SUM(ph.conversions) AS conversions,
          SUM(ph.conversion_value) AS conversion_value
        FROM paid_hourly_metrics ph
        JOIN campaigns c ON c.id = ph.campaign_id
        JOIN tiktok_accounts a ON a.id = c.account_id
        LEFT JOIN adgroups ag ON ag.id = ph.adgroup_id
        WHERE a.client_id = $1::uuid AND ph.date BETWEEN $2 AND $3
        GROUP BY ph.date, ph.campaign_id, c.name, ph.adgroup_id, ag.name
        ORDER BY ph.date
        """,
        client_id,
        start,
        end,
    )
    return [
        RollupRow(
            day=r["day"],
            campaign_id=r["campaign_id"],
            campaign_name=r["campaign_name"],
            adgroup_id=r["adgroup_id"],
            adgroup_name=r["adgroup_name"],
            spend=float(r["spend"]),
            impressions=int(r["impressions"]),
            clicks=int(r["clicks"]),
            conversions=int(r["conversions"]),
            conversion_value=float(r["conversion_value"]),
        )
        for r in rows
    ]


@dataclass(frozen=True)
class AwarenessRollupRow:
    day: date
    campaign_id: str
    campaign_name: str
    adgroup_id: str | None
    adgroup_name: str | None
    spend: float
    impressions: int
    reach: int
    video_watched_6s: int
    engaged_view_15s: int


async def fetch_paid_awareness_rollup(
    conn: asyncpg.Connection, client_id: str, start: date, end: date
) -> list[AwarenessRollupRow]:
    """Day-grain sums of `paid_hourly_metrics`' awareness-surface columns
    (`reach`, `video_watched_6s`, `engaged_view_15s`) — parallel to
    `fetch_paid_rollup`'s GMV-surface columns, kept as a separate query
    rather than widening the existing one so GMV's already-proven query and
    its B2 tests are untouched. Same day/window grain rule applies (see the
    module docstring's `span_hours` note): never fetched or summed hourly.
    """
    rows = await conn.fetch(
        """
        SELECT
          ph.date AS day,
          ph.campaign_id::text AS campaign_id,
          c.name AS campaign_name,
          ph.adgroup_id::text AS adgroup_id,
          ag.name AS adgroup_name,
          SUM(ph.spend) AS spend,
          SUM(ph.impressions) AS impressions,
          SUM(ph.reach) AS reach,
          SUM(ph.video_watched_6s) AS video_watched_6s,
          SUM(ph.engaged_view_15s) AS engaged_view_15s
        FROM paid_hourly_metrics ph
        JOIN campaigns c ON c.id = ph.campaign_id
        JOIN tiktok_accounts a ON a.id = c.account_id
        LEFT JOIN adgroups ag ON ag.id = ph.adgroup_id
        WHERE a.client_id = $1::uuid AND ph.date BETWEEN $2 AND $3
        GROUP BY ph.date, ph.campaign_id, c.name, ph.adgroup_id, ag.name
        ORDER BY ph.date
        """,
        client_id,
        start,
        end,
    )
    return [
        AwarenessRollupRow(
            day=r["day"],
            campaign_id=r["campaign_id"],
            campaign_name=r["campaign_name"],
            adgroup_id=r["adgroup_id"],
            adgroup_name=r["adgroup_name"],
            spend=float(r["spend"]),
            impressions=int(r["impressions"]),
            reach=int(r["reach"]),
            video_watched_6s=int(r["video_watched_6s"]),
            engaged_view_15s=int(r["engaged_view_15s"]),
        )
        for r in rows
    ]


def resolve_window(
    available: list[date], end_date: date | None, window_days: int = DEFAULT_WINDOW_DAYS
) -> tuple[date, date, date, date]:
    """(current_first, current_last, prior_first, prior_last), mirroring
    Tempo's own `getDailyBriefDashboard` window-clamping logic
    (packages/db/src/repositories/daily-brief.ts): `end_date` clamps down to
    the nearest ingested date at or before it; the prior window is the same
    length immediately before the current one."""
    target = end_date or available[-1]
    candidates = [d for d in available if d <= target]
    last_date = candidates[-1] if candidates else available[-1]
    first_date = last_date - timedelta(days=window_days - 1)
    prior_last = first_date - timedelta(days=1)
    prior_first = prior_last - timedelta(days=window_days - 1)
    return first_date, last_date, prior_first, prior_last


def _derive_gmv_metrics(
    *, spend: float, impressions: float, clicks: float, conversions: float, conversion_value: float
) -> dict[str, float]:
    """Only includes a derived ratio when its denominator is nonzero — the
    ratio-integrity rule (PRD §3.1: "never averaged") applied at the source:
    every ratio here is computed from these five already-summed fields, so
    there is nothing upstream for a generator to average by mistake."""
    metrics: dict[str, float] = {
        "impressions": impressions,
        "clicks": clicks,
        "orders": conversions,
        "gmv": conversion_value,
        "cost": spend,
    }
    if impressions > 0:
        metrics["ctr"] = clicks / impressions
    if clicks > 0:
        metrics["cvr"] = conversions / clicks
    if conversions > 0:
        metrics["aov"] = conversion_value / conversions
    if spend > 0:
        metrics["roi"] = conversion_value / spend
    return metrics


def _sum_rows(rows: list[RollupRow]) -> dict[str, float]:
    return {
        "spend": sum(r.spend for r in rows),
        "impressions": sum(r.impressions for r in rows),
        "clicks": sum(r.clicks for r in rows),
        "conversions": sum(r.conversions for r in rows),
        "conversion_value": sum(r.conversion_value for r in rows),
    }


def _derive_awareness_metrics(
    *, spend: float, impressions: float, reach: float, video_watched_6s: float, engaged_view_15s: float
) -> dict[str, float]:
    """Mirrors `_derive_gmv_metrics`'s "derive every ratio from already-
    summed fields, never average" discipline. `reach` here is summed across
    hourly rows the same way Tempo's own shipped `daily-brief.ts` does it
    (`acc.reach += r.reach`) — the accepted convention for this schema, not
    a deduped figure; see `AWARENESS_OBJECTIVE_CONTRACT.additivity_trap` for
    the entity-level (campaign vs. adgroup) case this does NOT paper over.
    """
    metrics: dict[str, float] = {"impressions": impressions, "reach": reach, "cost": spend}
    if reach > 0:
        metrics["frequency"] = impressions / reach
    if impressions > 0:
        metrics["vtr6s"] = video_watched_6s / impressions
        metrics["vtr15s"] = engaged_view_15s / impressions
        metrics["cpm"] = spend / impressions * 1000
    if reach > 0 and impressions > 0:
        qualified_reach = reach * metrics["vtr6s"]
        metrics["qualified_reach"] = qualified_reach
        if qualified_reach > 0:
            metrics["cost_per_qualified_reach"] = spend / qualified_reach
        if spend > 0:
            metrics["qualified_reach_per_cost"] = qualified_reach / spend
    return metrics


def _sum_awareness_rows(rows: list[AwarenessRollupRow]) -> dict[str, float]:
    return {
        "spend": sum(r.spend for r in rows),
        "impressions": sum(r.impressions for r in rows),
        "reach": sum(r.reach for r in rows),
        "video_watched_6s": sum(r.video_watched_6s for r in rows),
        "engaged_view_15s": sum(r.engaged_view_15s for r in rows),
    }


async def build_gmv_metric_frame(
    conn: asyncpg.Connection,
    client_slug: str,
    *,
    end_date: date | None = None,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> "MetricFrame | None":
    """Build a GMV-brief `MetricFrame` for `client_slug` from live Tempo
    data. Only for a client whose `north_star` is `'shop'` — the GMV
    contract's `conversions`/`conversion_value` mapping is meaningless
    otherwise (the same gating Tempo's own brief route enforces)."""
    from engine.contracts import Entity, EntityLevel, MetricFrame, MetricRecord

    client = await fetch_client(conn, client_slug)
    if client is None or client.north_star != "shop":
        return None

    available = await fetch_available_dates(conn, client.id)
    if not available:
        return None

    first_date, last_date, prior_first, prior_last = resolve_window(available, end_date, window_days)

    current_rows = await fetch_paid_rollup(conn, client.id, first_date, last_date)
    prior_rows = await fetch_paid_rollup(conn, client.id, prior_first, prior_last)
    if not current_rows:
        return None

    current_active_days = len({r.day for r in current_rows})
    prior_active_days = len({r.day for r in prior_rows})

    from engine.contracts import Period

    current_period = Period(start_date=first_date, end_date=last_date, active_days=current_active_days, label="current")
    prior_period = (
        Period(start_date=prior_first, end_date=prior_last, active_days=prior_active_days, label="prior")
        if prior_rows
        else None
    )

    # Campaign-level rollup (adgroup_id IS NULL) vs adgroup breakdown
    # (adgroup_id IS NOT NULL) are parallel decompositions — never pooled
    # together in one SUM (PRD §3.1).
    campaign_rollup_current = [r for r in current_rows if r.adgroup_id is None]
    campaign_rollup_prior = [r for r in prior_rows if r.adgroup_id is None]
    adgroup_rows_current = [r for r in current_rows if r.adgroup_id is not None]

    account_entity = Entity(level=EntityLevel.ACCOUNT, id=client.id, display_name=client.name)
    records: list[MetricRecord] = [
        MetricRecord(entity=account_entity, period=current_period, metrics=_derive_gmv_metrics(**_sum_rows(campaign_rollup_current))),
    ]
    if prior_period is not None:
        records.append(
            MetricRecord(entity=account_entity, period=prior_period, metrics=_derive_gmv_metrics(**_sum_rows(campaign_rollup_prior)))
        )

    by_campaign: dict[str, list[RollupRow]] = {}
    for r in campaign_rollup_current:
        by_campaign.setdefault(r.campaign_id, []).append(r)
    for campaign_id, rows in by_campaign.items():
        records.append(
            MetricRecord(
                entity=Entity(level=EntityLevel.CAMPAIGN, id=campaign_id, display_name=rows[0].campaign_name),
                period=current_period,
                metrics=_derive_gmv_metrics(**_sum_rows(rows)),
            )
        )

    by_adgroup: dict[str, list[RollupRow]] = {}
    for r in adgroup_rows_current:
        by_adgroup.setdefault(r.adgroup_id, []).append(r)  # type: ignore[arg-type]
    for adgroup_id, rows in by_adgroup.items():
        records.append(
            MetricRecord(
                entity=Entity(level=EntityLevel.AD_GROUP, id=adgroup_id, display_name=rows[0].adgroup_name or adgroup_id),
                period=current_period,
                metrics=_derive_gmv_metrics(**_sum_rows(rows)),
            )
        )

    return MetricFrame(
        tenant_id=client.id,
        brief_type="gmv",
        current_period=current_period,
        prior_period=prior_period,
        records=records,
        currency=client.currency,
        timezone=client.timezone,
        generated_at=datetime.now(timezone.utc),
    )


async def build_awareness_metric_frame(
    conn: asyncpg.Connection,
    client_slug: str,
    *,
    end_date: date | None = None,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> "MetricFrame | None":
    """Build an Awareness-brief `MetricFrame` for `client_slug` from live
    Tempo data. Only for a client whose `north_star` is `'vtr'` — Tempo's
    literal name for "no on-platform outcome; view-through rate is the
    honest proxy" (`clients.north_star` comment, `packages/db/src/
    schema.ts`), the corrected reading of this PRD's `BriefType` value
    `"awareness"` (same kind of naming correction as `build_gmv_metric_
    frame`'s `north_star == "shop"` gate for `"gmv"`).

    Structurally identical to `build_gmv_metric_frame`: account gets both
    periods (summed from campaign-level rollup rows), campaign gets current
    period only, adgroup gets current period only — true depth parity, not
    an artificially richer Awareness adapter. Adgroup-level records are
    tagged `dimensions={"campaign_id": ...}` so A04 can regroup them by
    parent campaign without a foreign-key field on `Entity` itself.
    """
    from engine.contracts import Entity, EntityLevel, MetricFrame, MetricRecord, Period

    client = await fetch_client(conn, client_slug)
    if client is None or client.north_star != "vtr":
        return None

    available = await fetch_available_dates(conn, client.id)
    if not available:
        return None

    first_date, last_date, prior_first, prior_last = resolve_window(available, end_date, window_days)

    current_rows = await fetch_paid_awareness_rollup(conn, client.id, first_date, last_date)
    prior_rows = await fetch_paid_awareness_rollup(conn, client.id, prior_first, prior_last)
    if not current_rows:
        return None

    current_active_days = len({r.day for r in current_rows})
    prior_active_days = len({r.day for r in prior_rows})

    current_period = Period(start_date=first_date, end_date=last_date, active_days=current_active_days, label="current")
    prior_period = (
        Period(start_date=prior_first, end_date=prior_last, active_days=prior_active_days, label="prior")
        if prior_rows
        else None
    )

    campaign_rollup_current = [r for r in current_rows if r.adgroup_id is None]
    campaign_rollup_prior = [r for r in prior_rows if r.adgroup_id is None]
    adgroup_rows_current = [r for r in current_rows if r.adgroup_id is not None]

    account_entity = Entity(level=EntityLevel.ACCOUNT, id=client.id, display_name=client.name)
    records: list[MetricRecord] = [
        MetricRecord(entity=account_entity, period=current_period, metrics=_derive_awareness_metrics(**_sum_awareness_rows(campaign_rollup_current))),
    ]
    if prior_period is not None:
        records.append(
            MetricRecord(entity=account_entity, period=prior_period, metrics=_derive_awareness_metrics(**_sum_awareness_rows(campaign_rollup_prior)))
        )

    by_campaign: dict[str, list[AwarenessRollupRow]] = {}
    for r in campaign_rollup_current:
        by_campaign.setdefault(r.campaign_id, []).append(r)
    for campaign_id, rows in by_campaign.items():
        records.append(
            MetricRecord(
                entity=Entity(level=EntityLevel.CAMPAIGN, id=campaign_id, display_name=rows[0].campaign_name),
                period=current_period,
                metrics=_derive_awareness_metrics(**_sum_awareness_rows(rows)),
            )
        )

    by_adgroup: dict[str, list[AwarenessRollupRow]] = {}
    for r in adgroup_rows_current:
        by_adgroup.setdefault(r.adgroup_id, []).append(r)  # type: ignore[arg-type]
    for adgroup_id, rows in by_adgroup.items():
        records.append(
            MetricRecord(
                entity=Entity(level=EntityLevel.AD_GROUP, id=adgroup_id, display_name=rows[0].adgroup_name or adgroup_id),
                period=current_period,
                metrics=_derive_awareness_metrics(**_sum_awareness_rows(rows)),
                dimensions={"campaign_id": rows[0].campaign_id},
            )
        )

    return MetricFrame(
        tenant_id=client.id,
        brief_type="awareness",
        current_period=current_period,
        prior_period=prior_period,
        records=records,
        currency=client.currency,
        timezone=client.timezone,
        generated_at=datetime.now(timezone.utc),
    )


def _derive_install_metrics(*, spend: float, impressions: float, clicks: float, conversions: float, conversion_value: float) -> dict[str, float]:
    """Same "derive every ratio from already-summed fields" discipline as
    `_derive_gmv_metrics`. `conversions` is the platform-reported install
    count for an `'app_install'` client — `conversion_value` is always 0
    for this client type (no revenue is attributed to an install) and is
    intentionally not surfaced as a metric here, since there is nothing
    honest to compute from an always-zero field."""
    metrics: dict[str, float] = {"impressions": impressions, "clicks": clicks, "installs": conversions, "cost": spend}
    if impressions > 0:
        metrics["ctr"] = clicks / impressions
    if clicks > 0:
        metrics["ir"] = conversions / clicks
    if spend > 0:
        if conversions > 0:
            metrics["cpi"] = spend / conversions
        metrics["installs_per_cost"] = conversions / spend
    return metrics


async def build_install_metric_frame(
    conn: asyncpg.Connection,
    client_slug: str,
    *,
    end_date: date | None = None,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> "MetricFrame | None":
    """Build an Install-brief `MetricFrame` for `client_slug` from live
    Tempo data. Only for a client whose `north_star` is `'app_install'` —
    reuses `fetch_paid_rollup`/`RollupRow` unchanged (GMV's `conversions`/
    `conversion_value` columns are the exact same generic columns Tempo
    reports installs through for this client type; see the schema comment
    on `paid_hourly_metrics.conversions`), only the derivation and gating
    differ. Same depth as `build_gmv_metric_frame`/`build_awareness_metric_
    frame`: account gets both periods, campaign/adgroup get current only.
    """
    from engine.contracts import Entity, EntityLevel, MetricFrame, MetricRecord, Period

    client = await fetch_client(conn, client_slug)
    if client is None or client.north_star != "app_install":
        return None

    available = await fetch_available_dates(conn, client.id)
    if not available:
        return None

    first_date, last_date, prior_first, prior_last = resolve_window(available, end_date, window_days)

    current_rows = await fetch_paid_rollup(conn, client.id, first_date, last_date)
    prior_rows = await fetch_paid_rollup(conn, client.id, prior_first, prior_last)
    if not current_rows:
        return None

    current_active_days = len({r.day for r in current_rows})
    prior_active_days = len({r.day for r in prior_rows})

    current_period = Period(start_date=first_date, end_date=last_date, active_days=current_active_days, label="current")
    prior_period = (
        Period(start_date=prior_first, end_date=prior_last, active_days=prior_active_days, label="prior")
        if prior_rows
        else None
    )

    campaign_rollup_current = [r for r in current_rows if r.adgroup_id is None]
    campaign_rollup_prior = [r for r in prior_rows if r.adgroup_id is None]
    adgroup_rows_current = [r for r in current_rows if r.adgroup_id is not None]

    account_entity = Entity(level=EntityLevel.ACCOUNT, id=client.id, display_name=client.name)
    records: list[MetricRecord] = [
        MetricRecord(entity=account_entity, period=current_period, metrics=_derive_install_metrics(**_sum_rows(campaign_rollup_current))),
    ]
    if prior_period is not None:
        records.append(
            MetricRecord(entity=account_entity, period=prior_period, metrics=_derive_install_metrics(**_sum_rows(campaign_rollup_prior)))
        )

    by_campaign: dict[str, list[RollupRow]] = {}
    for r in campaign_rollup_current:
        by_campaign.setdefault(r.campaign_id, []).append(r)
    for campaign_id, rows in by_campaign.items():
        records.append(
            MetricRecord(
                entity=Entity(level=EntityLevel.CAMPAIGN, id=campaign_id, display_name=rows[0].campaign_name),
                period=current_period,
                metrics=_derive_install_metrics(**_sum_rows(rows)),
            )
        )

    by_adgroup: dict[str, list[RollupRow]] = {}
    for r in adgroup_rows_current:
        by_adgroup.setdefault(r.adgroup_id, []).append(r)  # type: ignore[arg-type]
    for adgroup_id, rows in by_adgroup.items():
        records.append(
            MetricRecord(
                entity=Entity(level=EntityLevel.AD_GROUP, id=adgroup_id, display_name=rows[0].adgroup_name or adgroup_id),
                period=current_period,
                metrics=_derive_install_metrics(**_sum_rows(rows)),
                dimensions={"campaign_id": rows[0].campaign_id},
            )
        )

    return MetricFrame(
        tenant_id=client.id,
        brief_type="install",
        current_period=current_period,
        prior_period=prior_period,
        records=records,
        currency=client.currency,
        timezone=client.timezone,
        generated_at=datetime.now(timezone.utc),
    )


async def verify_read_only_boundary(conn: asyncpg.Connection) -> None:
    """B0's exit criterion, made executable: confirm the connection can read
    `public.clients` and confirm a write attempt is rejected by Postgres
    itself — not by application-level discipline. Raises `AssertionError` if
    either check fails, including if the write unexpectedly *succeeds*
    (the dangerous failure mode: a role with write access would silently
    pass a "read works" check).
    """
    await conn.fetchval("SELECT count(*) FROM clients")

    try:
        await conn.execute(
            "INSERT INTO clients (agency_id, name, slug) VALUES "
            "('00000000-0000-0000-0000-000000000000', 'boundary-test', 'boundary-test')"
        )
    except asyncpg.InsufficientPrivilegeError:
        return  # expected: the write was rejected by Postgres.
    else:
        # The insert should never succeed. If it did, immediately undo it
        # before raising, so a misconfigured role does not leave test data
        # behind in a real client's database.
        await conn.execute("DELETE FROM clients WHERE slug = 'boundary-test'")
        raise AssertionError(
            "write to public.clients succeeded — the engine's Postgres role is not read-only"
        )
