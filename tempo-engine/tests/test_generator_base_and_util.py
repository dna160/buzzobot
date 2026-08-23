"""The generator base class's coverage-gap protocol, and the identity-chain
flattening / level-conversion helpers other generators depend on.
"""

from __future__ import annotations

import pytest

from engine.contracts import EntityLevel
from engine.generators._util import finding_level_of, flatten_identity_chain
from engine.generators.base import Generator, GeneratorContext, GeneratorResult
from eval.fixtures.sovella_gmv_week import GMV_OBJECTIVE_CONTRACT, build_sovella_gmv_metric_frame


class _RequiresGhostMetric(Generator):
    id = "GX"
    name = "Test generator requiring an absent metric"
    requires = ("this_metric_does_not_exist_anywhere",)

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:  # pragma: no cover
        raise AssertionError("should have been short-circuited by the coverage-gap check")


class _RequiresRealMetric(Generator):
    id = "GY"
    name = "Test generator requiring gmv"
    requires = ("gmv",)

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        return GeneratorResult(findings=[])


def test_base_class_short_circuits_on_missing_required_metric() -> None:
    ctx = GeneratorContext(metric_frame=build_sovella_gmv_metric_frame(), objective_contract=GMV_OBJECTIVE_CONTRACT)
    result = _RequiresGhostMetric().run(ctx)
    assert result.findings == []
    assert result.coverage_gap is not None
    assert result.coverage_gap.generator == "GX"
    assert "this_metric_does_not_exist_anywhere" in result.coverage_gap.missing_metrics


def test_base_class_proceeds_when_required_metric_present() -> None:
    ctx = GeneratorContext(metric_frame=build_sovella_gmv_metric_frame(), objective_contract=GMV_OBJECTIVE_CONTRACT)
    result = _RequiresRealMetric().run(ctx)
    assert result.coverage_gap is None


def test_flatten_identity_chain_for_gmv() -> None:
    leaves, divisor = flatten_identity_chain(GMV_OBJECTIVE_CONTRACT)
    assert set(leaves) == {"impressions", "ctr", "cvr", "aov"}
    assert divisor == 1.0


def test_finding_level_of_maps_shared_values() -> None:
    assert finding_level_of(EntityLevel.ACCOUNT).value == "account"
    assert finding_level_of(EntityLevel.SESSION).value == "session"
    assert finding_level_of(EntityLevel.AD_GROUP).value == "adgroup"


def test_finding_level_of_rejects_unsupported_level() -> None:
    with pytest.raises(ValueError):
        finding_level_of(EntityLevel.PLACEMENT)
