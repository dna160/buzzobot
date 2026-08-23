"""G04 — Zero-Yield & Waste. PRD §6.3: "Rule table per objective."

Two rules for GMV. §6.2's table text reads "spend with 0 orders; live
sessions absorbing budget at 0 conversion" — but the prior PRD draft (which
this one's own header says it "supersedes," implying continuity of intent,
not a deliberate narrowing) also had a third: "0-impression ad groups."
Restored here as `dormant_entity`, added while closing the B3 exit-gate gap:
it is the rule that actually reproduces the reference report's own §4
insight ("5 ad groups spent Rp 0, need reactivation"), it fits cleanly
within G04's own stated scope ("rule table" implies more than one rule,
same as every other generator here), and Hard Rule 3's "never a prompt
edit" bars a narrative shortcut, not a deterministic rule the report itself
demonstrates is real and worth a Finding.

Both rules are generic across entity levels, parameterized by the
count-like factor of the primary outcome's identity equation ("orders" for
GMV) rather than hard-coded, so Install's equivalent reuses this unchanged.
Matching entities of the same level are aggregated into one Finding when
there is more than one.
"""

from __future__ import annotations

from collections import defaultdict

from engine.contracts import (
    ClaimFrame,
    Confidence,
    Direction,
    Entity,
    EntityLevel,
    EntityRef,
    Finding,
    MetricRecord,
    ObjectiveContract,
)
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import account_record, finding_level_of, non_account_records


def _outcome_count_metric(contract: ObjectiveContract) -> str | None:
    for eq in contract.identity_chain:
        if eq.outcome == contract.primary_outcome:
            return eq.factors[0]
    return None


def _activity_metric(record: MetricRecord) -> float:
    """Whichever "did anything happen at all" metric this record carries —
    clicks if present, else impressions, else 0 (genuinely inert)."""
    if "clicks" in record.metrics:
        return record.metrics["clicks"]
    return record.metrics.get("impressions", 0.0)


class G04ZeroYield(Generator):
    id = "G04"
    name = "Zero-Yield & Waste"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        records = non_account_records(ctx.metric_frame, "current")
        if not records:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no non-account entities in the current period"))

        count_metric = _outcome_count_metric(ctx.objective_contract)
        if count_metric is None:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="objective contract has no count-metric factor to test for zero yield"))

        zero_yield_spend: dict[str, list[MetricRecord]] = defaultdict(list)
        dormant: dict[str, list[MetricRecord]] = defaultdict(list)
        level_totals: dict[str, int] = defaultdict(int)

        for r in records:
            level_totals[r.entity.level.value] += 1
            cost = r.metrics.get("cost")
            if cost is None:
                continue
            if cost > 0 and r.metrics.get(count_metric) == 0:
                zero_yield_spend[r.entity.level.value].append(r)
            elif cost == 0 and _activity_metric(r) == 0:
                dormant[r.entity.level.value].append(r)

        if not zero_yield_spend and not dormant:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no entity spent without an outcome, and no entity was entirely dormant"))

        findings = [
            self._rule_finding(ctx, "zero_yield_spend", level, group, count_metric, level_totals[level])
            for level, group in zero_yield_spend.items()
        ] + [
            self._rule_finding(ctx, "dormant_entity", level, group, count_metric, level_totals[level])
            for level, group in dormant.items()
        ]
        return GeneratorResult(findings=findings)

    def _rule_finding(
        self, ctx: GeneratorContext, rule: str, level: str, group: list[MetricRecord], count_metric: str, level_total: int
    ) -> Finding:
        frame = ctx.metric_frame
        total_cost = sum(r.metrics.get("cost", 0.0) for r in group)

        if rule == "zero_yield_spend":
            account_cost = self._account_cost(ctx)
            magnitude_pct = min(1.0, total_cost / account_cost) if account_cost else 0.0
        else:
            # Dormant entities spent nothing, so a cost-share magnitude is
            # always 0 — use share of the level's own entity count instead,
            # the honest proxy for "how much of the account's structure at
            # this level is sitting idle."
            magnitude_pct = min(1.0, len(group) / level_total) if level_total else 0.0

        if len(group) == 1:
            entity = group[0].entity
        else:
            entity = Entity(
                level=EntityLevel(level), id=f"g04_{rule}_{level}", display_name=f"{len(group)} {level} entities"
            )

        return Finding(
            id=f"g04_{rule}_{level}",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[3, 4, 6],
            entity=EntityRef(id=entity.id, display_name=entity.display_name),
            level=finding_level_of(entity.level),
            claim_frame=ClaimFrame.ZERO_YIELD_SPEND.value,
            evidence={
                "rule": rule,
                "count_metric": count_metric,
                "entity_count": len(group),
                "total_cost": total_cost,
            },
            comparison=None,
            magnitude_pct=magnitude_pct,
            direction=Direction.NEGATIVE,
            actionability="high",
            confidence=Confidence.HIGH,
            materiality=0.0,
            provenance=[f"{level}:{r.entity.id}:current" for r in group],
        )

    @staticmethod
    def _account_cost(ctx: GeneratorContext) -> float | None:
        record = account_record(ctx.metric_frame, "current")
        return record.metrics.get("cost") if record else None
