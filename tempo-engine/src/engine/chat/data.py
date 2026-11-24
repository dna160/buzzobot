"""All database access for Tempo Chat sits behind the `ChatData` protocol.

`PgChatData` is the only implementation that touches Postgres, and it does so
through the engine's read-only role (PRD §6.2 R4) — reusing `tempo_read` and
`strategy_read` so chat reads obey the exact same grain/additivity/window rules
the reports do. `FakeChatData` serves the tests with in-memory fixtures.

Per-client methods take a `ChatScope` the server resolved from the model's
`client` argument *within the `ChatWorkspace`* (`resolve_client`); workspace
methods (`find_clients`, `portfolio`) take the workspace itself, so a client
outside it can never be named into a query. The DTOs are plain frozen records
of already-shaped facts, never raw rows for the model to aggregate (R5).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import asyncpg

from engine.chat.scope import ChatScope, ChatWorkspace
from engine.contracts.strategy import StrategyFrame
from engine.ports.strategy_read import build_strategy_frame
from engine.ports.tempo_read import (
    AwarenessRollupRow,
    RollupRow,
    fetch_available_dates,
    fetch_paid_awareness_rollup,
    fetch_paid_rollup,
)


@dataclass(frozen=True)
class PaidCoverage:
    ad_accounts: int
    first_date: date | None
    last_date: date | None
    days_with_data: int


@dataclass(frozen=True)
class TtmsLink:
    linked: bool
    brand_name: str | None = None
    vertical: str | None = None
    plan: str | None = None
    is_lite: bool | None = None
    last_data_date: date | None = None
    history_days: int = 0
    unavailable_metrics: tuple[str, ...] = ()


@dataclass(frozen=True)
class ReportRun:
    brief_type: str
    status: str
    updated_at: datetime | None


@dataclass(frozen=True)
class ClientOverview:
    tier: str | None
    today: date
    paid: PaidCoverage
    ttms: TtmsLink
    last_reports: tuple[ReportRun, ...]
    action_counts: dict[str, int]


@dataclass(frozen=True)
class ActionLogRow:
    status: str
    langkah: str | None
    metric_key: str | None
    priority: str | None
    proposed_at: date | None
    started_at: date | None
    target_by: date | None
    start_value: float | None
    target_value: float | None
    measured_value: float | None


@dataclass(frozen=True)
class ClientMatch:
    """A client as `find_clients` lists it: identity plus data coverage."""

    slug: str
    name: str
    north_star: str
    tier: str | None
    currency: str
    last_date: date | None
    ttms_linked: bool


@dataclass(frozen=True)
class PortfolioRow:
    """One client's campaign-level sums over a window (adgroup rows excluded)."""

    slug: str
    name: str
    north_star: str
    currency: str
    spend: float
    impressions: int
    clicks: int
    conversions: int
    conversion_value: float
    reach: int
    video_watched_6s: int
    engaged_view_15s: int


ResolveResult = ChatScope | list[ClientMatch]


class ChatData(Protocol):
    async def resolve_client(self, ws: ChatWorkspace, ref: str) -> ResolveResult: ...
    async def find_clients(self, ws: ChatWorkspace, query: str, limit: int) -> list[ClientMatch]: ...
    async def client_count(self, ws: ChatWorkspace) -> int: ...
    async def portfolio_last_date(self, ws: ChatWorkspace) -> date | None: ...
    async def portfolio(self, ws: ChatWorkspace, start: date, end: date) -> list[PortfolioRow]: ...
    async def overview(self, scope: ChatScope) -> ClientOverview: ...
    async def available_dates(self, scope: ChatScope) -> list[date]: ...
    async def paid_rollup(self, scope: ChatScope, start: date, end: date) -> list[RollupRow]: ...
    async def awareness_rollup(
        self, scope: ChatScope, start: date, end: date
    ) -> list[AwarenessRollupRow]: ...
    async def strategy_frame(
        self, scope: ChatScope, *, window_days: int, end_date: date | None
    ) -> StrategyFrame | None: ...
    async def action_log(self, scope: ChatScope, limit: int) -> list[ActionLogRow]: ...
    async def campaign_meta(self, scope: ChatScope) -> dict[str, tuple[str, str]]: ...


def client_today(timezone: str) -> date:
    try:
        tz = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        tz = ZoneInfo("UTC")
    return datetime.now(tz).date()


# ─── Postgres ────────────────────────────────────────────────────────────────


async def resolve_scope(db: asyncpg.Pool, slug: str) -> ChatScope | None:
    """Resolve the URL slug to a bound scope. Slugs are unique only per agency
    (PRD §15 #5); C1 has one agency, so the oldest match wins deterministically,
    and `agency_id` is kept for C2 to resolve by id."""
    row = await db.fetchrow(
        """
        SELECT id::text, agency_id::text, name, slug, currency, timezone, north_star
        FROM clients WHERE slug = $1 ORDER BY created_at LIMIT 1
        """,
        slug,
    )
    return _scope_of(row) if row is not None else None


def _norm(text: str) -> str:
    return "".join(ch for ch in text.lower() if ch.isalnum())


def _scope_of(row: asyncpg.Record) -> ChatScope:
    return ChatScope(
        client_slug=row["slug"],
        tenant_id=row["id"],
        agency_id=row["agency_id"],
        client_name=row["name"],
        north_star=row["north_star"],
        currency=row["currency"] or "IDR",
        timezone=row["timezone"] or "UTC",
    )


def _agencies(ws: ChatWorkspace) -> list[str] | None:
    return list(ws.agency_ids) if ws.agency_ids is not None else None


_IN_WORKSPACE = "($1::uuid[] IS NULL OR c.agency_id = ANY($1::uuid[]))"


async def _optional(coro, default):
    """Run a query against a table the data database may not have
    (`market_scope_*`, `insight.brief`, `strategy_actions`): missing → default."""
    try:
        return await coro
    except (asyncpg.UndefinedTableError, asyncpg.InvalidSchemaNameError):
        return default
MAX_CANDIDATES = 8


def _pick(rows: list, ref: str, slug, name) -> list:
    """Exact slug, then exact name (case-insensitive), then exact alphanumeric
    form, then substring. Returns the hits of the first rule that hits."""
    want = ref.strip()
    key = _norm(want)
    rules = (
        lambda r: slug(r) == want,
        lambda r: name(r).lower() == want.lower(),
        lambda r: bool(key) and (_norm(name(r)) == key or _norm(slug(r)) == key),
        lambda r: bool(key) and (key in _norm(name(r)) or key in _norm(slug(r))),
    )
    for rule in rules:
        hits = [r for r in rows if rule(r)]
        if hits:
            return hits
    return []


class PgChatData:
    """Reads Tempo's Postgres under a read-only role. Takes a pool (or
    connection) — both answer `fetch`/`fetchrow`/`fetchval`."""

    def __init__(self, db: asyncpg.Pool) -> None:
        self._db = db

    # ─── Workspace-level ────────────────────────────────────────────────────

    async def _clients(self, ws: ChatWorkspace) -> list[asyncpg.Record]:
        return await self._db.fetch(
            f"""
            SELECT c.id::text, c.agency_id::text, c.name, c.slug, c.currency, c.timezone,
                   c.north_star, c.tier, c.created_at
            FROM clients c WHERE {_IN_WORKSPACE} ORDER BY c.created_at
            """,
            _agencies(ws),
        )

    async def resolve_client(self, ws: ChatWorkspace, ref: str) -> ResolveResult:
        """One hit → its scope; several or none → up to 8 candidates for the
        model to choose from or ask the user about."""
        hits = _pick(await self._clients(ws), ref, lambda r: r["slug"], lambda r: r["name"])
        if len(hits) == 1:
            return _scope_of(hits[0])
        return await self._matches(hits[:MAX_CANDIDATES])

    async def find_clients(self, ws: ChatWorkspace, query: str, limit: int) -> list[ClientMatch]:
        rows = list(await self._clients(ws))
        key = _norm(query)
        if key:
            rows = [r for r in rows if key in _norm(r["name"]) or key in _norm(r["slug"])]
            rows.sort(key=lambda r: (not _norm(r["name"]).startswith(key), r["name"].lower()))
        else:
            rows.sort(key=lambda r: r["name"].lower())
        return await self._matches(rows[:limit])

    async def _matches(self, rows: list[asyncpg.Record]) -> list[ClientMatch]:
        if not rows:
            return []
        ids = [r["id"] for r in rows]
        last = await self._db.fetch(
            """
            SELECT a.client_id::text AS id, max(ph.date) AS last_date
            FROM paid_hourly_metrics ph
            JOIN campaigns c ON c.id = ph.campaign_id
            JOIN tiktok_accounts a ON a.id = c.account_id
            WHERE a.client_id = ANY($1::uuid[])
            GROUP BY a.client_id
            """,
            ids,
        )
        linked = await _optional(
            self._db.fetch(
                "SELECT DISTINCT client_id::text AS id FROM market_scope_links WHERE client_id = ANY($1::uuid[])",
                ids,
            ),
            [],
        )
        last_by = {r["id"]: r["last_date"] for r in last}
        linked_ids = {r["id"] for r in linked}
        return [
            ClientMatch(
                slug=r["slug"], name=r["name"], north_star=r["north_star"], tier=r["tier"],
                currency=r["currency"] or "IDR", last_date=last_by.get(r["id"]),
                ttms_linked=r["id"] in linked_ids,
            )
            for r in rows
        ]

    async def client_count(self, ws: ChatWorkspace) -> int:
        n = await self._db.fetchval(f"SELECT count(*) FROM clients c WHERE {_IN_WORKSPACE}", _agencies(ws))
        return int(n or 0)

    async def portfolio_last_date(self, ws: ChatWorkspace) -> date | None:
        return await self._db.fetchval(
            f"""
            SELECT max(ph.date) FROM paid_hourly_metrics ph
            JOIN campaigns cp ON cp.id = ph.campaign_id
            JOIN tiktok_accounts a ON a.id = cp.account_id
            JOIN clients c ON c.id = a.client_id
            WHERE {_IN_WORKSPACE}
            """,
            _agencies(ws),
        )

    async def portfolio(self, ws: ChatWorkspace, start: date, end: date) -> list[PortfolioRow]:
        """Campaign-level rows only (`adgroup_id IS NULL`): adgroup rows are a
        parallel decomposition, never additive with them (tempo_read §3.1)."""
        rows = await self._db.fetch(
            f"""
            SELECT c.slug, c.name, c.north_star, c.currency,
                   SUM(ph.spend) AS spend, SUM(ph.impressions) AS impressions,
                   SUM(ph.clicks) AS clicks, SUM(ph.conversions) AS conversions,
                   SUM(ph.conversion_value) AS conversion_value, SUM(ph.reach) AS reach,
                   SUM(ph.video_watched_6s) AS video_watched_6s,
                   SUM(ph.engaged_view_15s) AS engaged_view_15s
            FROM paid_hourly_metrics ph
            JOIN campaigns cp ON cp.id = ph.campaign_id
            JOIN tiktok_accounts a ON a.id = cp.account_id
            JOIN clients c ON c.id = a.client_id
            WHERE {_IN_WORKSPACE} AND ph.adgroup_id IS NULL AND ph.date BETWEEN $2 AND $3
            GROUP BY c.id, c.slug, c.name, c.north_star, c.currency
            """,
            _agencies(ws),
            start,
            end,
        )
        return [
            PortfolioRow(
                slug=r["slug"], name=r["name"], north_star=r["north_star"], currency=r["currency"] or "IDR",
                spend=float(r["spend"] or 0), impressions=int(r["impressions"] or 0),
                clicks=int(r["clicks"] or 0), conversions=int(r["conversions"] or 0),
                conversion_value=float(r["conversion_value"] or 0), reach=int(r["reach"] or 0),
                video_watched_6s=int(r["video_watched_6s"] or 0),
                engaged_view_15s=int(r["engaged_view_15s"] or 0),
            )
            for r in rows
        ]

    # ─── Per-client ─────────────────────────────────────────────────────────

    async def overview(self, scope: ChatScope) -> ClientOverview:
        db = self._db
        tier = await db.fetchval("SELECT tier FROM clients WHERE id = $1::uuid", scope.tenant_id)
        ad_accounts = await db.fetchval(
            "SELECT count(*) FROM tiktok_accounts WHERE client_id = $1::uuid", scope.tenant_id
        )
        dates = await fetch_available_dates(db, scope.tenant_id)
        paid = PaidCoverage(
            ad_accounts=int(ad_accounts or 0),
            first_date=dates[0] if dates else None,
            last_date=dates[-1] if dates else None,
            days_with_data=len(dates),
        )

        acc = await _optional(db.fetchrow(
            """
            SELECT a.ttms_account_id, a.brand_name, a.vertical, a.plan, a.is_lite,
                   a.unavailable_metrics, a.last_data_date
            FROM market_scope_links l
            JOIN market_scope_accounts a ON a.ttms_account_id = l.ttms_account_id
            WHERE l.client_id = $1::uuid
            ORDER BY l.is_primary DESC, a.brand_name
            LIMIT 1
            """,
            scope.tenant_id,
        ), None)
        if acc is None:
            ttms = TtmsLink(linked=False)
        else:
            history_days = await db.fetchval(
                "SELECT count(DISTINCT date) FROM market_scope_audience_daily WHERE ttms_account_id = $1",
                acc["ttms_account_id"],
            )
            ttms = TtmsLink(
                linked=True,
                brand_name=acc["brand_name"],
                vertical=acc["vertical"],
                plan=acc["plan"],
                is_lite=acc["is_lite"],
                last_data_date=acc["last_data_date"],
                history_days=int(history_days or 0),
                unavailable_metrics=tuple(acc["unavailable_metrics"] or ()),
            )

        report_rows = await _optional(db.fetch(
            "SELECT brief_type, status, updated_at FROM insight.brief "
            "WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 3",
            scope.tenant_id,
        ), [])
        last_reports = tuple(
            ReportRun(brief_type=r["brief_type"], status=r["status"], updated_at=r["updated_at"])
            for r in report_rows
        )

        count_rows = await _optional(db.fetch(
            "SELECT status, count(*) AS n FROM strategy_actions WHERE client_id = $1::uuid GROUP BY status",
            scope.tenant_id,
        ), [])
        action_counts = {r["status"]: int(r["n"]) for r in count_rows}

        return ClientOverview(
            tier=tier,
            today=client_today(scope.timezone),
            paid=paid,
            ttms=ttms,
            last_reports=last_reports,
            action_counts=action_counts,
        )

    async def available_dates(self, scope: ChatScope) -> list[date]:
        return await fetch_available_dates(self._db, scope.tenant_id)

    async def paid_rollup(self, scope: ChatScope, start: date, end: date) -> list[RollupRow]:
        return await fetch_paid_rollup(self._db, scope.tenant_id, start, end)

    async def awareness_rollup(
        self, scope: ChatScope, start: date, end: date
    ) -> list[AwarenessRollupRow]:
        return await fetch_paid_awareness_rollup(self._db, scope.tenant_id, start, end)

    async def strategy_frame(
        self, scope: ChatScope, *, window_days: int, end_date: date | None
    ) -> StrategyFrame | None:
        return await build_strategy_frame(
            self._db, scope.client_slug, window_days=window_days, end_date=end_date
        )

    async def campaign_meta(self, scope: ChatScope) -> dict[str, tuple[str, str]]:
        rows = await self._db.fetch(
            """
            SELECT c.id::text AS id, c.objective, c.status
            FROM campaigns c JOIN tiktok_accounts a ON a.id = c.account_id
            WHERE a.client_id = $1::uuid
            """,
            scope.tenant_id,
        )
        return {r["id"]: (r["objective"], r["status"]) for r in rows}

    async def action_log(self, scope: ChatScope, limit: int) -> list[ActionLogRow]:
        rows = await self._db.fetch(
            """
            SELECT action_json, status, created_at::date AS proposed_at, started_at,
                   measured_value, measured_at::date AS measured_at
            FROM strategy_actions WHERE client_id = $1::uuid
            ORDER BY created_at DESC LIMIT $2
            """,
            scope.tenant_id,
            limit,
        )
        out: list[ActionLogRow] = []
        for r in rows:
            a = r["action_json"] if isinstance(r["action_json"], dict) else json.loads(r["action_json"])
            copy = a.get("copy") or {}
            current = a.get("current") or {}
            target = a.get("target") or {}
            out.append(
                ActionLogRow(
                    status=r["status"],
                    langkah=copy.get("langkah"),
                    metric_key=a.get("metric_key"),
                    priority=a.get("priority"),
                    proposed_at=r["proposed_at"],
                    started_at=_as_date(r["started_at"]),
                    target_by=_as_date(target.get("by")),
                    start_value=_as_float(current.get("value")),
                    target_value=_as_float(target.get("value")),
                    measured_value=_as_float(r["measured_value"]),
                )
            )
        return out


def _as_float(v: object) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _as_date(v: object) -> date | None:
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


# ─── In-memory fake for tests ────────────────────────────────────────────────


@dataclass
class FakeChatData:
    """Serves the pure tests. Client resolution and portfolio rows respect the
    workspace exactly as `PgChatData` does; the per-client fixtures are served
    for whichever client resolved."""

    overview_facts: ClientOverview | None = None
    #: Clients in the fake database; `resolve_client` matches against these.
    clients: list[ChatScope] = field(default_factory=list)
    #: `portfolio` rows per (start, end) window; `portfolio_rows` for any window.
    portfolio_by_window: dict[tuple[date, date], list[PortfolioRow]] = field(default_factory=dict)
    portfolio_rows: list[PortfolioRow] = field(default_factory=list)
    last_date: date | None = None
    dates: list[date] = field(default_factory=list)
    rollup: list[RollupRow] = field(default_factory=list)
    awareness: list[AwarenessRollupRow] = field(default_factory=list)
    frame: StrategyFrame | None = None
    actions: list[ActionLogRow] = field(default_factory=list)
    campaigns: dict[str, tuple[str, str]] = field(default_factory=dict)

    def _visible(self, ws: ChatWorkspace) -> list[ChatScope]:
        return [c for c in self.clients if ws.agency_ids is None or c.agency_id in ws.agency_ids]

    def _match(self, c: ChatScope) -> ClientMatch:
        return ClientMatch(
            slug=c.client_slug, name=c.client_name, north_star=c.north_star, tier=None,
            currency=c.currency, last_date=self.last_date, ttms_linked=False,
        )

    async def resolve_client(self, ws: ChatWorkspace, ref: str) -> ResolveResult:
        hits = _pick(self._visible(ws), ref, lambda c: c.client_slug, lambda c: c.client_name)
        if len(hits) == 1:
            return hits[0]
        return [self._match(c) for c in hits[:MAX_CANDIDATES]]

    async def find_clients(self, ws: ChatWorkspace, query: str, limit: int) -> list[ClientMatch]:
        key = _norm(query)
        rows = [c for c in self._visible(ws) if not key or key in _norm(c.client_name) or key in _norm(c.client_slug)]
        return [self._match(c) for c in rows[:limit]]

    async def client_count(self, ws: ChatWorkspace) -> int:
        return len(self._visible(ws))

    async def portfolio_last_date(self, ws: ChatWorkspace) -> date | None:
        return self.last_date

    async def portfolio(self, ws: ChatWorkspace, start: date, end: date) -> list[PortfolioRow]:
        rows = self.portfolio_by_window.get((start, end)) if self.portfolio_by_window else self.portfolio_rows
        visible = {c.client_slug for c in self._visible(ws)}
        return [r for r in rows or [] if not self.clients or r.slug in visible]

    async def overview(self, scope: ChatScope) -> ClientOverview:
        if self.overview_facts is None:
            raise RuntimeError("FakeChatData has no overview fixture")
        return self.overview_facts

    async def available_dates(self, scope: ChatScope) -> list[date]:
        return list(self.dates)

    async def paid_rollup(self, scope: ChatScope, start: date, end: date) -> list[RollupRow]:
        return [r for r in self.rollup if start <= r.day <= end]

    async def awareness_rollup(
        self, scope: ChatScope, start: date, end: date
    ) -> list[AwarenessRollupRow]:
        return [r for r in self.awareness if start <= r.day <= end]

    async def strategy_frame(
        self, scope: ChatScope, *, window_days: int, end_date: date | None
    ) -> StrategyFrame | None:
        return self.frame

    async def action_log(self, scope: ChatScope, limit: int) -> list[ActionLogRow]:
        return self.actions[:limit]

    async def campaign_meta(self, scope: ChatScope) -> dict[str, tuple[str, str]]:
        return dict(self.campaigns)
