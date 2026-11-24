"""Generate-or-reuse for the client's report (Tanya Tempo `client_report`).

A client's report is its Strategy Report when it can have one (a TikTok Market
Scope link with ≥ 14 days of audience), otherwise its objective brief (GMV /
Awareness / Install by north star). A report approved within the last
`CACHE_HOURS` is reused as-is; otherwise chat runs the same engine pipeline the
report buttons run (`run_brief_sync`: generators, materiality, the report
agents, the review gate auto-approved) and the new report is stored in
`insight.brief` like any other. Either way the turn records a `ReportRef`, which
the web app turns into a link to the rendered HTML.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime
from time import perf_counter
from typing import Protocol

import asyncpg

from engine.chat.data import SavedReport

CACHE_HOURS = 24.0
STRATEGY_WINDOW_DAYS = 28
BRIEF_WINDOW_DAYS = 7


def generation_tier() -> str:
    """`CHAT_REPORT_TIER` — `full` (default: the agents, ~40 s locally) or
    `instant` (templates only, < 1 s)."""
    tier = os.environ.get("CHAT_REPORT_TIER", "full").strip().lower()
    return tier if tier in ("full", "instant") else "full"


@dataclass(frozen=True)
class ReportRef:
    """What the web app needs to link the rendered report."""

    slug: str
    client_name: str
    brief_type: str  # strategy | gmv | awareness | install
    run_id: str
    tier: str
    cached: bool
    generated_at: datetime | None
    window_days: int
    duration_s: float | None = None

    def to_json(self) -> dict:
        return {
            "slug": self.slug,
            "client_name": self.client_name,
            "brief_type": self.brief_type,
            "run_id": self.run_id,
            "tier": self.tier,
            "cached": self.cached,
            "generated_at": self.generated_at.isoformat() if self.generated_at else None,
            "window_days": self.window_days,
            "duration_s": self.duration_s,
        }


class NotEligible(Exception):
    """The client cannot have this report type (no TTMS / no ads data)."""


class ReportRunner(Protocol):
    async def generate(self, slug: str, brief_type: str, *, window_days: int, tier: str) -> SavedReport: ...


class EngineReportRunner:
    """Runs the real pipeline: `dispatcher.run_brief_sync` against the engine's
    own database (reports and their audit rows always live there)."""

    def __init__(self, graph: object, read_conn: asyncpg.Pool) -> None:
        self._graph = graph
        self._conn = read_conn

    async def generate(self, slug: str, brief_type: str, *, window_days: int, tier: str) -> SavedReport:
        from engine.api.dispatcher import ClientNotEligibleError, run_brief_sync

        try:
            res = await run_brief_sync(
                graph=self._graph, read_conn=self._conn, client_slug=slug,  # type: ignore[arg-type]
                brief_type=brief_type, window_days=window_days, tier=tier,  # type: ignore[arg-type]
            )
        except ClientNotEligibleError as exc:
            raise NotEligible(str(exc)) from exc
        return SavedReport(
            brief_type=brief_type, run_id=res["run_id"], tier=(res.get("content") or {}).get("tier", tier),
            updated_at=datetime.now(UTC), content=res.get("content") or {},
        )


def age_hours(r: SavedReport, now: datetime | None = None) -> float | None:
    if r.updated_at is None:
        return None
    ts = r.updated_at if r.updated_at.tzinfo else r.updated_at.replace(tzinfo=UTC)
    return ((now or datetime.now(UTC)) - ts).total_seconds() / 3600


def is_fresh(r: SavedReport, now: datetime | None = None) -> bool:
    age = age_hours(r, now)
    return age is not None and age <= CACHE_HOURS


def timed() -> float:
    return perf_counter()
