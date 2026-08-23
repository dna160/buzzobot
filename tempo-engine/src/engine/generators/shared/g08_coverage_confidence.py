"""G08 — Coverage & Confidence Audit. PRD §6.3: null rates, entity coverage,
recency lag. Auto-writes S6 confidence notes.

Also exposes `assess_confidence_tier`, the pure function behind PRD §8's
confidence ladder — callable independently by the materiality/section router
(B3) since confidence tier gates which response schema a section is
narrated under (Hard Rule 8), not just something reported after the fact.
"""

from __future__ import annotations

from engine.contracts import ClaimFrame, Confidence, Direction, EntityRef, Finding, MetricAvailability, MetricFrame
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import account_record, finding_level_of

ACTIVE_DAY_TOLERANCE = 1  # kept in sync with G07's tolerance deliberately.

MIN_COVERAGE_FOR_MEDIUM = 0.80
MIN_COVERAGE_FOR_HIGH = 0.95
MIN_PERIODS_FOR_HIGH = 4


def assess_confidence_tier(frame: MetricFrame) -> Confidence:
    """PRD §8's confidence ladder.

    v1's `MetricFrame` carries at most two periods (current + prior) — no
    longitudinal series yet, so the >=4-period High-tier condition cannot be
    met until the benchmark/history layer lands (§6.4, gated on >=12
    periods). Honest reflection of what the data supports today, not a bug.
    """
    periods = 2 if frame.prior_period is not None else 1
    coverage = _period_coverage(frame)
    comparability_artifact = (
        frame.prior_period is not None
        and abs(frame.current_period.active_days - frame.prior_period.active_days) > ACTIVE_DAY_TOLERANCE
    )

    if periods >= MIN_PERIODS_FOR_HIGH and coverage >= MIN_COVERAGE_FOR_HIGH and not comparability_artifact:
        return Confidence.HIGH
    if periods >= 2 and coverage >= MIN_COVERAGE_FOR_MEDIUM:
        return Confidence.MEDIUM
    return Confidence.LOW


def _period_coverage(frame: MetricFrame) -> float:
    period = frame.current_period
    calendar_days = (period.end_date - period.start_date).days + 1
    if calendar_days <= 0:
        return 0.0
    return min(1.0, period.active_days / calendar_days)


class G08CoverageConfidenceAudit(Generator):
    id = "G08"
    name = "Coverage & Confidence Audit"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        frame = ctx.metric_frame
        contract = ctx.objective_contract
        current = account_record(frame, "current")
        if current is None:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no account-level current-period record"))

        required = contract.required_metrics()
        missing_required = [m for m in required if m not in current.metrics]
        preferred = [t.metric for t in contract.metric_tiers if t.availability == MetricAvailability.PREFERRED]
        missing_preferred = [m for m in preferred if m not in current.metrics]

        coverage = _period_coverage(frame)
        recency_lag_days = (frame.generated_at.date() - frame.current_period.end_date).days
        confidence = assess_confidence_tier(frame)

        finding = Finding(
            id="g08_coverage_audit",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[6],
            entity=EntityRef(id=current.entity.id, display_name=current.entity.display_name),
            level=finding_level_of(current.entity.level),
            claim_frame=ClaimFrame.DATA_COVERAGE_GAP.value,
            evidence={
                "active_day_coverage_pct": round(coverage * 100, 1),
                "current_active_days": frame.current_period.active_days,
                "recency_lag_days": recency_lag_days,
                "missing_required_metrics": ", ".join(missing_required) or "none",
                "missing_preferred_metrics": ", ".join(missing_preferred) or "none",
                "assessed_confidence": confidence.value,
            },
            comparison=None,
            magnitude_pct=1.0,
            direction=Direction.NEUTRAL if not missing_required else Direction.NEGATIVE,
            actionability="low" if not missing_required else "medium",
            confidence=confidence,
            caveats=([f"required metric(s) missing: {', '.join(missing_required)}"] if missing_required else []),
            materiality=0.0,
            provenance=[f"account:{current.entity.id}:current"],
        )
        return GeneratorResult(findings=[finding])
