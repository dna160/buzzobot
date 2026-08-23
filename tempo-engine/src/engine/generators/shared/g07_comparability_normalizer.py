"""G07 — Comparability Normalizer. PRD §6.3: "Runs first." Detects unequal
active days, recomputes per-active-unit deltas, flags sign flips — "Source
of the '-21% but only 4 active days' insight."
"""

from __future__ import annotations

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityRef, Finding, FindingLevel
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import account_record

# Active-day counts within this many days of each other are not worth a
# caveat — every real account has some day-to-day sync jitter.
ACTIVE_DAY_TOLERANCE = 1


class G07ComparabilityNormalizer(Generator):
    id = "G07"
    name = "Comparability Normalizer"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        frame = ctx.metric_frame
        if frame.prior_period is None:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no prior period to compare against"))

        current_days = frame.current_period.active_days
        prior_days = frame.prior_period.active_days
        if abs(current_days - prior_days) <= ACTIVE_DAY_TOLERANCE:
            return GeneratorResult(
                coverage_gap=CoverageGap(
                    generator=self.id,
                    reason=f"active-day counts are comparable ({current_days} vs {prior_days}); nothing to normalize",
                )
            )

        current = account_record(frame, "current")
        prior = account_record(frame, "prior")
        if current is None or prior is None:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="requires account-level current and prior records"))

        outcome_metric = ctx.objective_contract.primary_outcome
        if outcome_metric not in current.metrics or outcome_metric not in prior.metrics:
            return GeneratorResult(
                coverage_gap=CoverageGap(generator=self.id, reason=f"primary outcome {outcome_metric!r} missing from an account record")
            )

        current_total = current.metrics[outcome_metric]
        prior_total = prior.metrics[outcome_metric]
        if prior_total == 0 or current_days == 0 or prior_days == 0:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="zero prior total or zero active days; cannot normalize"))

        nominal_delta = (current_total - prior_total) / prior_total
        current_per_day = current_total / current_days
        prior_per_day = prior_total / prior_days
        per_day_delta = (current_per_day - prior_per_day) / prior_per_day

        sign_flip = (nominal_delta > 0) != (per_day_delta > 0)
        if not sign_flip:
            return GeneratorResult(
                coverage_gap=CoverageGap(
                    generator=self.id,
                    reason="active-day counts differ but the nominal and per-active-day deltas agree in sign",
                )
            )

        finding = Finding(
            id="g07_comparability_artifact",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[2, 6],
            entity=EntityRef(id=current.entity.id, display_name=current.entity.display_name),
            level=FindingLevel.ACCOUNT,
            claim_frame=ClaimFrame.COMPARABILITY_ARTIFACT.value,
            evidence={
                "outcome_metric": outcome_metric,
                "current_active_days": current_days,
                "prior_active_days": prior_days,
                "nominal_delta_pct": round(nominal_delta * 100, 2),
                "per_active_day_delta_pct": round(per_day_delta * 100, 2),
                "current_per_day": round(current_per_day, 2),
                "prior_per_day": round(prior_per_day, 2),
            },
            comparison=Comparison(
                basis=ComparisonBasis.PRIOR_PERIOD,
                baseline_value=prior_total,
                current_value=current_total,
                delta_abs=current_total - prior_total,
                delta_pct=nominal_delta,
                label=f"{current_days} active days vs {prior_days}",
            ),
            magnitude_pct=1.0,
            direction=Direction.NEUTRAL,
            actionability="low",
            confidence=Confidence.HIGH,
            caveats=[
                f"nominal delta reads {'positive' if nominal_delta > 0 else 'negative'} "
                f"but the per-active-day rate is actually {'higher' if per_day_delta > 0 else 'lower'} "
                "than the prior period — the sign difference is caused by active-day count alone"
            ],
            materiality=0.0,
            provenance=[f"account:{current.entity.id}:current+prior"],
        )
        return GeneratorResult(findings=[finding])
