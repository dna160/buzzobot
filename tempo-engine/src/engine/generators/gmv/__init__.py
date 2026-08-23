"""GMV-specific generators (PRD §6.3). Built out of sequence (ahead of any
explicit B0-B14 milestone — the build order never schedules M01-M04) to
close the B3 exit-gate's S4/S5 gap; see the tempo-engine session notes.
"""

from __future__ import annotations

from engine.generators.base import Generator
from engine.generators.gmv.m01_live_session_efficiency import M01LiveSessionEfficiency
from engine.generators.gmv.m02_aov_mix_shift import M02AovMixShift
from engine.generators.gmv.m03_creator_ladder import M03CreatorLadder
from engine.generators.gmv.m04_sku_lifecycle import M04SkuLifecycleContribution

GMV_GENERATORS: tuple[Generator, ...] = (
    M01LiveSessionEfficiency(),
    M02AovMixShift(),
    M03CreatorLadder(),
    M04SkuLifecycleContribution(),
)

__all__ = ["GMV_GENERATORS", "M01LiveSessionEfficiency", "M02AovMixShift", "M03CreatorLadder", "M04SkuLifecycleContribution"]
