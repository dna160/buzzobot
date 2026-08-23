"""A03 — Incremental Reach Efficiency. PRD §6.3: "incremental reach
efficiency." Same Δoutcome/Δspend-vs-account-average math as G05 (B8), here
denominated in `qualified_reach` instead of GMV — "how much MORE effectively-
reached audience does the next rupiah of spend buy this entity, vs. what it
buys the account overall."

Needs paired current+prior entity-level records, same limitation G05 has:
`tempo_read.py::build_awareness_metric_frame` mirrors `build_gmv_metric_
frame`'s depth exactly (campaign/adgroup: current period only; account:
both), so this generator reports a coverage gap on live Tempo data today —
true "depth parity" with G05, not an artificially deeper generator.
"""

from __future__ import annotations

from collections import defaultdict

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityRef, Finding, MetricRecord
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import account_record, finding_level_of, non_account_records
from engine.stats import marginal_return

SCALE_UP_THRESHOLD = 1.3
SCALE_DOWN_THRESHOLD = 0.6


class A03IncrementalReachEfficiency(Generator):
    id = "A03"
    name = "Incremental Reach Efficiency"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        frame = ctx.metric_frame
        outcome_metric = ctx.objective_contract.primary_outcome  # "qualified_reach"

        account_current = account_record(frame, "current")
        account_prior = account_record(frame, "prior")
        if account_current is None or account_prior is None:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="requires account-level current and prior records"))
        if outcome_metric not in account_current.metrics or outcome_metric not in account_prior.metrics or "cost" not in account_current.metrics or "cost" not in account_prior.metrics:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason=f"account-level records must carry both {outcome_metric!r} and 'cost'", missing_metrics=[outcome_metric, "cost"]))

        account_marginal = marginal_return(
            account_current.metrics[outcome_metric] - account_prior.metrics[outcome_metric],
            account_current.metrics["cost"] - account_prior.metrics["cost"],
        )
        if account_marginal is None or account_marginal == 0:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="account-level spend did not move between periods — no baseline to compare entities against"))

        current_by_level: dict[str, dict[str, MetricRecord]] = defaultdict(dict)
        for r in non_account_records(frame, "current"):
            current_by_level[r.entity.level.value][r.entity.id] = r
        prior_by_level: dict[str, dict[str, MetricRecord]] = defaultdict(dict)
        for r in non_account_records(frame, "prior"):
            prior_by_level[r.entity.level.value][r.entity.id] = r

        findings: list[Finding] = []
        for level, current_by_id in current_by_level.items():
            prior_by_id = prior_by_level.get(level, {})
            for entity_id in sorted(set(current_by_id) & set(prior_by_id)):
                cur, prior = current_by_id[entity_id], prior_by_id[entity_id]
                if outcome_metric not in cur.metrics or outcome_metric not in prior.metrics or "cost" not in cur.metrics or "cost" not in prior.metrics:
                    continue
                entity_marginal = marginal_return(cur.metrics[outcome_metric] - prior.metrics[outcome_metric], cur.metrics["cost"] - prior.metrics["cost"])
                if entity_marginal is None:
                    continue
                ratio = entity_marginal / account_marginal
                if SCALE_DOWN_THRESHOLD <= ratio <= SCALE_UP_THRESHOLD:
                    continue
                account_cost = account_current.metrics["cost"]
                magnitude_pct = min(1.0, cur.metrics["cost"] / account_cost) if account_cost else 0.0
                findings.append(self._finding(ctx, cur, outcome_metric, entity_marginal, account_marginal, ratio, magnitude_pct))

        if not findings:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no paired entity's incremental reach efficiency fell outside the scale-up/scale-down band"))
        return GeneratorResult(findings=findings)

    def _finding(self, ctx: GeneratorContext, record: MetricRecord, outcome_metric: str, entity_marginal: float, account_marginal: float, ratio: float, magnitude_pct: float) -> Finding:
        scale_up = ratio > 1.0
        return Finding(
            id=f"a03_{record.entity.id}",
            generator=self.id,
            tenant_id=ctx.metric_frame.tenant_id,
            brief_type=ctx.metric_frame.brief_type,
            section_affinity=[3, 6],
            entity=EntityRef(id=record.entity.id, display_name=record.entity.display_name),
            level=finding_level_of(record.entity.level),
            claim_frame=(ClaimFrame.INCREMENTAL_REACH_EFFICIENT.value if scale_up else ClaimFrame.INCREMENTAL_REACH_SATURATING.value),
            evidence={
                "outcome_metric": outcome_metric,
                "entity_marginal_return": round(entity_marginal, 6),
                "account_marginal_return": round(account_marginal, 6),
                "ratio_to_account": round(ratio, 3),
            },
            comparison=Comparison(
                basis=ComparisonBasis.ACCOUNT_BASELINE,
                baseline_value=account_marginal,
                current_value=entity_marginal,
                delta_abs=entity_marginal - account_marginal,
                delta_pct=(entity_marginal - account_marginal) / account_marginal if account_marginal != 0 else None,
            ),
            magnitude_pct=magnitude_pct,
            direction=Direction.POSITIVE if scale_up else Direction.NEGATIVE,
            actionability="high",
            confidence=Confidence.MEDIUM,
            materiality=0.0,
            provenance=[f"{record.entity.level.value}:{record.entity.id}:current", f"{record.entity.level.value}:{record.entity.id}:prior", "account:current", "account:prior"],
        )
