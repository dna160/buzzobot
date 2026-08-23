"""Shared result type for every instrument (PRD §5.2). An instrument
computes; it never asserts — `InstrumentResult.data` is plain numbers, and
turning that into a narratable claim is a separate, deterministic step
(`instruments/finding_builder.py`), never the instrument's own job.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from engine.contracts import EntityRef, FindingLevel


@dataclass(frozen=True)
class InstrumentResult:
    instrument: str
    ok: bool
    reason: str | None = None
    entity: EntityRef | None = None
    level: FindingLevel | None = None
    data: dict = field(default_factory=dict)
