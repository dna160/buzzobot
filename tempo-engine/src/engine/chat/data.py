"""All database access for Tempo Chat sits behind the `ChatData` protocol.

`PgChatData` is the only implementation that touches Postgres, and it does so
through the engine's read-only role (PRD §6.2 R4) — reusing `tempo_read` and
`strategy_read` so chat reads obey the exact same grain/additivity/window rules
the reports do. `FakeChatData` serves the tests with in-memory fixtures.

Every method takes the server-resolved `ChatScope`; none takes a client,
tenant or agency from the model (PRD R3). The DTOs are plain frozen records of
already-shaped facts, never raw rows for the model to aggregate (R5).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import asyncpg

from engine.chat.scope import ChatScope
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


class ChatData(Protocol):
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
    if row is None:
        return None
    return ChatScope(
        client_slug=row["slug"],
        tenant_id=row["id"],
        agency_id=row["agency_id"],
        client_name=row["name"],
        north_star=row["north_star"],
        currency=row["currency"] or "IDR",
        timezone=row["timezone"] or "UTC",
    )


class PgChatData:
    """Reads Tempo's Postgres under the engine's read-only role. Takes a pool
    (or connection) — both answer `fetch`/`fetchrow`/`fetchval`."""

    def __init__(self, db: asyncpg.Pool) -> None:
        self._db = db

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

        acc = await db.fetchrow(
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
        )
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

        report_rows = await db.fetch(
            "SELECT brief_type, status, updated_at FROM insight.brief "
            "WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 3",
            scope.tenant_id,
        )
        last_reports = tuple(
            ReportRun(brief_type=r["brief_type"], status=r["status"], updated_at=r["updated_at"])
            for r in report_rows
        )

        count_rows = await db.fetch(
            "SELECT status, count(*) AS n FROM strategy_actions WHERE client_id = $1::uuid GROUP BY status",
            scope.tenant_id,
        )
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
    """Serves the pure tests. Returns its fixtures regardless of the arguments a
    tool was called with, which is exactly how the scope-binding tests prove a
    tool cannot be steered to another client: an injected `client_slug` reaches
    this fake and changes nothing."""

    overview_facts: ClientOverview | None = None
    dates: list[date] = field(default_factory=list)
    rollup: list[RollupRow] = field(default_factory=list)
    awareness: list[AwarenessRollupRow] = field(default_factory=list)
    frame: StrategyFrame | None = None
    actions: list[ActionLogRow] = field(default_factory=list)
    campaigns: dict[str, tuple[str, str]] = field(default_factory=dict)

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
