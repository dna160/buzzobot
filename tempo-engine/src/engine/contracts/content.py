"""`BriefContent` v2 — the engine's export boundary (Brief Deck PRD §3.1).

v1 exported four keys (`s1`, `sections`, `s6`, `probe_loop`) and discarded the
findings, the rankings, the below-the-cut list, and the coverage audit — the
exact material a deck is made of. Widening that projection is additive: every
v1 key keeps its name and shape, so an existing caller reading `content["s1"]`
is unaffected.

Two rules this module exists to enforce:

1. **The server boundary exports state; it does not choose what to show.** No
   filtering, ranking, or prettifying happens here — `buildDeckModel` on the
   TypeScript side is the single place engine content, read-models, and the
   report spec meet (PRD §2, §3.2).
2. **The shape is checked in, not described.** `scripts/export_content_schema.py`
   writes this model's JSON Schema to `contracts/brief_content_v2.schema.json`,
   `tests/test_content_schema_export.py` fails when the file drifts from the
   model, and the TypeScript mirror validates itself against that same file
   (`packages/reports/src/deck/engine-content.drift.test.ts`). Same mechanism as
   the METRICS catalog port, in both directions.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from engine.contracts.finding import Finding

Tier = Literal["instant", "full"]


class GeneratorGap(BaseModel):
    """One generator that could not run, and why (`CoverageGap` as exported).
    PRD §6.2's "skip silently and register a coverage gap" — the deck renders
    these as counted denominators, so silence never reads as coverage."""

    model_config = ConfigDict(frozen=True)

    generator: str
    reason: str
    missing_metrics: list[str] = Field(default_factory=list)


class SectionSignals(BaseModel):
    """"4 dari 6 sinyal tersedia" for one section.

    `available` counts the distinct generators that actually contributed a
    finding to this section. `total` adds every generator that skipped with a
    coverage gap — deliberately conservative: a generator that never ran has no
    findings, so its section affinity is unknowable, and counting it against
    every section can understate coverage but can never overstate it.
    """

    model_config = ConfigDict(frozen=True)

    available: int = Field(ge=0)
    total: int = Field(ge=0)


class CoverageAudit(BaseModel):
    """G08's audit, exported as data instead of only as prose. Every field here
    is read from the G08 finding's own `evidence` dict or from the generator
    battery's coverage gaps — nothing is re-derived, so the numeral gate's
    guarantee extends to the coverage lines a deck prints."""

    model_config = ConfigDict(frozen=True)

    active_day_coverage_pct: float | None = None
    current_active_days: int | None = None
    recency_lag_days: int | None = None
    assessed_confidence: str | None = None
    missing_required_metrics: list[str] = Field(default_factory=list)
    missing_preferred_metrics: list[str] = Field(default_factory=list)
    generator_gaps: list[GeneratorGap] = Field(default_factory=list)
    signals: dict[str, SectionSignals] = Field(default_factory=dict)


class RankedEntry(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    materiality: float


class SectionRankingExport(BaseModel):
    """Per section: what was narrated, and what lost. PRD §6.5 — "persist the
    full ranked list including everything below the cut, that is the only
    signal that later tells us the presets are wrong." Lampiran C renders it."""

    model_config = ConfigDict(frozen=True)

    selected: list[str] = Field(default_factory=list)
    below_cut: list[RankedEntry] = Field(default_factory=list)


class ProbeLoopExport(BaseModel):
    model_config = ConfigDict(frozen=True)

    enabled: bool = False
    probes_executed: int = 0
    yield_rate: float = 0.0
    rounds_used: int = 0
    log: list[dict] = Field(default_factory=list)


class SectionEntry(BaseModel):
    """One narrated section. `draft` is a `SectionDraftFull` or
    `SectionDraftLow` (Hard Rule 8: the low tier has no `implication` field at
    all), kept as a dict here rather than a union so the confidence ladder stays
    owned by `llm/schemas.py` and this boundary does not fork it."""

    model_config = ConfigDict(frozen=True)

    draft: dict
    narration_source: str
    narration_attempts: int = 0
    critic_ok: bool | None = None
    critic_approved: bool | None = None
    critic_notes: str | None = None


class SynthesisEntry(BaseModel):
    """S1 or S6, plus how it was produced. `source` distinguishes the agent path
    from the deterministic writer — the deck's provenance footer prints it, per
    the doctrine that a thin brief must say it is thin."""

    model_config = ConfigDict(frozen=True)

    draft: dict
    source: str
    attempts: int = 0
    fallback_reason: str | None = None


class BriefContentV2(BaseModel):
    """What `GET /v1/briefs/{run_id}` and `POST /v1/briefs/sync` put under
    `content`. `content_version` is the discriminator a caller checks before
    reading anything below `s1`/`sections`/`s6`."""

    model_config = ConfigDict(frozen=True)

    content_version: Literal[2] = 2
    tier: Tier
    engine_version: str
    brief_type: str
    s1: SynthesisEntry | None = None
    sections: dict[str, SectionEntry] = Field(default_factory=dict)
    s6: SynthesisEntry | None = None
    findings: list[Finding] = Field(default_factory=list)
    rankings: dict[str, SectionRankingExport] = Field(default_factory=dict)
    coverage: CoverageAudit | None = None
    probe_loop: ProbeLoopExport = Field(default_factory=ProbeLoopExport)
