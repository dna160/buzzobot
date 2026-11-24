"""Strategy Report contracts (Strategy Report PRD §5, §7, §10).

The strategy brief type joins TikTok Market Scope (TTMS) — brand-level funnel
audience, category benchmarks, ranks, share of voice — with the client's own
ad spend. Its input is a `StrategyFrame`: typed series rather than the generic
`MetricFrame.records`, because every strategy generator reads *series* (84
days of audience, 12 weeks of rank, daily spend) and a flat record list would
force each one to re-derive the same grouping. The PRD sketched these as
`MetricFrame` records with a `context` field (§7.2); the typed frame carries
exactly the same groups — brand, benchmark, account spend, day series,
competitors, goal and open actions — so generators stay pure functions of
one frozen input, which is the point of the sketch.

Corrections from docs/phases/strategy-report/P0_DISCOVERY.md are applied
throughout: stage ratios are *size ratios* of rolling-window stocks, never
"move-on" rates; Conversion-stage flow is treated as absent when TTMS reports
none; ranks come from the ranking list.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import IntEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Stage = Literal["acc", "awareness", "consideration", "conversion"]
ReportClass = Literal["brand", "shop"]
BenchmarkLevel = Literal["top5", "top10", "top25", "top50"]

STAGES: tuple[Stage, ...] = ("acc", "awareness", "consideration", "conversion")
FUNNEL: tuple[Stage, ...] = ("awareness", "consideration", "conversion")
DEFAULT_BENCHMARK: BenchmarkLevel = "top10"


class StrategySectionId(IntEnum):
    """T sections (PRD §5.1). Numbered from 101 so they can never collide with
    the deck's S1-S6 in `content.sections` or `Finding.section_affinity`.
    T1 is synthesized last and never receives findings directly."""

    T1_VERDICT = 101
    T2_ACTIONS = 102
    T3_FUNNEL = 103
    T4_SPEND = 104
    T5_PACE = 105
    T6_CLASS = 106
    T7_CONTENT = 107
    T8_WARNINGS = 108
    T9_ACTION_LOG = 109
    LAMPIRAN_A = 110


T = StrategySectionId

# PRD §5.3: the class changes order and emphasis, never coverage.
SECTION_ORDER: dict[ReportClass, tuple[StrategySectionId, ...]] = {
    "brand": (T.T1_VERDICT, T.T2_ACTIONS, T.T6_CLASS, T.T3_FUNNEL, T.T5_PACE, T.T4_SPEND, T.T7_CONTENT, T.T8_WARNINGS, T.T9_ACTION_LOG, T.LAMPIRAN_A),
    "shop": (T.T1_VERDICT, T.T2_ACTIONS, T.T3_FUNNEL, T.T4_SPEND, T.T6_CLASS, T.T5_PACE, T.T7_CONTENT, T.T8_WARNINGS, T.T9_ACTION_LOG, T.LAMPIRAN_A),
}

SECTION_TITLES: dict[StrategySectionId, str] = {
    T.T1_VERDICT: "Vonis minggu ini",
    T.T2_ACTIONS: "Keputusan minggu ini",
    T.T3_FUNNEL: "Di mana funnel bocor",
    T.T4_SPEND: "Apa yang dibeli oleh belanja iklan",
    T.T5_PACE: "Laju menuju target",
    T.T7_CONTENT: "Komposisi konten & efek tular",
    T.T8_WARNINGS: "Peringatan dini",
    T.T9_ACTION_LOG: "Log tindakan",
    T.LAMPIRAN_A: "Lampiran A — Data & definisi",
}
T6_TITLE: dict[ReportClass, str] = {"brand": "Share of Voice & peringkat", "shop": "Konversi & product card"}

DEFAULT_CARD_CAP = 3
CARD_CAPS: dict[ReportClass, dict[StrategySectionId, int]] = {
    "brand": {T.T6_CLASS: 4},
    "shop": {T.T3_FUNNEL: 4, T.T6_CLASS: 3},
}


# ─── Frame ───────────────────────────────────────────────────────────────────

Bench = dict[str, float | None]  # {"top5": …, "top10": …, "top25": …, "top50": …}


class AudienceDay(BaseModel):
    model_config = ConfigDict(frozen=True)

    date: date
    total: float | None
    new: float | None
    outflow: float | None
    #: Rank from the ranking list (canonical, P0 §6.4) and that day's list length.
    rank: int | None = None
    rank_n: int | None = None
    bench_total: Bench = Field(default_factory=dict)
    bench_new: Bench = Field(default_factory=dict)
    bench_outflow: Bench = Field(default_factory=dict)


class InsightDay(BaseModel):
    model_config = ConfigDict(frozen=True)

    date: date
    value: float | None
    share: float | None
    bench_value: Bench = Field(default_factory=dict)
    bench_share: Bench = Field(default_factory=dict)


class SpendDay(BaseModel):
    """Ad spend for one ad-account local day (WIB). TTMS days are UTC; the two
    are joined by date string, as the portal's Ads impact tab does, and every
    spend finding carries that caveat."""

    model_config = ConfigDict(frozen=True)

    date: date
    spend: float
    gmv_max_spend: float = 0.0


class CompetitorRank(BaseModel):
    model_config = ConfigDict(frozen=True)

    brand: str
    rank_now: int
    rank_7d: int | None = None
    rank_14d: int | None = None


class StrategyGoal(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: Literal["rank", "share", "size_ratio", "cost_per_new"]
    stage: Stage | None = None
    metric: str | None = None
    value: float
    deadline: date


class OpenAction(BaseModel):
    """An accepted action the next run re-measures (PRD §5.6)."""

    model_config = ConfigDict(frozen=True)

    id: str
    action: dict
    started_at: date
    status: str = "running"


class ClosedAction(BaseModel):
    """An action an earlier run already judged (PRD §5.6): shown in the T9 log
    with its stored verdict, never re-measured."""

    model_config = ConfigDict(frozen=True)

    id: str
    action: dict
    started_at: date | None = None
    status: Literal["worked", "weak", "failed"]
    measured_value: float | None = None
    category_delta: float | None = None
    measured_at: date | None = None


class Classification(BaseModel):
    """PRD §5.2 — resolved once per run by code, exported so the AM sees why."""

    model_config = ConfigDict(frozen=True)

    report_class: ReportClass
    score: int
    inferred_class: ReportClass
    overridden: bool = False
    inputs: dict[str, float | str | None] = Field(default_factory=dict)


class StrategyFrame(BaseModel):
    """The validated input to one strategy run. Every series ends at `as_of`
    (a settled TTMS day) and reaches back `history_days`."""

    model_config = ConfigDict(frozen=True)

    tenant_id: str
    client_slug: str
    client_name: str
    north_star: str
    currency: str = "IDR"
    ttms_account_id: str
    brand_name: str
    vertical: str | None = None
    plan: str | None = None
    is_lite: bool = True
    unavailable_metrics: list[str] = Field(default_factory=list)
    as_of: date
    window_days: int = 28
    current_start: date
    prior_start: date
    prior_end: date
    history_days: int
    benchmark: BenchmarkLevel = DEFAULT_BENCHMARK
    audience: dict[str, list[AudienceDay]] = Field(default_factory=dict)
    #: Keyed "metric|content_type", e.g. "impressions|all".
    insights: dict[str, list[InsightDay]] = Field(default_factory=dict)
    competitors: dict[str, list[CompetitorRank]] = Field(default_factory=dict)
    spend: list[SpendDay] = Field(default_factory=list)
    goal: StrategyGoal | None = None
    creator_fee_monthly: float | None = None
    bgc_cost_monthly: float | None = None
    open_actions: list[OpenAction] = Field(default_factory=list)
    closed_actions: list[ClosedAction] = Field(default_factory=list)
    classification: Classification
    generated_at: datetime

    def insight(self, metric: str, content_type: str = "all") -> list[InsightDay]:
        return self.insights.get(f"{metric}|{content_type}", [])

    def in_window(self, d: date, which: Literal["current", "prior"] = "current") -> bool:
        if which == "current":
            return self.current_start <= d <= self.as_of
        return self.prior_start <= d <= self.prior_end


# ─── Action List (PRD §5.4, LOCKED) ──────────────────────────────────────────

Lever = Literal["content_mix", "budget_cap", "stage_targeting", "creative_refresh", "creator_boost", "investigate"]


class ActionValue(BaseModel):
    model_config = ConfigDict(frozen=True)

    value: float
    format: Literal["percent", "number", "idr", "rank", "ratio"]
    as_of: date | None = None
    by: date | None = None


class ActionStake(BaseModel):
    model_config = ConfigDict(frozen=True)

    value: float
    unit: Literal["impressions", "people", "idr", "ranks"]
    range: tuple[float, float]


class KillSignal(BaseModel):
    model_config = ConfigDict(frozen=True)

    metric_key: str
    condition: Literal["no_rise_within_days", "no_fall_within_days"]
    days: int


class ActionCopy(BaseModel):
    """Written by the Action Phraser (full tier) or `deterministic_action_copy`."""

    model_config = ConfigDict(frozen=True)

    langkah: str
    dasar: str
    cara: str
    gagal_jika: str


class ActionItem(BaseModel):
    """One sized, dated, falsifiable decision. Every number is the Target
    Solver's; `copy` is the only part a model may write, and the Action Gate
    checks it against these numbers."""

    model_config = ConfigDict(frozen=True, populate_by_name=True, serialize_by_alias=True)

    id: str
    rank: int
    priority: Literal["P0", "P1", "P2"]
    lever: Lever
    metric_key: str
    entity: dict
    current: ActionValue | None
    target: ActionValue | None
    horizon_days: int
    delta: dict[str, float] | None = None
    stake: ActionStake | None = None
    basis: Literal["benchmark_top10", "own_history", "solver_cap", "defensive"]
    confidence: Literal["high", "medium", "low"]
    kill_signal: KillSignal | None
    evidence_refs: list[str]
    #: Bahasa phrase for the lever's subject (PRD §5.4 rule 3), for the copy writers.
    subject: str = ""
    # Exported as "copy" (PRD §5.4); the Python name avoids shadowing BaseModel.copy.
    copy_: ActionCopy | None = Field(default=None, alias="copy")


# ─── Export blocks (PRD §10, additive on BriefContentV2) ─────────────────────


class Signal(BaseModel):
    """One T8 early-warning row."""

    model_config = ConfigDict(frozen=True)

    finding_id: str | None
    kind: str
    status: Literal["investigate", "watch", "good", "locked"]
    title: str
    detail: str


class GoalPace(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: str
    stage: str | None = None
    metric: str | None = None
    target: float
    deadline: date
    current: float | None = None
    projected: float | None = None
    projected_low: float | None = None
    projected_high: float | None = None
    required_pace_per_week: float | None = None
    current_pace_per_week: float | None = None
    feasibility: float | None = None
    status: Literal["on_track", "off_track", "unreachable", "no_goal", "insufficient_history"]
    weekly: list[dict] = Field(default_factory=list)


class ActionMeasured(BaseModel):
    model_config = ConfigDict(frozen=True)

    action_id: str
    started_at: date
    langkah: str | None = None
    metric_key: str
    start_value: float | None
    measured_value: float | None
    target_value: float | None
    category_delta: float | None
    verdict: Literal["worked", "weak", "failed", "running"]
    days_running: int


class StrategyCharts(BaseModel):
    """Series for the renderer's inline SVG charts — numbers the engine
    computed, so the report draws exactly what the findings say."""

    model_config = ConfigDict(frozen=True)

    funnel: list[dict] = Field(default_factory=list)
    spend_response: dict | None = None
    rank_weekly: list[dict] = Field(default_factory=list)
    content_mix: list[dict] = Field(default_factory=list)
    rank_list: dict | None = None
    stage_table: list[dict] = Field(default_factory=list)


class StrategyMeta(BaseModel):
    model_config = ConfigDict(frozen=True)

    ttms_account_id: str
    brand_name: str
    vertical: str | None = None
    plan: str | None = None
    is_lite: bool = True
    as_of: date
    window_start: date
    window_end: date
    benchmark: str = DEFAULT_BENCHMARK
    section_order: list[int] = Field(default_factory=list)
    prompt_version: str | None = None
    degraded: list[str] = Field(default_factory=list)
    eval: dict = Field(default_factory=dict)


# ─── Section drafts (instant templates or the narrators, PRD §8.3) ──────────


class StrategyParagraph(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=10, max_length=900)
    evidence_refs: list[str] = Field(min_length=1, max_length=5)


class StrategySectionDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    headline: str = Field(min_length=10, max_length=200)
    paragraphs: list[StrategyParagraph] = Field(min_length=1, max_length=3)
    implication: str | None = Field(default=None, max_length=500)


class VerdictChip(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    value: str
    status: Literal["critical", "watch", "good", "off_track", "on_track", "unknown"]
    finding_id: str | None = None


class VerdictDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    headline: str = Field(min_length=10, max_length=120)
    paragraph: str = Field(min_length=20, max_length=900)
    chips: list[VerdictChip] = Field(min_length=3, max_length=3)
