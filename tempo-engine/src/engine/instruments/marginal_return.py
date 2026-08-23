"""`marginal_return(entity_level, window)` — PRD §5.2. Δoutcome/Δspend per
entity vs. the account average, flagging scale-up/scale-down candidates —
the same math B8's G05 generator will run automatically; here it's
available on demand for whichever level/entity the analyst asks about."""

from __future__ import annotations

from engine.contracts import EntityLevel, EntityRef, MetricFrame, ObjectiveContract
from engine.generators._util import account_record, finding_level_of, records_by_level
from engine.instruments.base import InstrumentResult
from engine.stats import marginal_return as marginal_return_ratio

SCALE_UP_THRESHOLD = 1.3
SCALE_DOWN_THRESHOLD = 0.6


def marginal_return(frame: MetricFrame, contract: ObjectiveContract, entity_level: EntityLevel) -> InstrumentResult:
    outcome_metric = contract.primary_outcome
    account_current = account_record(frame, "current")
    account_prior = account_record(frame, "prior")
    if account_current is None or account_prior is None:
        return InstrumentResult(instrument="marginal_return", ok=False, reason="requires account-level current and prior records")

    account_marginal = marginal_return_ratio(
        account_current.metrics.get(outcome_metric, 0.0) - account_prior.metrics.get(outcome_metric, 0.0),
        account_current.metrics.get("cost", 0.0) - account_prior.metrics.get("cost", 0.0),
    )
    if account_marginal is None or account_marginal == 0:
        return InstrumentResult(instrument="marginal_return", ok=False, reason="account-level spend did not move between periods")

    current_by_id = {r.entity.id: r for r in records_by_level(frame, entity_level, "current")}
    prior_by_id = {r.entity.id: r for r in records_by_level(frame, entity_level, "prior")}
    paired_ids = sorted(set(current_by_id) & set(prior_by_id))
    if not paired_ids:
        return InstrumentResult(instrument="marginal_return", ok=False, reason=f"no {entity_level.value} entity has both current- and prior-period records")

    candidates = []
    for entity_id in paired_ids:
        cur, prior = current_by_id[entity_id], prior_by_id[entity_id]
        if outcome_metric not in cur.metrics or outcome_metric not in prior.metrics or "cost" not in cur.metrics or "cost" not in prior.metrics:
            continue
        entity_marginal = marginal_return_ratio(cur.metrics[outcome_metric] - prior.metrics[outcome_metric], cur.metrics["cost"] - prior.metrics["cost"])
        if entity_marginal is None:
            continue
        ratio = entity_marginal / account_marginal
        if ratio > SCALE_UP_THRESHOLD or ratio < SCALE_DOWN_THRESHOLD:
            candidates.append({"entity_id": entity_id, "entity_name": cur.entity.display_name, "ratio_to_account": round(ratio, 3), "direction": "scale_up" if ratio > 1 else "scale_down"})

    if not candidates:
        return InstrumentResult(instrument="marginal_return", ok=False, reason="no paired entity fell outside the scale-up/scale-down band")

    top = max(candidates, key=lambda c: abs(c["ratio_to_account"] - 1))
    return InstrumentResult(
        instrument="marginal_return", ok=True,
        entity=EntityRef(id=top["entity_id"], display_name=top["entity_name"]),
        level=finding_level_of(entity_level),
        data={"outcome_metric": outcome_metric, "account_marginal_return": round(account_marginal, 4), "candidates": candidates},
    )
