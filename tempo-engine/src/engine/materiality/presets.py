"""Documented materiality weight presets. PRD §6.5: "Documented presets per
archetype, never model-generated."

`materiality = sqrt(magnitude_pct) * actionability_weight * confidence_weight`

Square-rooting `magnitude_pct` is deliberate: a finding affecting 4% of the
account's outcome shouldn't score 25x lower than one affecting 100% (a raw
product would let one enormous-but-obvious finding crowd out everything
sharp but narrow) — sqrt compresses the magnitude axis so actionability and
confidence, not just size, decide the ranking. `actionability`/`confidence`
weights are linear: there is no equivalent crowding risk on a 3-point scale,
and a linear scale keeps the preset numbers directly interpretable ("medium
confidence costs this finding 25% of its score").

One preset per brief archetype. Awareness and Install (B9/B10) reuse
`_DEFAULT` rather than getting their own preset — the weights are keyed by
actionability/confidence *enum values*, not by brief-type-specific content,
and nothing about either objective's generators has produced evidence that
a different weighting is warranted. A future archetype that, say, weighs
confidence more heavily than actionability (a brand-safety context where
being *sure* matters more than being fast) gets its own preset, never a
per-call override — but "reuse the default until proven otherwise" is
itself the deliberate choice here, not an oversight.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from engine.contracts import Actionability, BriefType, Confidence


class MaterialityPreset(BaseModel):
    model_config = ConfigDict(frozen=True)

    actionability_weight: dict[Actionability, float]
    confidence_weight: dict[Confidence, float]


_DEFAULT = MaterialityPreset(
    actionability_weight={
        Actionability.HIGH: 1.0,
        Actionability.MEDIUM: 0.7,
        Actionability.LOW: 0.4,
    },
    confidence_weight={
        Confidence.HIGH: 1.0,
        Confidence.MEDIUM: 0.75,
        Confidence.LOW: 0.5,
    },
)

MATERIALITY_PRESETS: dict[BriefType, MaterialityPreset] = {
    "gmv": _DEFAULT,
    "awareness": _DEFAULT,
    "install": _DEFAULT,
}
