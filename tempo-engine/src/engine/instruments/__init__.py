"""The six allowlisted, deterministic instruments the analyst agent may call
(PRD §5.2). Every one is a pure function of `(MetricFrame, ObjectiveContract,
**typed params) -> InstrumentResult` — no instrument mutates state, calls an
LLM, or does anything the agent couldn't in principle audit by reading the
source. This IS the tool allowlist (Hard Rule 4: "an agent with an open tool
surface is a bug") — the analyst cannot call anything not listed here.
"""

from __future__ import annotations

from engine.contracts import EntityLevel, MetricFrame, ObjectiveContract
from engine.instruments.base import InstrumentResult
from engine.instruments.cohort_slice import cohort_slice
from engine.instruments.concentration import concentration
from engine.instruments.decompose import decompose
from engine.instruments.efficiency_outliers import efficiency_outliers
from engine.instruments.marginal_return import marginal_return
from engine.instruments.segment_contrast import segment_contrast

INSTRUMENT_NAMES = (
    "concentration",
    "efficiency_outliers",
    "decompose",
    "segment_contrast",
    "marginal_return",
    "cohort_slice",
)


def run_instrument(
    name: str,
    frame: MetricFrame,
    contract: ObjectiveContract,
    *,
    level: str | None = None,
    metric: str | None = None,
    dimension: str | None = None,
    dimension_value: str | None = None,
    entity_id: str | None = None,
    min_volume_share: float = 0.01,
) -> InstrumentResult:
    """The single dispatch point the analyst's probe executor calls through
    — every probe request, regardless of instrument, funnels through here,
    so there is exactly one place that validates a request's required
    fields before touching the frame.

    The analyst chooses `level`/`dimension` values from a list given in its
    own prompt (`build_analyst_user_prompt`'s "AVAILABLE PARAMETERS"
    section), but a small local model does not always comply — a
    hallucinated `level` string (anything not a real `EntityLevel` member)
    must degrade to a failed probe (`ok=False`, real yield-rate signal),
    never an uncaught exception that takes down the whole graph run. This
    is exactly Hard Rule 1's "code validates whether the question was
    well-formed" — the validation was previously only presence-checking
    required fields, not their values.
    """
    try:
        if name == "concentration":
            if level is None or metric is None:
                return InstrumentResult(instrument=name, ok=False, reason="concentration requires level and metric")
            return concentration(frame, EntityLevel(level), metric)

        if name == "efficiency_outliers":
            if level is None or metric is None:
                return InstrumentResult(instrument=name, ok=False, reason="efficiency_outliers requires level and metric")
            return efficiency_outliers(frame, EntityLevel(level), metric, min_volume_share)

        if name == "decompose":
            if level is None:
                return InstrumentResult(instrument=name, ok=False, reason="decompose requires level")
            return decompose(frame, contract, EntityLevel(level), entity_id)

        if name == "segment_contrast":
            if dimension is None or metric is None:
                return InstrumentResult(instrument=name, ok=False, reason="segment_contrast requires dimension and metric")
            return segment_contrast(frame, dimension, metric)

        if name == "marginal_return":
            if level is None:
                return InstrumentResult(instrument=name, ok=False, reason="marginal_return requires level")
            return marginal_return(frame, contract, EntityLevel(level))

        if name == "cohort_slice":
            if dimension is None or dimension_value is None:
                return InstrumentResult(instrument=name, ok=False, reason="cohort_slice requires dimension and dimension_value")
            return cohort_slice(frame, dimension, dimension_value)
    except ValueError as exc:
        return InstrumentResult(instrument=name, ok=False, reason=f"invalid parameter value: {exc}")

    return InstrumentResult(instrument=name, ok=False, reason=f"unknown instrument {name!r} — not in the allowlist")


__all__ = ["INSTRUMENT_NAMES", "InstrumentResult", "run_instrument"]
