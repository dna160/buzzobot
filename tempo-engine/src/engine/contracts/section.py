"""SectionSpec, SectionPayload — the six canonical section slots.

This PRD's excerpt doesn't restate the per-brief-type section content table
(the prior PRD's §4 did, in full) but assumes the identical six-section
scaffolding throughout — the graph names `narrate_S2..S5`, "S1 is written
last" (§4.1, §5.6), and `Finding.section_affinity: list[int]` all presuppose
it. Ported verbatim from the prior PRD's §4 table rather than re-derived,
since nothing in this PRD contradicts it.
"""

from __future__ import annotations

from enum import IntEnum

from pydantic import BaseModel, ConfigDict, Field

from engine.contracts.finding import Confidence, Finding
from engine.contracts.metric_frame import BriefType
from engine.contracts.objective import ObjectiveContract


class SectionId(IntEnum):
    """S1 is synthesized last from accepted S2-S6 content and never receives
    findings directly — see `Finding._sections_in_range`."""

    S1_EXEC_SUMMARY = 1
    S2_PERIOD_COMPARISON = 2
    S3_PRIMARY_CHANNEL = 3
    S4_SECONDARY_CHANNEL_FUNNEL = 4
    S5_CREATIVE_ENTITY = 5
    S6_RISK_ACTIONS_OUTLOOK = 6


class SectionSpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    section_id: SectionId
    slot_name: str
    instantiation: dict[BriefType, str]


SECTION_SPECS: tuple[SectionSpec, ...] = (
    SectionSpec(
        section_id=SectionId.S1_EXEC_SUMMARY,
        slot_name="Executive Summary & Trend",
        instantiation={
            "awareness": "Reach/impression trend, CPM efficiency headline",
            "gmv": "GMV/ROI trend headline",
            "install": "Install volume & CPI trend headline",
        },
    ),
    SectionSpec(
        section_id=SectionId.S2_PERIOD_COMPARISON,
        slot_name="Performance Analysis & Period Comparison",
        instantiation={
            "awareness": "Reach delta decomposed into impressions vs frequency",
            "gmv": "GMV delta decomposed into orders vs AOV",
            "install": "Install delta decomposed into clicks vs IR",
        },
    ),
    SectionSpec(
        section_id=SectionId.S3_PRIMARY_CHANNEL,
        slot_name="Primary Channel Deep Dive",
        instantiation={
            "awareness": "Top placements/formats by qualified reach efficiency",
            "gmv": "GMV Max: campaigns + live sessions",
            "install": "Top-performing channels/campaigns by CPA-activation",
        },
    ),
    SectionSpec(
        section_id=SectionId.S4_SECONDARY_CHANNEL_FUNNEL,
        slot_name="Secondary Channel & Funnel Diagnosis",
        instantiation={
            "awareness": "Retention curve: 2s -> 6s -> complete; hook vs hold",
            "gmv": "Non-GMV Max: consideration, CTR, dormant ad groups",
            "install": "Funnel leak localization: impr -> click -> install -> activation",
        },
    ),
    SectionSpec(
        section_id=SectionId.S5_CREATIVE_ENTITY,
        slot_name="Creative & Entity Diagnosis",
        instantiation={
            "awareness": "Creative attribute x VTR correlation",
            "gmv": "Product/SKU + creator/affiliate diagnosis",
            "install": "Creative x cohort quality diagnosis",
        },
    ),
    SectionSpec(
        section_id=SectionId.S6_RISK_ACTIONS_OUTLOOK,
        slot_name="Risk, Prioritized Actions & Outlook",
        instantiation={
            "awareness": "Ranked risks, actions, bounded projection, confidence",
            "gmv": "Ranked risks, actions, bounded projection, confidence",
            "install": "Ranked risks, actions, bounded projection, confidence",
        },
    ),
)

SECTION_SPEC_BY_ID: dict[SectionId, SectionSpec] = {s.section_id: s for s in SECTION_SPECS}


class SectionPayload(BaseModel):
    """Everything one narrator/synthesist call receives for one section
    (PRD §5.3: "3-5 ranked findings, contract, schema, few-shot"). The
    schema and few-shot set are narration-layer concerns (B4); this carries
    the two that are this contract layer's job."""

    model_config = ConfigDict(frozen=True)

    tenant_id: str
    brief_type: BriefType
    section_id: SectionId
    objective_contract: ObjectiveContract
    findings: list[Finding] = Field(min_length=0, max_length=5)
    confidence_tier: Confidence
    coverage_gaps: list[str] = Field(default_factory=list)
