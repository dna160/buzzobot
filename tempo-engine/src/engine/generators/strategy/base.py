"""Strategy generator protocol: a pure function of a `StrategyFrame` (the
strategy brief's typed input) to findings or a coverage gap — the same
contract as `generators/base.py`, keyed on a different frame type."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar

from engine.contracts.strategy import StrategyFrame
from engine.generators.base import CoverageGap, GeneratorResult


class StrategyGenerator(ABC):
    id: ClassVar[str]
    name: ClassVar[str]

    def run(self, frame: StrategyFrame) -> GeneratorResult:
        return self._generate(frame)

    def gap(self, reason: str, missing: list[str] | None = None) -> GeneratorResult:
        return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason=reason, missing_metrics=missing or []))

    @abstractmethod
    def _generate(self, frame: StrategyFrame) -> GeneratorResult: ...


def history_confidence(frame: StrategyFrame) -> str:
    """PRD §7.4: HIGH is reachable once a benchmark set is present and there
    are ≥ 56 days of history; ≥ 14 days is MEDIUM; less is LOW."""
    days = len(frame.audience.get("awareness", []))
    has_bench = any(d.bench_total.get(frame.benchmark) for d in frame.audience.get("awareness", []))
    if days >= 56 and has_bench:
        return "high"
    return "medium" if days >= 14 else "low"
