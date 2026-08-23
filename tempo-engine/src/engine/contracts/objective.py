"""ObjectiveContract, IdentityEquation, MetricTier — per PRD §6.2.

Every generator is parameterized by an `ObjectiveContract`, never
special-cased per brief type — one G02 across three contracts (Hard Rule 6
in spirit; this PRD version doesn't restate that exact numbering but §6.3's
generator catalogue is written the same way: "Shared, parameterized by
contract").
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from engine.contracts.metric_frame import BriefType


class MetricAvailability(str, Enum):
    """PRD §6.2: "Metrics are declared required / preferred / optional.
    Generators needing absent metrics skip silently and register a coverage
    gap, which feeds S6 confidence." """

    REQUIRED = "required"
    PREFERRED = "preferred"
    OPTIONAL = "optional"


class MetricTier(BaseModel):
    model_config = ConfigDict(frozen=True)

    metric: str
    availability: MetricAvailability


class IdentityEquation(BaseModel):
    """One multiplicative identity in a brief's funnel chain:
    outcome = factor_1 x factor_2 x ... / divisor. Consumed by G01's LMDI
    decomposition (B2)."""

    model_config = ConfigDict(frozen=True)

    outcome: str
    factors: list[str] = Field(min_length=2)
    divisor: float = 1.0


class ObjectiveContract(BaseModel):
    """The funnel identity chain, primary outcome, and efficiency metric for
    one brief type — PRD §6.2's table, one field per column. Concrete
    instances live in `contracts/presets.py`, one per brief type, reused
    everywhere that brief type is analyzed (the Sovella fixture, the live
    Tempo adapter, and the brief container all import the same instance).
    """

    model_config = ConfigDict(frozen=True)

    brief_type: BriefType
    primary_outcome: str
    efficiency_metric: str
    identity_chain: list[IdentityEquation] = Field(min_length=1)
    core_metrics: list[str] = Field(min_length=1)
    entity_axes: list[str] = Field(default_factory=list)
    metric_tiers: list[MetricTier] = Field(min_length=1)
    waste_definition: str
    additivity_trap: str
    """The §6.2 "Additivity trap" column — the specific way a naive rollup
    goes wrong for this objective (e.g. "reach non-additive" for Awareness,
    "ROI is a ratio, never averaged" for GMV). Documentation carried in the
    contract itself so a generator or a reviewer reads the warning in the
    same place as the metrics it applies to, not in a separate doc that
    drifts out of sync."""

    @model_validator(mode="after")
    def _identity_chain_uses_declared_metrics(self) -> ObjectiveContract:
        declared = set(self.core_metrics)
        for eq in self.identity_chain:
            for name in (eq.outcome, *eq.factors):
                if name not in declared:
                    raise ValueError(
                        f"identity_chain references metric {name!r} not present in "
                        f"core_metrics {sorted(declared)}"
                    )
        return self

    @model_validator(mode="after")
    def _primary_outcome_is_a_core_metric(self) -> ObjectiveContract:
        if self.primary_outcome not in self.core_metrics:
            raise ValueError(f"primary_outcome {self.primary_outcome!r} must be one of core_metrics")
        return self

    def tier_of(self, metric: str) -> MetricAvailability | None:
        for t in self.metric_tiers:
            if t.metric == metric:
                return t.availability
        return None

    def required_metrics(self) -> list[str]:
        return [t.metric for t in self.metric_tiers if t.availability == MetricAvailability.REQUIRED]
