"""Awareness-specific generators (PRD §6.3, B9)."""

from __future__ import annotations

from engine.generators.awareness.a01_frequency_distribution import A01FrequencyDistribution
from engine.generators.awareness.a02_retention_curve import A02RetentionCurve
from engine.generators.awareness.a03_incremental_reach_efficiency import A03IncrementalReachEfficiency
from engine.generators.awareness.a04_reach_overlap import A04ReachOverlap
from engine.generators.base import Generator

AWARENESS_GENERATORS: tuple[Generator, ...] = (
    A01FrequencyDistribution(),
    A02RetentionCurve(),
    A03IncrementalReachEfficiency(),
    A04ReachOverlap(),
)

__all__ = ["AWARENESS_GENERATORS", "A01FrequencyDistribution", "A02RetentionCurve", "A03IncrementalReachEfficiency", "A04ReachOverlap"]
