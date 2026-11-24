"""Strategy Report materiality and routing (PRD §5.3, §7.5).

Scoring is the engine's standard `sqrt(magnitude) × actionability ×
confidence` (PRD §6.5), multiplied by the report class's emphasis weight from
PRD §5.3: the brand class down-weights Conversion-stage funnel findings, the
shop class down-weights share-of-voice and competitor findings (product-card
clicks excepted — they are the shop class's own anchor).

Routing then fills each T section from findings whose `section_affinity`
names it, two per generator at most, up to the class's card cap — and T6 takes
only the finding types its class leads with (PRD §5.3, the class-highlight
gate's input). Everything that loses is kept in `below_cut`.
"""

from __future__ import annotations

import math

from engine.contracts import ClaimFrame, Finding
from engine.contracts.strategy import CARD_CAPS, DEFAULT_CARD_CAP, ReportClass, StrategySectionId
from engine.materiality.presets import _DEFAULT
from engine.materiality.router import RankedFinding, SectionRanking

T = StrategySectionId
MAX_PER_GENERATOR = 2
SECTION_CAPS = {T.T2_ACTIONS: 3, T.T8_WARNINGS: 5, T.T9_ACTION_LOG: 6, T.LAMPIRAN_A: 50}
ROUTED = (T.T2_ACTIONS, T.T3_FUNNEL, T.T4_SPEND, T.T5_PACE, T.T6_CLASS, T.T7_CONTENT, T.T8_WARNINGS, T.T9_ACTION_LOG, T.LAMPIRAN_A)
#: Sections that show every finding that names them, not a ranked few per generator.
UNCAPPED_PER_GENERATOR = {T.T2_ACTIONS, T.T9_ACTION_LOG, T.LAMPIRAN_A}

BRAND_T6 = {
    ClaimFrame.SOV_GAINING.value, ClaimFrame.SOV_LOSING.value, ClaimFrame.SOV_STABLE.value, ClaimFrame.RANK_MOVED.value,
    ClaimFrame.GROWING_FASTER_THAN_CATEGORY.value, ClaimFrame.GROWING_SLOWER_THAN_CATEGORY.value,
    ClaimFrame.COMPETITOR_CLIMBING.value, ClaimFrame.COMPETITOR_FALLING.value, ClaimFrame.BRAND_OVERTAKEN.value,
}


def class_weight(f: Finding, cls: ReportClass) -> float:
    conversion_funnel = f.generator == "T01" and f.evidence.get("stage") == "consideration"
    if cls == "brand":
        return 0.7 if conversion_funnel else 1.0
    if f.generator in ("T05", "T06") and f.evidence.get("metric") != "product_card_clicks":
        return 0.7
    return 1.0


def score_strategy_findings(findings: list[Finding], cls: ReportClass) -> list[Finding]:
    out = []
    for f in findings:
        m = math.sqrt(f.magnitude_pct) * _DEFAULT.actionability_weight[f.actionability] * _DEFAULT.confidence_weight[f.confidence]
        out.append(f.model_copy(update={"materiality": round(min(1.0, m * class_weight(f, cls)), 6)}))
    return out


def t6_eligible(f: Finding, cls: ReportClass) -> bool:
    if cls == "brand":
        return f.claim_frame in BRAND_T6 and f.evidence.get("metric") != "product_card_clicks"
    is_conv_stage = f.claim_frame in (ClaimFrame.STAGE_LEAK.value, ClaimFrame.STAGE_HEALTHY.value) and f.evidence.get("stage") == "consideration"
    return is_conv_stage or f.evidence.get("metric") == "product_card_clicks"


NARRATED = (T.T3_FUNNEL, T.T4_SPEND, T.T5_PACE, T.T6_CLASS, T.T7_CONTENT, T.T8_WARNINGS)


def route_strategy(findings: list[Finding], cls: ReportClass) -> dict[StrategySectionId, SectionRanking]:
    """Narrated sections are filled in the class's own section order, and a
    finding a section already used is not offered to a later one — so the shop
    class's Consideration→Conversion leak leads T3 and is not restated in T6,
    and a competitor the brand class shows in T6 is not repeated in T8."""
    from engine.contracts.strategy import SECTION_ORDER

    order = [s for s in SECTION_ORDER[cls] if s in ROUTED] + [s for s in ROUTED if s not in SECTION_ORDER[cls]]
    used: set[str] = set()
    rankings: dict[StrategySectionId, SectionRanking] = {}
    for sid in order:
        cap = SECTION_CAPS.get(sid) or CARD_CAPS[cls].get(sid, DEFAULT_CARD_CAP)
        pool = [
            f for f in findings
            if int(sid) in f.section_affinity
            and (sid != T.T6_CLASS or t6_eligible(f, cls))
            and not (sid in NARRATED and f.id in used)
        ]
        if sid == T.T2_ACTIONS:
            pool.sort(key=lambda f: int(f.evidence.get("action_rank", 99)))
        else:
            pool.sort(key=lambda f: f.materiality, reverse=True)
        per_gen: dict[str, int] = {}
        ranked, picked = [], 0
        for i, f in enumerate(pool, start=1):
            n = per_gen.get(f.generator, 0)
            # A Lite lock row is information, not a ranked signal: T8 always shows
            # it (PRD §5.1), and it never takes a slot from a real warning.
            if sid == T.T8_WARNINGS and f.evidence.get("locked_reason"):
                ranked.append(RankedFinding(finding=f, rank=i, included=True))
                continue
            include = picked < cap and (sid in UNCAPPED_PER_GENERATOR or n < MAX_PER_GENERATOR)
            if include:
                per_gen[f.generator] = n + 1
                picked += 1
                if sid in NARRATED:
                    used.add(f.id)
            ranked.append(RankedFinding(finding=f, rank=i, included=include))
        rankings[sid] = SectionRanking.model_construct(section_id=sid, ranked=ranked)
    return rankings
