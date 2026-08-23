"""G06 — Segment Contrast. PRD §6.3: standardized effect size, FDR-corrected.
Every dimension-value pair with >=2 entities on each side is tested; every
p-value from every pair is BH-corrected together; only a pair that survives
correction *and* clears a minimum effect size becomes a Finding.
"""

from __future__ import annotations

from itertools import combinations

from engine.contracts import ClaimFrame, Comparison, ComparisonBasis, Confidence, Direction, EntityRef, Finding
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import finding_level_of, non_account_records
from engine.stats import benjamini_hochberg, welch_t_test

ALPHA = 0.05
MIN_EFFECT_SIZE = 0.5
MIN_GROUP_SIZE = 2


class _Candidate:
    __slots__ = ("dimension", "value_a", "value_b", "sample_a", "sample_b", "entities_a", "entities_b")

    def __init__(self, dimension, value_a, value_b, sample_a, sample_b, entities_a, entities_b) -> None:  # noqa: ANN001
        self.dimension = dimension
        self.value_a = value_a
        self.value_b = value_b
        self.sample_a = sample_a
        self.sample_b = sample_b
        self.entities_a = entities_a
        self.entities_b = entities_b


class G06SegmentContrast(Generator):
    id = "G06"
    name = "Segment Contrast"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        records = non_account_records(ctx.metric_frame, "current")
        metric = ctx.objective_contract.efficiency_metric
        scoreable = [r for r in records if metric in r.metrics]
        if len(scoreable) < MIN_GROUP_SIZE * 2:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason=f"fewer than {MIN_GROUP_SIZE * 2} entities carry {metric!r}", missing_metrics=[metric]))

        dimension_keys = sorted({k for r in scoreable for k in r.dimensions})
        candidates: list[_Candidate] = []
        for dim in dimension_keys:
            groups: dict[str, list] = {}
            for r in scoreable:
                if dim in r.dimensions:
                    groups.setdefault(r.dimensions[dim], []).append(r)
            eligible = {v: g for v, g in groups.items() if len(g) >= MIN_GROUP_SIZE}
            for (val_a, group_a), (val_b, group_b) in combinations(eligible.items(), 2):
                candidates.append(
                    _Candidate(dim, val_a, val_b, [r.metrics[metric] for r in group_a], [r.metrics[metric] for r in group_b], group_a, group_b)
                )

        if not candidates:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no dimension had two value-groups with >=2 scoreable entities each"))

        results = [welch_t_test(c.sample_a, c.sample_b) for c in candidates]
        p_values = [r.p_value if r is not None else 1.0 for r in results]
        adjusted = benjamini_hochberg(p_values)

        findings: list[Finding] = []
        for candidate, result, p_adj in zip(candidates, results, adjusted, strict=True):
            if result is None or p_adj >= ALPHA or abs(result.effect_size) < MIN_EFFECT_SIZE:
                continue
            findings.append(self._finding(ctx, candidate, result, p_adj, metric))

        if not findings:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason=f"tested {len(candidates)} dimension-value pair(s); none survived FDR correction at alpha={ALPHA}"))
        return GeneratorResult(findings=findings)

    def _finding(self, ctx: GeneratorContext, candidate: _Candidate, result, p_adj: float, metric: str) -> Finding:  # noqa: ANN001
        frame = ctx.metric_frame
        mean_a = sum(candidate.sample_a) / len(candidate.sample_a)
        mean_b = sum(candidate.sample_b) / len(candidate.sample_b)
        higher_label, higher_mean, lower_label, lower_mean = (
            (candidate.value_a, mean_a, candidate.value_b, mean_b) if mean_a >= mean_b else (candidate.value_b, mean_b, candidate.value_a, mean_a)
        )
        representative_level = candidate.entities_a[0].entity.level

        return Finding(
            id=f"g06_{candidate.dimension}_{candidate.value_a}_vs_{candidate.value_b}",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[4, 5],
            entity=EntityRef(id=f"segment_{candidate.dimension}_{higher_label}", display_name=f"{candidate.dimension}={higher_label}"),
            level=finding_level_of(representative_level),
            claim_frame=ClaimFrame.ATTRIBUTE_PERFORMANCE_CORRELATION.value,
            evidence={
                "dimension": candidate.dimension,
                "metric": metric,
                "group_a_label": candidate.value_a,
                "group_a_mean": round(mean_a, 4),
                "group_a_n": len(candidate.sample_a),
                "group_b_label": candidate.value_b,
                "group_b_mean": round(mean_b, 4),
                "group_b_n": len(candidate.sample_b),
                "effect_size": round(result.effect_size, 3),
                "p_value_fdr_adjusted": round(p_adj, 4),
            },
            comparison=Comparison(
                basis=ComparisonBasis.COHORT_MEDIAN,
                baseline_value=lower_mean,
                current_value=higher_mean,
                delta_abs=higher_mean - lower_mean,
                delta_pct=(higher_mean - lower_mean) / lower_mean if lower_mean != 0 else None,
                label=f"{higher_label} vs {lower_label} on {metric}",
            ),
            magnitude_pct=min(1.0, (len(candidate.sample_a) + len(candidate.sample_b)) / max(1, len(non_account_records(frame, "current")))),
            direction=Direction.POSITIVE,
            actionability="medium",
            confidence=Confidence.HIGH if p_adj < 0.01 else Confidence.MEDIUM,
            materiality=0.0,
            provenance=[f"{representative_level.value}:{e.entity.id}:current" for e in (*candidate.entities_a, *candidate.entities_b)],
        )
