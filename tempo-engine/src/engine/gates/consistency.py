"""Consistency checker (Strategy Report PRD §8.3, §8.6): code only, run
after every agent has written its part.

- **Class-highlight gate.** A brand-class report's T6 carries a share,
  rank or competitor finding; a shop-class report's T6 carries a
  conversion-stage funnel finding or a product-card-clicks finding — unless
  the generators that would produce one reported a coverage gap. Failure
  marks the run `degraded`; the report still renders.
- **Action evidence.** Every action's `evidence_refs` resolve to a finding.
- **Chip agreement.** Every T1 chip cites a finding routed to T3–T6.

The checker reports; `graphs/strategy_agents.py` decides what falls back.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from engine.contracts import Finding
from engine.contracts.finding import ClaimFrame as CF
from engine.contracts.strategy import ActionItem, ReportClass, VerdictChip

BRAND_HIGHLIGHT = {
    CF.SOV_GAINING.value, CF.SOV_LOSING.value, CF.SOV_STABLE.value, CF.RANK_MOVED.value,
    CF.COMPETITOR_CLIMBING.value, CF.COMPETITOR_FALLING.value, CF.BRAND_OVERTAKEN.value,
}
# Generators whose coverage gap excuses a missing highlight.
HIGHLIGHT_SOURCES: dict[str, set[str]] = {"brand": {"T05", "T06"}, "shop": {"T01", "T05"}}


def _is_shop_highlight(f: Finding) -> bool:
    e = f.evidence
    if f.claim_frame in (CF.STAGE_LEAK.value, CF.STAGE_HEALTHY.value) and "conversion" in (e.get("stage"), e.get("next_stage")):
        return True
    return "product_card_clicks" in f.id or e.get("metric") == "product_card_clicks"


def class_highlight_ok(report_class: ReportClass, t6: list[Finding], coverage_gaps: list[dict]) -> bool:
    if report_class == "brand":
        hit = any(f.claim_frame in BRAND_HIGHLIGHT for f in t6)
    else:
        hit = any(_is_shop_highlight(f) for f in t6)
    if hit:
        return True
    gapped = {str(g.get("generator")) for g in coverage_gaps}
    return bool(gapped & HIGHLIGHT_SOURCES[report_class])


@dataclass
class ConsistencyReport:
    class_highlight_ok: bool = True
    unresolved_actions: list[str] = field(default_factory=list)
    stray_chips: list[int] = field(default_factory=list)

    @property
    def violations(self) -> list[str]:
        out = []
        if not self.class_highlight_ok:
            out.append("class_highlight_missing")
        out += [f"action_evidence_unresolved:{a}" for a in self.unresolved_actions]
        out += [f"chip_unrouted:{i}" for i in self.stray_chips]
        return out


def check_consistency(
    *,
    report_class: ReportClass,
    t6: list[Finding],
    coverage_gaps: list[dict],
    actions: list[ActionItem],
    finding_ids: set[str],
    chips: list[VerdictChip],
    chip_source_ids: set[str],
) -> ConsistencyReport:
    rep = ConsistencyReport(class_highlight_ok=class_highlight_ok(report_class, t6, coverage_gaps))
    rep.unresolved_actions = [a.id for a in actions if not set(a.evidence_refs) <= finding_ids]
    rep.stray_chips = [i for i, c in enumerate(chips, start=1) if c.finding_id and c.finding_id not in chip_source_ids]
    return rep
