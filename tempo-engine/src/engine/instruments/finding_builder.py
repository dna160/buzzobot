"""Converts an `InstrumentResult` into a `Finding` — deterministic code, not
the analyst agent (Hard Rule 1: "only code may answer"). Reuses the SAME
claim-frame vocabulary the corresponding generator would use — a probe
asking for concentration on a different level/metric than G03's fixed
defaults is still, structurally, a concentration claim; `origin="probe"` is
what distinguishes it, not a new frame (Hard Rule 3's own distinction:
"new analytical claim" means a new *kind* of claim, not new parameters on
an existing one).
"""

from __future__ import annotations

from engine.contracts import ClaimFrame, Confidence, Direction, Finding, Origin
from engine.instruments.base import InstrumentResult


def _section_affinity_for(instrument: str) -> list[int]:
    return {
        "concentration": [3, 6],
        "efficiency_outliers": [3, 4],
        "decompose": [2, 5],
        "segment_contrast": [4, 5],
        "marginal_return": [3, 6],
        "cohort_slice": [5],
    }.get(instrument, [6])


def build_finding_from_instrument(
    result: InstrumentResult,
    *,
    finding_id: str,
    tenant_id: str,
    brief_type: str,
    probe_id: str,
) -> Finding | None:
    """None when the instrument itself found nothing narratable
    (`result.ok is False`) — a null probe result is not a Finding, it's
    exactly the "yield" signal the probe loop logs (PRD §5.2: "log probe
    yield rate")."""
    if not result.ok or result.entity is None or result.level is None:
        return None

    claim_frame, magnitude_pct, direction, actionability = _interpret(result)

    return Finding(
        id=finding_id,
        generator=f"analyst_probe:{result.instrument}",
        tenant_id=tenant_id,
        brief_type=brief_type,
        section_affinity=_section_affinity_for(result.instrument),
        entity=result.entity,
        level=result.level,
        claim_frame=claim_frame.value,
        evidence=_flatten_evidence(result.data),
        comparison=None,
        magnitude_pct=magnitude_pct,
        direction=direction,
        actionability=actionability,
        confidence=Confidence.MEDIUM,  # a probe is one-off, agent-directed — never HIGH by default; the fixed battery earns HIGH by running every time.
        caveats=[f"produced by the analyst probe loop (probe_id={probe_id}), not the fixed generator battery"],
        materiality=0.0,
        provenance=[f"probe:{result.instrument}:{probe_id}"],
        origin=Origin.PROBE,
    )


def _flatten_evidence(data: dict) -> dict[str, float | int | str]:
    """Finding.evidence values must be float|int|str — an instrument's
    `data` can carry small nested dicts/lists (e.g. `decompose`'s per-factor
    contributions); flattened one level deep with a prefix, dropped if that
    still isn't a scalar rather than silently coercing something lossy."""
    flat: dict[str, float | int | str] = {}
    for key, value in data.items():
        if isinstance(value, (int, float, str)) and not isinstance(value, bool):
            flat[key] = value
        elif isinstance(value, dict):
            for sub_key, sub_value in value.items():
                if isinstance(sub_value, (int, float, str)) and not isinstance(sub_value, bool):
                    flat[f"{key}.{sub_key}"] = sub_value
        elif isinstance(value, list) and value and isinstance(value[0], dict):
            # e.g. efficiency_outliers' `outliers` list — surface the top entry's scalars.
            for sub_key, sub_value in value[0].items():
                if isinstance(sub_value, (int, float, str)) and not isinstance(sub_value, bool):
                    flat[f"{key}[0].{sub_key}"] = sub_value
    return flat


def _interpret(result: InstrumentResult) -> tuple[ClaimFrame, float, Direction, str]:
    data = result.data
    if result.instrument == "concentration":
        return ClaimFrame.CONCENTRATION_DEPENDENCY, float(data.get("top1_share", 0.1)), Direction.NEUTRAL, "medium"

    if result.instrument == "efficiency_outliers":
        outliers = data.get("outliers", [])
        top_z = max((o["z_score"] for o in outliers), key=abs, default=0.0)
        frame = ClaimFrame.EFFICIENCY_OUTLIER_POSITIVE if top_z > 0 else ClaimFrame.EFFICIENCY_OUTLIER_NEGATIVE
        return frame, 0.05, (Direction.POSITIVE if top_z > 0 else Direction.NEGATIVE), "high"

    if result.instrument == "decompose":
        delta = float(data.get("delta", 0.0))
        return ClaimFrame.IDENTITY_DECOMPOSITION, 1.0, (Direction.POSITIVE if delta > 0 else Direction.NEGATIVE if delta < 0 else Direction.NEUTRAL), "medium"

    if result.instrument == "segment_contrast":
        return ClaimFrame.ATTRIBUTE_PERFORMANCE_CORRELATION, 0.1, Direction.POSITIVE, "medium"

    if result.instrument == "marginal_return":
        candidates = data.get("candidates", [])
        scaling_up = any(c["direction"] == "scale_up" for c in candidates)
        frame = ClaimFrame.MARGINAL_RETURN_SCALING if scaling_up else ClaimFrame.MARGINAL_RETURN_DECLINING
        return frame, 0.1, (Direction.POSITIVE if scaling_up else Direction.NEGATIVE), "high"

    # cohort_slice: descriptive only.
    return ClaimFrame.COHORT_SLICE_SUMMARY, 0.1, Direction.NEUTRAL, "low"
