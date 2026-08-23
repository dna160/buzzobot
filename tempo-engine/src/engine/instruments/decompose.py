"""`decompose(identity_chain, level, period_a, period_b)` — PRD §5.2. Like
G01, but at any entity the analyst names, not just the account rollup —
e.g. "decompose the GMV delta for the top SKU into price vs. volume,"
exactly the example PRD §5.2 itself gives for what the probe loop is for.
"""

from __future__ import annotations

from engine.contracts import EntityLevel, EntityRef, MetricFrame, ObjectiveContract
from engine.generators._util import account_record, finding_level_of, flatten_identity_chain, records_by_level
from engine.instruments.base import InstrumentResult
from engine.stats import lmdi_additive_decomposition


def decompose(
    frame: MetricFrame, contract: ObjectiveContract, level: EntityLevel, entity_id: str | None = None
) -> InstrumentResult:
    if level == EntityLevel.ACCOUNT or entity_id is None:
        current = account_record(frame, "current")
        prior = account_record(frame, "prior")
        entity_ref = EntityRef(id=current.entity.id, display_name=current.entity.display_name) if current else None
        target_level = EntityLevel.ACCOUNT
    else:
        current_candidates = {r.entity.id: r for r in records_by_level(frame, level, "current")}
        prior_candidates = {r.entity.id: r for r in records_by_level(frame, level, "prior")}
        current = current_candidates.get(entity_id)
        prior = prior_candidates.get(entity_id)
        entity_ref = EntityRef(id=entity_id, display_name=current.entity.display_name) if current else None
        target_level = level

    if current is None or prior is None:
        return InstrumentResult(
            instrument="decompose", ok=False,
            reason=f"no current+prior record for {level.value} entity_id={entity_id!r}",
        )

    root_factors, divisor = flatten_identity_chain(contract)
    missing = sorted({f for f in root_factors if f not in current.metrics or f not in prior.metrics})
    if missing:
        return InstrumentResult(instrument="decompose", ok=False, reason=f"missing factor(s) in one or both periods: {missing}")

    current_factors = {f: current.metrics[f] for f in root_factors}
    prior_factors = {f: prior.metrics[f] for f in root_factors}
    if any(v <= 0 for v in current_factors.values()) or any(v <= 0 for v in prior_factors.values()):
        return InstrumentResult(instrument="decompose", ok=False, reason="a factor is zero or negative in a period; LMDI requires positive factors")

    raw = lmdi_additive_decomposition(current_factors, prior_factors)
    contributions = raw if divisor == 1.0 else {k: v / divisor for k, v in raw.items()}

    outcome = contract.primary_outcome
    delta = current.metrics[outcome] - prior.metrics[outcome]

    return InstrumentResult(
        instrument="decompose", ok=True, entity=entity_ref, level=finding_level_of(target_level),
        data={
            "outcome": outcome,
            "current_value": current.metrics[outcome],
            "prior_value": prior.metrics[outcome],
            "delta": delta,
            "contributions": {f"{k}_contribution": v for k, v in contributions.items()},
            "factors": {f"{k}_current": current_factors[k] for k in root_factors}
            | {f"{k}_prior": prior_factors[k] for k in root_factors},
        },
    )
