"""Finding, Comparison, ClaimFrame — per PRD §6.1, the contract everything
upstream (generators, the probe loop) produces and everything downstream
(materiality, narrators, gates) consumes exactly and only.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from engine.contracts.metric_frame import BriefType


class ClaimFrame(str, Enum):
    """The closed vocabulary of analytical claims (PRD §6.1, Hard Rule 3:
    "New analytical claim = new generator + new frame. Never a prompt
    edit."). One value per shared generator (PRD §6.3), except G02 and G05
    which are inherently two-directional. Objective-specific generators
    (A01-A04, M01-M04, N01-N04) extend this at B9/B10/B8 respectively.
    """

    IDENTITY_DECOMPOSITION = "identity_decomposition"  # G01
    EFFICIENCY_OUTLIER_POSITIVE = "efficiency_outlier_positive"  # G02
    EFFICIENCY_OUTLIER_NEGATIVE = "efficiency_outlier_negative"  # G02
    CONCENTRATION_DEPENDENCY = "concentration_dependency"  # G03
    ZERO_YIELD_SPEND = "zero_yield_spend"  # G04
    MARGINAL_RETURN_SCALING = "marginal_return_scaling"  # G05
    MARGINAL_RETURN_DECLINING = "marginal_return_declining"  # G05
    ATTRIBUTE_PERFORMANCE_CORRELATION = "attribute_performance_correlation"  # G06
    COMPARABILITY_ARTIFACT = "comparability_artifact"  # G07
    DATA_COVERAGE_GAP = "data_coverage_gap"  # G08

    # GMV-specific (PRD §6.3), added when M01-M04 were built out of sequence
    # to close the B3 exit-gate's S4/S5 gap.
    SESSION_EFFICIENCY_LEADER = "session_efficiency_leader"  # M01
    SESSION_EFFICIENCY_LAGGARD = "session_efficiency_laggard"  # M01
    AOV_MIX_SHIFT = "aov_mix_shift"  # M02
    CREATOR_LADDER_LEADER = "creator_ladder_leader"  # M03
    CREATOR_LADDER_LAGGARD = "creator_ladder_laggard"  # M03
    SKU_LIFECYCLE_CONTRIBUTION = "sku_lifecycle_contribution"  # M04

    # B7 probe loop: `cohort_slice` is the one instrument (PRD §5.2) whose
    # result shape doesn't fit any existing frame — a plain aggregated
    # slice, not an outlier/concentration/decomposition claim. The other
    # five instruments reuse the frames above (same claim, agent-chosen
    # parameters — not a new claim), per Hard Rule 3's own distinction.
    COHORT_SLICE_SUMMARY = "cohort_slice_summary"

    # Awareness-specific (PRD §6.3, B9)
    FREQUENCY_OVER_EXPOSED = "frequency_over_exposed"  # A01
    FREQUENCY_UNDER_SATURATED = "frequency_under_saturated"  # A01
    RETENTION_HOOK_WITHOUT_HOLD = "retention_hook_without_hold"  # A02
    RETENTION_STRONG_HOLD = "retention_strong_hold"  # A02
    INCREMENTAL_REACH_EFFICIENT = "incremental_reach_efficient"  # A03
    INCREMENTAL_REACH_SATURATING = "incremental_reach_saturating"  # A03
    # PRD names A04 "placement overlap proxy" — Tempo has no placement
    # dimension (verified against packages/db/src/schema.ts: paid_hourly_
    # metrics has no placement/audience/creative/format/daypart column at
    # all), so campaign->adgroup reach dedup is the closest real analog —
    # see generators/awareness/a04_reach_overlap.py.
    ADGROUP_REACH_OVERLAP = "adgroup_reach_overlap"  # A04

    # Install-specific (PRD §6.3, B10). PRD's "Activated Installs"/"ActRate"
    # concept does not exist in Tempo's schema (no second conversion-stage
    # column at all — see INSTALL_OBJECTIVE_CONTRACT.additivity_trap); every
    # frame below targets raw installs, never a fabricated activation figure.
    FUNNEL_LEAK_CLICK_TO_INSTALL = "funnel_leak_click_to_install"  # N01
    COHORT_QUALITY_RISK = "cohort_quality_risk"  # N02 — cheap CPI, low install rate
    COHORT_QUALITY_STRONG = "cohort_quality_strong"  # N02 — high install rate, worth the CPI
    CPI_EFFICIENCY_SCALING = "cpi_efficiency_scaling"  # N03
    CPI_EFFICIENCY_SATURATING = "cpi_efficiency_saturating"  # N03
    INSTALL_RATE_ANOMALY = "install_rate_anomaly"  # N04 — flagged, not asserted (PRD §6.3)


class FindingLevel(str, Enum):
    """The entity granularity a `Finding` is about (PRD §6.1). Hard Rule 2:
    "Never sum across levels" — every `Finding` states unambiguously which
    single level it is, so a property test can grep for a finding whose
    `evidence` mixes figures from two levels without inspecting prose.

    PRD §6.1's literal type omits `account`, but G01 (identity
    decomposition) and G07 (comparability normalizer) — arguably the two
    highest-value generators in the catalogue (§6.3 calls G01 "highest-value
    generator" outright) — both operate on the whole-account rollup, not any
    single campaign/adgroup/etc. Excluding `account` would make those two
    generators unable to produce a schema-valid `Finding` at all. Added here
    as a corrected reading rather than worked around; flagged for review.
    """

    ACCOUNT = "account"
    CAMPAIGN = "campaign"
    ADGROUP = "adgroup"
    CREATIVE = "creative"
    PRODUCT = "product"
    CREATOR = "creator"
    SESSION = "session"


class EntityRef(BaseModel):
    """Which specific thing a `Finding` is about. `FindingLevel` (a sibling
    field on `Finding`, not here) states what *kind* of thing — kept
    separate per PRD §3.1's explicit-level rule, not folded into this ref."""

    model_config = ConfigDict(frozen=True)

    id: str
    display_name: str


class ComparisonBasis(str, Enum):
    PRIOR_PERIOD = "prior_period"
    COHORT_MEDIAN = "cohort_median"
    ACCOUNT_BASELINE = "account_baseline"


class Comparison(BaseModel):
    model_config = ConfigDict(frozen=True)

    basis: ComparisonBasis
    baseline_value: float
    current_value: float
    delta_abs: float
    delta_pct: float | None = None
    label: str | None = None


class Direction(str, Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"


class Actionability(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Confidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Origin(str, Enum):
    """Whether a `Finding` came from the fixed generator battery or the
    analyst agent's probe loop (PRD §5.2, B7 — not built until B7, but the
    field exists from B1 so nothing downstream needs a schema migration
    when the probe loop lands)."""

    GENERATOR = "generator"
    PROBE = "probe"


_CLAIM_FRAME_VALUES = frozenset(f.value for f in ClaimFrame)


class Finding(BaseModel):
    """One computed, ranked, narratable observation. Per PRD §6.1, plus
    `tenant_id` — not in the PRD's abbreviated snippet, but Hard Rule 6
    ("tenant_id bound at the API boundary, carried in every typed payload,
    asserted at every graph node") is unambiguous and the snippet is
    illustrative rather than exhaustive (it also omits pydantic's own
    `model_config`, which nobody would argue should be left out)."""

    model_config = ConfigDict(frozen=True)

    id: str
    generator: str
    tenant_id: str
    brief_type: BriefType
    section_affinity: list[int] = Field(min_length=1)
    entity: EntityRef
    level: FindingLevel
    claim_frame: str
    evidence: dict[str, float | int | str]
    comparison: Comparison | None
    magnitude_pct: float = Field(ge=0.0, le=1.0)
    direction: Direction
    actionability: Actionability
    confidence: Confidence
    caveats: list[str] = Field(default_factory=list)
    materiality: float = Field(ge=0.0, le=1.0)
    provenance: list[str] = Field(default_factory=list)
    origin: Origin = Origin.GENERATOR

    @field_validator("claim_frame")
    @classmethod
    def _claim_frame_is_registered(cls, v: str) -> str:
        if v not in _CLAIM_FRAME_VALUES:
            raise ValueError(
                f"claim_frame {v!r} is not in the closed ClaimFrame vocabulary "
                f"({sorted(_CLAIM_FRAME_VALUES)}). Add a new ClaimFrame member "
                "instead of passing an ad-hoc string — see Hard Rule 3."
            )
        return v

    @field_validator("section_affinity")
    @classmethod
    def _sections_in_range(cls, v: list[int]) -> list[int]:
        # S1 is written last from accepted S2-S6 content and never receives
        # a Finding directly (PRD §4.1, §5.6).
        if any(s < 2 or s > 6 for s in v):
            raise ValueError("section_affinity values must be in 2..6 (S1 is synthesized, not fed)")
        return v
