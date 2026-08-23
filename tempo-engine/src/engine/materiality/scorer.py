"""materiality = sqrt(magnitude_pct) x actionability_weight x confidence_weight.
PRD §6.5. `Finding` is frozen — scoring returns a new `Finding` with
`materiality` set, never mutates in place.
"""

from __future__ import annotations

import math

from engine.contracts import BriefType, Finding
from engine.materiality.presets import MATERIALITY_PRESETS


def score_finding(finding: Finding, brief_type: BriefType) -> Finding:
    preset = MATERIALITY_PRESETS[brief_type]
    score = (
        math.sqrt(finding.magnitude_pct)
        * preset.actionability_weight[finding.actionability]
        * preset.confidence_weight[finding.confidence]
    )
    return finding.model_copy(update={"materiality": round(score, 6)})


def score_findings(findings: list[Finding], brief_type: BriefType) -> list[Finding]:
    return [score_finding(f, brief_type) for f in findings]
