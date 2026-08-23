"""SectionDraft response schemas, one per confidence tier. PRD §8: "`low`
tier removes the `implication` field entirely and restricts vocabulary
enums... enforce it structurally." Two distinct Pydantic models (not one
model with an optional field) so a `low`-tier response literally cannot
carry an `implication` — the JSON Schema sent to LM Studio for that tier
omits the property altogether (`additionalProperties: false`), so the model
cannot produce it even if the prompt were silent on the point.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from engine.contracts import Confidence


class SectionDraftFull(BaseModel):
    """High/medium confidence: direct claims permitted, per PRD §8's
    confidence ladder ("High: direct claims", "Medium: claims with explicit
    period caveat")."""

    model_config = ConfigDict(extra="forbid")

    headline: str = Field(min_length=10, max_length=200)
    mechanism: str = Field(min_length=20, max_length=900)
    evidence_refs: list[str] = Field(min_length=1, max_length=5)
    implication: str = Field(min_length=10, max_length=500)
    action: str = Field(min_length=10, max_length=400)
    confidence: Literal["high", "medium"]


class SectionDraftLow(BaseModel):
    """Low confidence: PRD §8 — "descriptive only, no trend or causal
    language" and no `implication` field at all. The absence of the field
    is the mechanism, not a prompt instruction to avoid inferring one."""

    model_config = ConfigDict(extra="forbid")

    headline: str = Field(min_length=10, max_length=200)
    mechanism: str = Field(min_length=20, max_length=900)
    evidence_refs: list[str] = Field(min_length=1, max_length=5)
    action: str = Field(min_length=10, max_length=400)
    confidence: Literal["low"]


SectionDraft = SectionDraftFull | SectionDraftLow


_FULL_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["headline", "mechanism", "evidence_refs", "implication", "action", "confidence"],
    "properties": {
        "headline": {"type": "string"},
        "mechanism": {"type": "string"},
        "evidence_refs": {"type": "array", "items": {"type": "string"}},
        "implication": {"type": "string"},
        "action": {"type": "string"},
        "confidence": {"type": "string", "enum": ["high", "medium"]},
    },
}

_LOW_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["headline", "mechanism", "evidence_refs", "action", "confidence"],
    "properties": {
        "headline": {"type": "string"},
        "mechanism": {"type": "string"},
        "evidence_refs": {"type": "array", "items": {"type": "string"}},
        "action": {"type": "string"},
        "confidence": {"type": "string", "enum": ["low"]},
    },
}


def json_schema_for(tier: Confidence) -> dict:
    return _LOW_JSON_SCHEMA if tier == Confidence.LOW else _FULL_JSON_SCHEMA


def model_for(tier: Confidence) -> type[SectionDraftFull] | type[SectionDraftLow]:
    return SectionDraftLow if tier == Confidence.LOW else SectionDraftFull


def parse_section_draft(raw: dict, tier: Confidence) -> SectionDraft:
    """Raises `pydantic.ValidationError` on schema mismatch — the caller
    (the schema gate) is responsible for catching it and triggering a retry
    or fallback, never for suppressing it here."""
    return model_for(tier).model_validate(raw)


# --- S6 (synthesist, PRD §5.6: "risk, actions, bounded outlook") ------------


class RiskItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    risk: str = Field(min_length=10, max_length=400)
    severity: Literal["high", "medium", "low"]
    action: str = Field(min_length=10, max_length=300)
    owner: str = Field(min_length=2, max_length=60)
    evidence_refs: list[str] = Field(min_length=1, max_length=3)


class S6Draft(BaseModel):
    """Not tier-split like `SectionDraft` — PRD's confidence-tier schema
    constraint (Hard Rule 8) is stated specifically about the `implication`
    field, which S6 doesn't have. Epistemic humility at low confidence shows
    up in fewer, more hedged risks and outlook points, which the prompt
    (not the schema) is responsible for — there is no structural field to
    remove here the way `implication` was removed for §8's narrator sections."""

    model_config = ConfigDict(extra="forbid")

    risks: list[RiskItem] = Field(min_length=2, max_length=6)
    outlook: list[str] = Field(min_length=1, max_length=3)
    confidence: Literal["high", "medium", "low"]


S6_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["risks", "outlook", "confidence"],
    "properties": {
        "risks": {
            "type": "array",
            "minItems": 2,
            "maxItems": 6,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["risk", "severity", "action", "owner", "evidence_refs"],
                "properties": {
                    "risk": {"type": "string"},
                    "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                    "action": {"type": "string"},
                    "owner": {"type": "string"},
                    "evidence_refs": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
        "outlook": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
    },
}


# --- S1 (synthesist, written last, from accepted S2-S6 content only) -------


class S1Draft(BaseModel):
    """No `evidence_refs` of its own — S1 is a summary of the accepted
    S2-S6 drafts, not a fresh narration from findings (PRD: "S1 is written
    last, from the accepted content of S2-S6"). Its numeral gate check
    (see agents/synthesist.py) uses the union of every finding actually
    selected across the brief, not a section-specific subset."""

    model_config = ConfigDict(extra="forbid")

    headline: str = Field(min_length=10, max_length=200)
    summary: str = Field(min_length=30, max_length=900)


S1_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["headline", "summary"],
    "properties": {
        "headline": {"type": "string"},
        "summary": {"type": "string"},
    },
}


# --- Analyst / probe loop (PRD §5.2, B7) ------------------------------------


class ProbeRequest(BaseModel):
    """One probe: an instrument name plus its (instrument-specific) typed
    parameters, all optional here and validated per-instrument by
    `instruments.run_instrument` — a flat schema rather than a discriminated
    union because a small local model's structured-output support for
    nested oneOf/anyOf schemas is inconsistent across servers; validation
    happens in deterministic code regardless of what the schema allowed
    through (Hard Rule 1: the agent chooses the question, code answers it —
    including validating whether the question was well-formed)."""

    model_config = ConfigDict(extra="forbid")

    instrument: Literal["concentration", "efficiency_outliers", "decompose", "segment_contrast", "marginal_return", "cohort_slice"]
    level: str | None = None
    metric: str | None = None
    dimension: str | None = None
    dimension_value: str | None = None
    entity_id: str | None = None
    rationale: str = Field(min_length=10, max_length=300)


class ProbeBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    probes: list[ProbeRequest] = Field(min_length=0, max_length=6)


PROBE_BATCH_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["probes"],
    "properties": {
        "probes": {
            "type": "array",
            "minItems": 0,
            "maxItems": 6,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["instrument", "rationale"],
                "properties": {
                    "instrument": {
                        "type": "string",
                        "enum": ["concentration", "efficiency_outliers", "decompose", "segment_contrast", "marginal_return", "cohort_slice"],
                    },
                    "level": {"type": ["string", "null"]},
                    "metric": {"type": ["string", "null"]},
                    "dimension": {"type": ["string", "null"]},
                    "dimension_value": {"type": ["string", "null"]},
                    "entity_id": {"type": ["string", "null"]},
                    "rationale": {"type": "string"},
                },
            },
        },
    },
}
