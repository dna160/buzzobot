"""Section routing: rank by materiality, enforce generator diversity (max 2
per generator per section), pass top 5, persist everything below the cut.
"""

from __future__ import annotations

from engine.contracts import EntityRef, Finding, FindingLevel, SectionId
from engine.materiality.router import MAX_PER_GENERATOR, MAX_SELECTED, route_all_sections, route_section


def _finding(id: str, generator: str, materiality: float, section_affinity: list[int]) -> Finding:  # noqa: A002
    return Finding(
        id=id,
        generator=generator,
        tenant_id="t1",
        brief_type="gmv",
        section_affinity=section_affinity,
        entity=EntityRef(id=id, display_name=id),
        level=FindingLevel.CAMPAIGN,
        claim_frame="concentration_dependency",
        evidence={},
        comparison=None,
        magnitude_pct=0.5,
        direction="neutral",
        actionability="medium",
        confidence="medium",
        materiality=materiality,
    )


def test_route_section_only_considers_matching_affinity() -> None:
    findings = [_finding("a", "G01", 0.9, [2]), _finding("b", "G02", 0.8, [3])]
    ranking = route_section(SectionId.S2_PERIOD_COMPARISON, findings)
    assert [r.finding.id for r in ranking.ranked] == ["a"]


def test_route_section_ranks_by_materiality_descending() -> None:
    findings = [_finding("low", "G02", 0.1, [3]), _finding("high", "G03", 0.9, [3]), _finding("mid", "G04", 0.5, [3])]
    ranking = route_section(SectionId.S3_PRIMARY_CHANNEL, findings)
    assert [r.finding.id for r in ranking.ranked] == ["high", "mid", "low"]
    assert [r.rank for r in ranking.ranked] == [1, 2, 3]


def test_route_section_enforces_generator_diversity() -> None:
    # 4 findings from the same generator, all high materiality — only 2 may be selected.
    findings = [_finding(f"g02_{i}", "G02", 1.0 - i * 0.01, [3]) for i in range(4)]
    ranking = route_section(SectionId.S3_PRIMARY_CHANNEL, findings)
    selected_ids = [f.id for f in ranking.selected]
    assert len(selected_ids) == MAX_PER_GENERATOR
    # The two highest-materiality ones from that generator are the ones kept.
    assert selected_ids == ["g02_0", "g02_1"]
    # The other two are still in the full ranked list, just not included.
    excluded = [r for r in ranking.ranked if not r.included]
    assert {r.finding.id for r in excluded} == {"g02_2", "g02_3"}


def test_route_section_diversity_lets_a_different_generator_through() -> None:
    findings = [
        _finding("g02_a", "G02", 0.95, [3]),
        _finding("g02_b", "G02", 0.90, [3]),
        _finding("g02_c", "G02", 0.85, [3]),  # would be excluded by the cap
        _finding("g03_a", "G03", 0.80, [3]),  # ranked below g02_c, but a different generator
    ]
    ranking = route_section(SectionId.S3_PRIMARY_CHANNEL, findings)
    selected_ids = {f.id for f in ranking.selected}
    assert selected_ids == {"g02_a", "g02_b", "g03_a"}


def test_route_section_caps_at_max_selected() -> None:
    findings = [_finding(f"f{i}", f"G0{i}", 1.0 - i * 0.01, [3]) for i in range(1, 8)]  # 7 distinct generators
    ranking = route_section(SectionId.S3_PRIMARY_CHANNEL, findings)
    assert len(ranking.selected) == MAX_SELECTED


def test_route_all_sections_excludes_s1() -> None:
    findings = [_finding("a", "G01", 0.9, [2])]
    rankings = route_all_sections(findings)
    assert SectionId.S1_EXEC_SUMMARY not in rankings
    assert set(rankings.keys()) == {
        SectionId.S2_PERIOD_COMPARISON,
        SectionId.S3_PRIMARY_CHANNEL,
        SectionId.S4_SECONDARY_CHANNEL_FUNNEL,
        SectionId.S5_CREATIVE_ENTITY,
        SectionId.S6_RISK_ACTIONS_OUTLOOK,
    }
