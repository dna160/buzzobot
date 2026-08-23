"""Shared generators, parameterized by ObjectiveContract (PRD §6.3).

`SHARED_GENERATORS` order matches PRD §12's build order: G07 first
(comparability), then G01, G02, G03, G04, G05, G06, G08. G05 (marginal
return/saturation) was deferred to B8 per PRD §12 — "the probe loop ships
after a working non-agentic pipeline exists" — and is now built.
"""

from __future__ import annotations

from engine.generators.base import Generator
from engine.generators.shared.g01_identity_decomposition import G01IdentityDecomposition
from engine.generators.shared.g02_efficiency_outlier import G02EfficiencyOutlier
from engine.generators.shared.g03_concentration import G03Concentration
from engine.generators.shared.g04_zero_yield import G04ZeroYield
from engine.generators.shared.g05_marginal_return import G05MarginalReturn
from engine.generators.shared.g06_segment_contrast import G06SegmentContrast
from engine.generators.shared.g07_comparability_normalizer import G07ComparabilityNormalizer
from engine.generators.shared.g08_coverage_confidence import G08CoverageConfidenceAudit, assess_confidence_tier

SHARED_GENERATORS: tuple[Generator, ...] = (
    G07ComparabilityNormalizer(),
    G01IdentityDecomposition(),
    G02EfficiencyOutlier(),
    G03Concentration(),
    G04ZeroYield(),
    G05MarginalReturn(),
    G06SegmentContrast(),
    G08CoverageConfidenceAudit(),
)

__all__ = [
    "SHARED_GENERATORS",
    "G01IdentityDecomposition",
    "G02EfficiencyOutlier",
    "G03Concentration",
    "G04ZeroYield",
    "G05MarginalReturn",
    "G06SegmentContrast",
    "G07ComparabilityNormalizer",
    "G08CoverageConfidenceAudit",
    "assess_confidence_tier",
]
