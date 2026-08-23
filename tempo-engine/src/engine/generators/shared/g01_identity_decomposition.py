"""G01 — Identity Decomposition (LMDI). PRD §6.3: "Highest-value generator."
"Single level only" — this operates strictly on account-level records; it
never mixes a campaign-level or adgroup-level figure into the decomposition
(Hard Rule 2's level-integrity requirement, satisfied by construction here
since `account_record` only ever returns `EntityLevel.ACCOUNT` rows).
"""

from __future__ import annotations

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityRef, Finding, FindingLevel
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import account_record, flatten_identity_chain
from engine.stats import lmdi_additive_decomposition


class G01IdentityDecomposition(Generator):
    id = "G01"
    name = "Identity Decomposition (LMDI)"
    requires: tuple[str, ...] = ()  # the real requirement is contract-dependent; checked in _generate.

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        contract = ctx.objective_contract
        frame = ctx.metric_frame

        current = account_record(frame, "current")
        prior = account_record(frame, "prior")
        if current is None or prior is None:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="requires both a current and a prior account-level record"))

        root_factors, divisor = flatten_identity_chain(contract)

        missing_current = [f for f in root_factors if f not in current.metrics]
        missing_prior = [f for f in root_factors if f not in prior.metrics]
        missing = sorted(set(missing_current) | set(missing_prior))
        if missing:
            return GeneratorResult(
                coverage_gap=CoverageGap(
                    generator=self.id,
                    reason=f"identity chain for {contract.primary_outcome!r} needs {root_factors} at account level in both periods",
                    missing_metrics=missing,
                )
            )

        current_factors = {f: current.metrics[f] for f in root_factors}
        prior_factors = {f: prior.metrics[f] for f in root_factors}

        if any(v <= 0 for v in current_factors.values()) or any(v <= 0 for v in prior_factors.values()):
            return GeneratorResult(
                coverage_gap=CoverageGap(
                    generator=self.id,
                    reason="one or more identity-chain factors is zero or negative in a period; LMDI requires positive factors",
                )
            )

        raw_contributions = lmdi_additive_decomposition(current_factors, prior_factors)
        contributions = raw_contributions if divisor == 1.0 else {f: c / divisor for f, c in raw_contributions.items()}

        current_outcome = current.metrics[contract.primary_outcome]
        prior_outcome = prior.metrics[contract.primary_outcome]
        delta = current_outcome - prior_outcome
        delta_pct = delta / prior_outcome if prior_outcome != 0 else None

        evidence: dict[str, float | int | str] = {
            "primary_outcome": contract.primary_outcome,
            "current_value": current_outcome,
            "prior_value": prior_outcome,
            "delta": delta,
        }
        for factor in root_factors:
            evidence[f"{factor}_current"] = current_factors[factor]
            evidence[f"{factor}_prior"] = prior_factors[factor]
            evidence[f"{factor}_contribution"] = contributions[factor]

        caveats: list[str] = []
        active_days_differ = frame.current_period.active_days != frame.prior_period.active_days  # type: ignore[union-attr]
        if active_days_differ:
            caveats.append(
                f"current period has {frame.current_period.active_days} active day(s) vs "  # type: ignore[union-attr]
                f"{frame.prior_period.active_days} in the prior period — see G07 before reading this delta at face value"  # type: ignore[union-attr]
            )

        finding = Finding(
            id="g01_identity_decomposition",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[2],
            entity=EntityRef(id=current.entity.id, display_name=current.entity.display_name),
            level=FindingLevel.ACCOUNT,
            claim_frame=ClaimFrame.IDENTITY_DECOMPOSITION.value,
            evidence=evidence,
            comparison=Comparison(
                basis=ComparisonBasis.PRIOR_PERIOD,
                baseline_value=prior_outcome,
                current_value=current_outcome,
                delta_abs=delta,
                delta_pct=delta_pct,
            ),
            magnitude_pct=1.0,
            direction=Direction.POSITIVE if delta > 0 else Direction.NEGATIVE if delta < 0 else Direction.NEUTRAL,
            actionability="medium",
            confidence=Confidence.MEDIUM if active_days_differ else Confidence.HIGH,
            caveats=caveats,
            materiality=0.0,
            provenance=[f"account:{current.entity.id}:current+prior"],
        )
        return GeneratorResult(findings=[finding])
