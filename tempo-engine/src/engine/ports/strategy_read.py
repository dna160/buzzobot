"""Strategy frame builder (Strategy Report PRD §7.2) — SELECT-only, like
`tempo_read.py`, and the only module that reads Market Scope for the engine.

Reads Tempo's own DB: the `market_scope_*` mirror (filled by the sanitizer
from the portal, PRD §6.3), `paid_hourly_metrics` for spend, and the AM's
`strategy_specs` / accepted `strategy_actions`. Never the portal, never TTMS.

Facts it relies on (P0_DISCOVERY.md, P1_DATA.md):
- `as_of` is clamped to the account's settled day (`last_data_date`): TTMS
  returns zeros after it.
- Ranks come from `market_scope_rankings_daily`; "#x dari N" uses that day's
  list length (P0 §6.4).
- Spend is the campaign-rollup sum of `paid_hourly_metrics` — gross, credits
  included, GMV Max included since the P1 spend fix — on the ad account's local
  day. TTMS days are UTC; the two join by date string (PRD §7.2's 7-hour
  caveat), which every spend finding states.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

import asyncpg

from engine.contracts.strategy import (
    STAGES,
    AudienceDay,
    ClosedAction,
    CompetitorRank,
    InsightDay,
    OpenAction,
    ReportClass,
    SpendDay,
    StrategyFrame,
    StrategyGoal,
)
from engine.ports.strategy_classify import classify
from engine.ports.tempo_read import fetch_client

HISTORY_DAYS = 84
MIN_AUDIENCE_DAYS = 14
LEVELS = ("top5", "top10", "top25", "top50")
INSIGHT_METRICS = ("engagements", "video_views_6s", "search_volume", "product_card_clicks", "comments", "nsr")


def _f(v: object) -> float | None:
    return None if v is None else float(v)  # type: ignore[arg-type]


async def build_strategy_frame(
    conn: asyncpg.Connection,
    client_slug: str,
    *,
    end_date: date | None = None,
    window_days: int = 28,
    report_class: ReportClass | None = None,
    history_days: int = HISTORY_DAYS,
) -> StrategyFrame | None:
    """`None` = not eligible (PRD §7.1): no mirrored TTMS account, or fewer than
    14 days of audience history. North star is deliberately not a gate."""
    client = await fetch_client(conn, client_slug)
    if client is None:
        return None

    spec = await conn.fetchrow("SELECT * FROM strategy_specs WHERE client_id = $1::uuid", client.id)
    account = await conn.fetchrow(
        """
        SELECT ttms_account_id, brand_name, vertical, plan, is_lite, unavailable_metrics, last_data_date
        FROM market_scope_accounts
        WHERE client_id = $1::uuid
        ORDER BY (ttms_account_id = $2) DESC, is_primary DESC, brand_name
        LIMIT 1
        """,
        client.id,
        spec["ttms_account_id"] if spec else None,
    )
    if account is None or account["last_data_date"] is None:
        return None
    acc_id: str = account["ttms_account_id"]

    settled: date = account["last_data_date"]
    as_of = min(end_date, settled) if end_date else settled
    hist_start = as_of - timedelta(days=history_days - 1)
    current_start = as_of - timedelta(days=window_days - 1)
    prior_end = current_start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=window_days - 1)

    # Audience + own rank from the ranking list.
    aud_rows = await conn.fetch(
        """
        SELECT * FROM market_scope_audience_daily
        WHERE ttms_account_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date
        """,
        acc_id, hist_start, as_of,
    )
    if len({r["date"] for r in aud_rows}) < MIN_AUDIENCE_DAYS:
        return None
    rank_rows = await conn.fetch(
        """
        SELECT r.date, r.stage, r.ranking,
               (SELECT COUNT(*) FROM market_scope_rankings_daily n
                WHERE n.ttms_account_id = r.ttms_account_id AND n.date = r.date AND n.stage = r.stage) AS n
        FROM market_scope_rankings_daily r
        WHERE r.ttms_account_id = $1 AND r.brand = $2 AND r.date BETWEEN $3 AND $4
        """,
        acc_id, account["brand_name"], hist_start, as_of,
    )
    own_rank = {(r["date"], r["stage"]): (int(r["ranking"]), int(r["n"])) for r in rank_rows}
    audience: dict[str, list[AudienceDay]] = defaultdict(list)
    for r in aud_rows:
        rank = own_rank.get((r["date"], r["stage"]))
        audience[r["stage"]].append(
            AudienceDay(
                date=r["date"], total=_f(r["brand_total"]), new=_f(r["brand_new"]), outflow=_f(r["brand_outflow"]),
                rank=rank[0] if rank else None, rank_n=rank[1] if rank else None,
                bench_total={lv: _f(r[f"bench_total_{lv}"]) for lv in LEVELS},
                bench_new={lv: _f(r[f"bench_new_{lv}"]) for lv in LEVELS},
                bench_outflow={lv: _f(r[f"bench_outflow_{lv}"]) for lv in LEVELS},
            )
        )

    # Only the series a generator reads (impressions by content type; the
    # share and signal metrics at "all") — every graph checkpoint stores the
    # frame, so the other ~50 metric × content-type pairs would be dead weight.
    ins_rows = await conn.fetch(
        """
        SELECT * FROM market_scope_insights_daily
        WHERE ttms_account_id = $1 AND date BETWEEN $2 AND $3
          AND (metric = 'impressions' OR (content_type = 'all' AND metric = ANY($4::text[])))
        ORDER BY date
        """,
        acc_id, hist_start, as_of, list(INSIGHT_METRICS),
    )
    insights: dict[str, list[InsightDay]] = defaultdict(list)
    for r in ins_rows:
        insights[f"{r['metric']}|{r['content_type']}"].append(
            InsightDay(
                date=r["date"], value=_f(r["brand_value"]), share=_f(r["brand_share"]),
                bench_value={lv: _f(r[f"bench_value_{lv}"]) for lv in LEVELS},
                bench_share={lv: _f(r[f"bench_share_{lv}"]) for lv in LEVELS},
            )
        )

    competitors = await _competitors(conn, acc_id, account["brand_name"], as_of)

    spend_rows = await conn.fetch(
        """
        SELECT ph.date,
               SUM(ph.spend) AS spend,
               SUM(ph.spend) FILTER (WHERE c.objective = 'product_sales') AS gmv_max
        FROM paid_hourly_metrics ph
        JOIN campaigns c ON c.id = ph.campaign_id
        JOIN tiktok_accounts a ON a.id = c.account_id
        WHERE a.client_id = $1::uuid AND ph.adgroup_id IS NULL AND ph.date BETWEEN $2 AND $3
        GROUP BY ph.date ORDER BY ph.date
        """,
        client.id, hist_start, as_of,
    )
    spend = [SpendDay(date=r["date"], spend=float(r["spend"] or 0), gmv_max_spend=float(r["gmv_max"] or 0)) for r in spend_rows]

    actions = await conn.fetch(
        "SELECT id::text, action_json, started_at, status FROM strategy_actions "
        "WHERE client_id = $1::uuid AND status = 'running' AND started_at IS NOT NULL ORDER BY created_at",
        client.id,
    )
    closed = await conn.fetch(
        "SELECT id::text, action_json, started_at, status, measured_value, category_delta, measured_at::date AS measured_at "
        "FROM strategy_actions WHERE client_id = $1::uuid AND status IN ('worked', 'weak', 'failed') "
        "ORDER BY measured_at DESC NULLS LAST, created_at DESC LIMIT 6",
        client.id,
    )
    import json

    closed_actions = [
        ClosedAction(
            id=a["id"],
            action=a["action_json"] if isinstance(a["action_json"], dict) else json.loads(a["action_json"]),
            started_at=a["started_at"], status=a["status"], measured_value=_f(a["measured_value"]),
            category_delta=_f(a["category_delta"]), measured_at=a["measured_at"],
        )
        for a in closed
    ]
    open_actions = [
        OpenAction(
            id=a["id"],
            action=a["action_json"] if isinstance(a["action_json"], dict) else json.loads(a["action_json"]),
            started_at=a["started_at"],
        )
        for a in actions
    ]

    goal = None
    if spec and spec["goal_kind"] and spec["goal_value"] is not None and spec["goal_deadline"]:
        goal = StrategyGoal(
            kind=spec["goal_kind"], stage=spec["goal_stage"], metric=spec["goal_metric"],
            value=float(spec["goal_value"]), deadline=spec["goal_deadline"],
        )

    # Classification inputs: GMV share of spend over the last 28 days, and the
    # Conversion ÷ Consideration size ratio on as_of (PRD §5.2).
    recent = [s for s in spend if s.date >= as_of - timedelta(days=27)]
    total_spend = sum(s.spend for s in recent)
    gmv_share = (sum(s.gmv_max_spend for s in recent) / total_spend) if total_spend > 0 else None
    last = {stage: (days[-1] if days and days[-1].date == as_of else None) for stage, days in audience.items()}
    cons, conv = last.get("consideration"), last.get("conversion")
    conv_ratio = (conv.total / cons.total) if cons and conv and cons.total and conv.total is not None else None
    override = report_class or (spec["report_class_override"] if spec else None)

    return StrategyFrame(
        tenant_id=client.id,
        client_slug=client.slug,
        client_name=client.name,
        north_star=client.north_star,
        currency=client.currency or "IDR",
        ttms_account_id=acc_id,
        brand_name=account["brand_name"],
        vertical=account["vertical"],
        plan=account["plan"],
        is_lite=account["is_lite"],
        unavailable_metrics=list(account["unavailable_metrics"] or []),
        as_of=as_of,
        window_days=window_days,
        current_start=current_start,
        prior_start=prior_start,
        prior_end=prior_end,
        history_days=history_days,
        audience={s: audience.get(s, []) for s in STAGES},
        insights=dict(insights),
        competitors=competitors,
        spend=spend,
        goal=goal,
        creator_fee_monthly=_f(spec["creator_fee_monthly"]) if spec else None,
        bgc_cost_monthly=_f(spec["bgc_cost_monthly"]) if spec else None,
        open_actions=open_actions,
        closed_actions=closed_actions,
        classification=classify(north_star=client.north_star, gmv_share=gmv_share, conv_ratio=conv_ratio, override=override),
        generated_at=datetime.now(UTC),
    )


def _at_or_before(by_date: dict[date, dict[str, int]], dates: list[date], target: date) -> dict[str, int]:
    earlier = [d for d in dates if d <= target]
    return by_date[earlier[-1]] if earlier else {}


async def _competitors(conn: asyncpg.Connection, acc_id: str, own: str, as_of: date) -> dict[str, list[CompetitorRank]]:
    """Each stage's list on `as_of`, with every brand's rank 7 and 14 days
    earlier (the nearest stored day on or before each). Names and ranks only —
    TTMS gives no competitor values."""
    rows = await conn.fetch(
        """
        SELECT date, stage, brand, ranking FROM market_scope_rankings_daily
        WHERE ttms_account_id = $1 AND date BETWEEN $2 AND $3
        """,
        acc_id, as_of - timedelta(days=21), as_of,
    )
    by_stage_date: dict[str, dict[date, dict[str, int]]] = defaultdict(lambda: defaultdict(dict))
    for r in rows:
        by_stage_date[r["stage"]][r["date"]][r["brand"]] = int(r["ranking"])

    out: dict[str, list[CompetitorRank]] = {}
    for stage, by_date in by_stage_date.items():
        dates = sorted(by_date)
        now = by_date.get(as_of)
        if not now:
            continue

        d7 = _at_or_before(by_date, dates, as_of - timedelta(days=7))
        d14 = _at_or_before(by_date, dates, as_of - timedelta(days=14))
        out[stage] = [
            CompetitorRank(brand=b, rank_now=r, rank_7d=d7.get(b), rank_14d=d14.get(b))
            for b, r in sorted(now.items(), key=lambda kv: kv[1])
            if b != own
        ]
    return out
