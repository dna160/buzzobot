"""Generator ABC, registry, coverage-gap protocol (PRD §6.2, §6.3).

Every generator is a pure function of `GeneratorContext -> GeneratorResult`:
read the (frozen) `MetricFrame` and `ObjectiveContract`, either produce
`Finding`s or register why it could not. No generator calls the database,
calls the LLM, or mutates its input.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field

from engine.contracts import Finding, MetricFrame, ObjectiveContract


class CoverageGap(BaseModel):
    """Why a generator produced no findings — feeds G08 and §6's confidence
    notes. PRD §6.2: "Generators needing absent metrics skip silently and
    register a coverage gap." Never fabricate from missing data."""

    model_config = ConfigDict(frozen=True)

    generator: str
    reason: str
    missing_metrics: list[str] = Field(default_factory=list)


class GeneratorResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    findings: list[Finding] = Field(default_factory=list)
    coverage_gap: CoverageGap | None = None


class GeneratorContext(BaseModel):
    model_config = ConfigDict(frozen=True)

    metric_frame: MetricFrame
    objective_contract: ObjectiveContract


class Generator(ABC):
    """Base class for every shared (G01-G08) and objective-specific
    generator. `run()` performs the metric-presence check uniformly so no
    generator can forget it and silently fabricate an analysis."""

    id: ClassVar[str]
    name: ClassVar[str]
    requires: ClassVar[tuple[str, ...]] = ()

    def run(self, ctx: GeneratorContext) -> GeneratorResult:
        missing = self._missing_metrics(ctx)
        if missing:
            return GeneratorResult(
                coverage_gap=CoverageGap(
                    generator=self.id,
                    reason=(
                        f"{self.name} requires {missing} in at least one record of the "
                        "metric frame, and none was present."
                    ),
                    missing_metrics=missing,
                )
            )
        return self._generate(ctx)

    def _missing_metrics(self, ctx: GeneratorContext) -> list[str]:
        """A metric counts as present if *any* record carries it. Subclasses
        with a narrower requirement (e.g. "at account level specifically")
        re-check inside `_generate` and return their own coverage gap there."""
        present = {name for record in ctx.metric_frame.records for name in record.metrics}
        return [m for m in self.requires if m not in present]

    @abstractmethod
    def _generate(self, ctx: GeneratorContext) -> GeneratorResult: ...
