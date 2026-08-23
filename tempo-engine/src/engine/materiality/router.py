"""Section routing. PRD §6.5: "Rank all findings with matching
section_affinity, enforce generator diversity (max 2 per generator), pass
top 3-5. Log the full ranked list including everything below the cut —
that is the only signal that later tells us the presets are wrong."
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from engine.contracts import Finding, SectionId

MAX_PER_GENERATOR = 2
MAX_SELECTED = 5
# S1 is synthesized last from accepted S2-S6 content — never routed to directly.
ROUTABLE_SECTIONS: tuple[SectionId, ...] = (
    SectionId.S2_PERIOD_COMPARISON,
    SectionId.S3_PRIMARY_CHANNEL,
    SectionId.S4_SECONDARY_CHANNEL_FUNNEL,
    SectionId.S5_CREATIVE_ENTITY,
    SectionId.S6_RISK_ACTIONS_OUTLOOK,
)


class RankedFinding(BaseModel):
    """One row of the full ranked list — persisted whether or not it made
    the cut, because "everything below the cut" is the audit signal."""

    model_config = ConfigDict(frozen=True)

    finding: Finding
    rank: int
    included: bool


class SectionRanking(BaseModel):
    model_config = ConfigDict(frozen=True)

    section_id: SectionId
    ranked: list[RankedFinding] = Field(default_factory=list)

    @property
    def selected(self) -> list[Finding]:
        return [r.finding for r in self.ranked if r.included]


def route_section(section_id: SectionId, findings: list[Finding]) -> SectionRanking:
    candidates = sorted(
        (f for f in findings if int(section_id) in f.section_affinity),
        key=lambda f: f.materiality,
        reverse=True,
    )

    generator_counts: dict[str, int] = {}
    ranked: list[RankedFinding] = []
    selected_count = 0
    for i, f in enumerate(candidates, start=1):
        count = generator_counts.get(f.generator, 0)
        include = count < MAX_PER_GENERATOR and selected_count < MAX_SELECTED
        if include:
            generator_counts[f.generator] = count + 1
            selected_count += 1
        ranked.append(RankedFinding(finding=f, rank=i, included=include))

    return SectionRanking(section_id=section_id, ranked=ranked)


def route_all_sections(findings: list[Finding]) -> dict[SectionId, SectionRanking]:
    return {sid: route_section(sid, findings) for sid in ROUTABLE_SECTIONS}
