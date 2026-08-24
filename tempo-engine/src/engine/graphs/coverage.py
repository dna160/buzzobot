"""Assemble the exported `CoverageAudit` from what the generator battery
already produced. Brief Deck PRD §4: "Coverage gaps render as counted
denominators, not silence."

Nothing is computed here that a generator did not already compute — G08's own
evidence dict supplies the coverage percentage, the recency lag and the
confidence tier; the battery's `CoverageGap`s supply the skips. This module
only counts and reshapes, which is what keeps the numeral gate's guarantee
attached to the coverage lines a deck prints.
"""

from __future__ import annotations

from engine.contracts import Finding
from engine.contracts.content import CoverageAudit, GeneratorGap, SectionSignals
from engine.generators.base import CoverageGap
from engine.materiality.router import ROUTABLE_SECTIONS

G08_FINDING_ID = "g08_coverage_audit"


def _split_metric_list(raw: object) -> list[str]:
    """G08 stores its missing-metric lists as a comma-joined string with the
    literal "none" for empty (it has to: `evidence` values are scalars). Parsed
    back here rather than changing G08's shape, because that shape is what the
    numeral gate and the narrators already read."""
    if not isinstance(raw, str) or raw.strip() in ("", "none"):
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def build_coverage_audit(findings: list[Finding], gaps: list[CoverageGap]) -> CoverageAudit:
    audit = next((f for f in findings if f.id == G08_FINDING_ID), None)
    evidence: dict[str, float | int | str] = dict(audit.evidence) if audit else {}

    coverage_pct = evidence.get("active_day_coverage_pct")
    active_days = evidence.get("current_active_days")
    recency = evidence.get("recency_lag_days")
    confidence = evidence.get("assessed_confidence")

    skipped = len(gaps)
    signals: dict[str, SectionSignals] = {}
    for section_id in ROUTABLE_SECTIONS:
        contributing = {f.generator for f in findings if int(section_id) in f.section_affinity}
        signals[str(int(section_id))] = SectionSignals(
            available=len(contributing), total=len(contributing) + skipped
        )

    return CoverageAudit(
        active_day_coverage_pct=float(coverage_pct) if isinstance(coverage_pct, (int, float)) else None,
        current_active_days=int(active_days) if isinstance(active_days, (int, float)) else None,
        recency_lag_days=int(recency) if isinstance(recency, (int, float)) else None,
        assessed_confidence=str(confidence) if confidence is not None else None,
        missing_required_metrics=_split_metric_list(evidence.get("missing_required_metrics")),
        missing_preferred_metrics=_split_metric_list(evidence.get("missing_preferred_metrics")),
        generator_gaps=[
            GeneratorGap(generator=g.generator, reason=g.reason, missing_metrics=list(g.missing_metrics))
            for g in gaps
        ],
        signals=signals,
    )
