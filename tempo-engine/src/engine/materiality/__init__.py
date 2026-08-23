"""Materiality scoring and section routing (PRD §6.5). Deterministic,
documented presets — never model-generated (Hard Rule 1)."""

from engine.materiality.presets import MATERIALITY_PRESETS, MaterialityPreset
from engine.materiality.router import RankedFinding, SectionRanking, route_all_sections, route_section
from engine.materiality.scorer import score_finding, score_findings

__all__ = [
    "MATERIALITY_PRESETS",
    "MaterialityPreset",
    "RankedFinding",
    "SectionRanking",
    "route_all_sections",
    "route_section",
    "score_finding",
    "score_findings",
]
