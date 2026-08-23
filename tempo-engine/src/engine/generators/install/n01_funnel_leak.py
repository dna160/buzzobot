"""N01 — Funnel Leak Localization. PRD §6.3: "funnel leak localization."

Install's funnel is only two levels deep (impressions->clicks->installs —
see `INSTALL_OBJECTIVE_CONTRACT.additivity_trap` for why there's no third,
"activation" stage). G04's generic zero-yield rule, parameterized by the
primary outcome's own identity equation, naturally resolves to "spend with
0 clicks" for Install (dead delivery — `clicks` is the count-like factor of
`installs = clicks x ir`, exactly as `orders` is for GMV's `gmv = orders x
aov`). That leaves the funnel's actual leak point uncovered: entities that
DID drive clicks — real, paid-for engagement — but converted none of them.
N01 is exactly that: `clicks > 0 and installs == 0`, install's install-
specific complement to G04's dead-delivery check, not a duplicate of it.
"""

from __future__ import annotations

from collections import defaultdict

from engine.contracts import ClaimFrame, Confidence, Direction, Entity, EntityLevel, EntityRef, Finding, MetricRecord
from engine.generators.base import CoverageGap, Generator, GeneratorContext, GeneratorResult
from engine.generators._util import account_record, finding_level_of, non_account_records


class N01FunnelLeak(Generator):
    id = "N01"
    name = "Funnel Leak Localization"

    def _generate(self, ctx: GeneratorContext) -> GeneratorResult:
        records = non_account_records(ctx.metric_frame, "current")
        leaking: dict[str, list[MetricRecord]] = defaultdict(list)
        for r in records:
            if r.metrics.get("clicks", 0.0) > 0 and r.metrics.get("installs") == 0:
                leaking[r.entity.level.value].append(r)

        if not leaking:
            return GeneratorResult(coverage_gap=CoverageGap(generator=self.id, reason="no entity drove clicks without at least one install"))

        account_cost = self._account_cost(ctx)
        findings = [self._finding(ctx, level, group, account_cost) for level, group in leaking.items()]
        return GeneratorResult(findings=findings)

    def _finding(self, ctx: GeneratorContext, level: str, group: list[MetricRecord], account_cost: float | None) -> Finding:
        frame = ctx.metric_frame
        total_cost = sum(r.metrics.get("cost", 0.0) for r in group)
        total_clicks = sum(r.metrics.get("clicks", 0.0) for r in group)
        magnitude_pct = min(1.0, total_cost / account_cost) if account_cost else 0.0

        if len(group) == 1:
            entity = group[0].entity
        else:
            entity = Entity(level=EntityLevel(level), id=f"n01_{level}", display_name=f"{len(group)} {level} entities")

        return Finding(
            id=f"n01_{level}",
            generator=self.id,
            tenant_id=frame.tenant_id,
            brief_type=frame.brief_type,
            section_affinity=[3, 4, 6],
            entity=EntityRef(id=entity.id, display_name=entity.display_name),
            level=finding_level_of(entity.level),
            claim_frame=ClaimFrame.FUNNEL_LEAK_CLICK_TO_INSTALL.value,
            evidence={"entity_count": len(group), "total_clicks": total_clicks, "total_cost": total_cost},
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
