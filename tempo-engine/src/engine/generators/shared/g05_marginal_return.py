"""G05 — Marginal Return / Saturation. PRD §6.3: "Δoutcome/Δspend vs.
account average; log fit at ≥ 4 periods. Scale-up >1.3×, scale-down <0.6×."

v1's `MetricFrame` carries exactly two periods (current, prior) — the log
fit needs ≥ 4 and is not attempted here (same honesty as `assess_confidence_
tier`, which documents that HIGH confidence is unreachable with a 2-period
frame for the same reason). What v1 CAN do, and what this generator does:
the plain Δoutcome/Δspend ratio per entity vs. the account-wide ratio, same
math already proven live in the probe loop's `marginal_return` instrument
(`instruments/marginal_return.py`) — this generator runs it automatically
across every entity at every level with paired current+prior records,
instead of waiting for the analyst to ask.
"""

from __future__ import annotations

from collections import defaultdict

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityRef, Finding, MetricRecord
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import account_record, finding_level_of, non_account_records
from engine.stats import marginal_return

SCALE_UP_THRESHOLD = 1.3
SCALE_DOWN_THRESHOLD = 0.6


class G05MarginalReturn(Generator):
    id = "G05"
    name = "Marginal Return / Saturation"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        frame = ctx.metric_frame
        outcome_metric = ctx.objective_contract.primary_outcome

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
            paired_ids = sorted(set(current_by_id) & set(prior_by_id))
            for entity_id in paired_ids:
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
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no paired entity's marginal return fell outside the scale-up/scale-down band"))
        return GeneratorResult(findings=findings)

    def _finding(self, ctx: GeneratorContext, record: MetricRecord, outcome_metric: str, entity_marginal: float, account_marginal: float, ratio: float, magnitude_pct: float) -> Finding:
        scale_up = ratio > 1.0
        return Finding(
            id=f"g05_{record.entity.id}",
            generator=self.id,
            tenant_id=ctx.metric_frame.tenant_id,
            brief_type=ctx.metric_frame.brief_type,
            section_affinity=[3, 6],
            entity=EntityRef(id=record.entity.id, display_name=record.entity.display_name),
            level=finding_level_of(record.entity.level),
            claim_frame=(ClaimFrame.MARGINAL_RETURN_SCALING.value if scale_up else ClaimFrame.MARGINAL_RETURN_DECLINING.value),
            evidence={
                "outcome_metric": outcome_metric,
                "entity_marginal_return": round(entity_marginal, 4),
                "account_marginal_return": round(account_marginal, 4),
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
