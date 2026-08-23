"""Public contracts API. See docs/PRD_tempo_intelligence_engine.md §6."""

from engine.contracts.finding import (
    Actionability,
    ClaimFrame,
    Comparison,
    ComparisonBasis,
    Confidence,
    Direction,
    EntityRef,
    Finding,
    FindingLevel,
    Origin,
)
from engine.contracts.metric_frame import (
    BriefType,
    Entity,
    EntityLevel,
    MetricFrame,
    MetricRecord,
    Period,
)
from engine.contracts.objective import (
    IdentityEquation,
    MetricAvailability,
    MetricTier,
    ObjectiveContract,
)
from engine.contracts.section import (
    SECTION_SPEC_BY_ID,
    SECTION_SPECS,
    SectionId,
    SectionPayload,
    SectionSpec,
)

__all__ = [
    "Actionability",
    "BriefType",
    "ClaimFrame",
    "Comparison",
    "ComparisonBasis",
    "Confidence",
    "Direction",
    "Entity",
    "EntityLevel",
    "EntityRef",
    "Finding",
    "FindingLevel",
    "IdentityEquation",
    "MetricAvailability",
    "MetricFrame",
    "MetricRecord",
    "MetricTier",
    "ObjectiveContract",
    "Origin",
    "Period",
    "SECTION_SPEC_BY_ID",
    "SECTION_SPECS",
    "SectionId",
    "SectionPayload",
    "SectionSpec",
]
