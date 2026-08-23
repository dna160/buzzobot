"""Narrator, critic, and synthesist prompts. PRD: output language Bahasa
Indonesia; code/prompts English. Each narrator gets only a `SectionPayload`
— the objective contract, that section's 3-5 findings, nothing else
(PRD §5.3). Few-shot exemplars (B5's "Indonesian gold set") are wired in via
`llm/gold_set.py`.
"""

from __future__ import annotations

import json

from engine.contracts import Finding, MetricFrame, ObjectiveContract, SectionId, SectionSpec
from engine.llm.gold_set import NARRATOR_EXEMPLARS, S1_EXEMPLAR, S6_EXEMPLAR

SYSTEM_TEMPLATE = """You are a senior performance-marketing analyst writing one section of a client-facing TikTok advertising brief. You write in Bahasa Indonesia.

YOU ARE GIVEN pre-computed, pre-ranked findings. Your job is interpretation and writing, not arithmetic — every number you use must come from the findings' `evidence` field, exactly as given (rounding and percent-conversion are fine; inventing a number is not).

HARD RULES:
1. Output ONLY the JSON object matching the required schema. No markdown, no commentary outside the JSON.
2. Every claim must be traceable to one of the finding IDs in `evidence_refs` — do not write about anything not in the findings you were given.
3. NEVER state a number that is not in a finding's `evidence`. If you need a number you do not have, describe it in words instead ("meningkat secara signifikan" rather than an invented percentage).
4. `action` must be one concrete, executable instruction — never "monitor" or "optimalkan lebih lanjut".
5. {confidence_instruction}

Section: {section_name} ({section_instantiation})
"""

_CONFIDENCE_INSTRUCTIONS = {
    "high": "Confidence is HIGH for this section — direct claims are appropriate.",
    "medium": "Confidence is MEDIUM for this section — state claims with an explicit caveat about the comparison period.",
    "low": (
        "Confidence is LOW for this section — write descriptively only. Do NOT use trend language "
        '("meningkat", "menurun", "cenderung") or causal language ("karena", "akibat", "menyebabkan"). '
        "State what the data shows for this period alone. There is no `implication` field at this "
        "confidence tier — do not write one."
    ),
}


def build_system_prompt(section_spec: SectionSpec, brief_type: str, confidence_tier: str) -> str:
    return SYSTEM_TEMPLATE.format(
        confidence_instruction=_CONFIDENCE_INSTRUCTIONS[confidence_tier],
        section_name=section_spec.slot_name,
        section_instantiation=section_spec.instantiation.get(brief_type, ""),
    )


def build_user_prompt(findings: list[Finding], objective_contract: ObjectiveContract) -> str:
    findings_json = [
        {
            "id": f.id,
            "claim_frame": f.claim_frame,
            "entity": f.entity.display_name,
            "level": f.level.value,
            "evidence": f.evidence,
            "comparison": f.comparison.model_dump() if f.comparison else None,
            "direction": f.direction.value,
            "caveats": f.caveats,
        }
        for f in findings
    ]
    return (
        "Write this section's narrative from the findings below.\n\n"
        f"OBJECTIVE: primary outcome is `{objective_contract.primary_outcome}`, "
        f"efficiency metric is `{objective_contract.efficiency_metric}`. "
        f"{objective_contract.additivity_trap}\n\n"
        f"FINDINGS (JSON):\n{json.dumps(findings_json, indent=2, ensure_ascii=False)}\n\n"
        "Every number in your response must appear, character-for-character or as a permitted rounding/"
        "percent derivation, in one of these findings' `evidence` values. This is checked automatically: "
        "one invented number rejects the whole response."
    )


def build_user_prompt_with_exemplar(
    findings: list[Finding], objective_contract: ObjectiveContract, section_id: SectionId
) -> str:
    """Same as `build_user_prompt`, prefixed with this section's gold-set
    exemplar (PRD B5), when one exists — the same real Sovella findings the
    B2/B3 exit gates were validated against, so the exemplar's numbers are
    genuinely traceable, not made up for the prompt."""
    base = build_user_prompt(findings, objective_contract)
    exemplar = NARRATOR_EXEMPLARS.get(int(section_id))
    if exemplar is None:
        return base
    example_block = (
        "EXAMPLE (a different section, for tone and structure only — do not reuse its numbers):\n"
        f"Findings: {exemplar['findings_summary']}\n"
        f"Correct output: {json.dumps(exemplar['output'], ensure_ascii=False)}\n\n"
    )
    return example_block + base


# --- Critic (PRD §5.4) -------------------------------------------------------

CRITIC_SYSTEM = """You are a strict editor reviewing a draft section of a client-facing TikTok advertising brief, written in Bahasa Indonesia. You did not write this draft — you are reviewing someone else's work with a fixed rubric.

RUBRIC — check every point:
1. Does every claim reference a finding ID that is actually in `evidence_refs`?
2. Is any sentence true of ANY brand in this vertical (generic filler like "performa menunjukkan tren yang menarik")? If so, it must be rewritten to be specific to this brand's actual findings.
3. Does any number appear that is not traceable to the findings provided? If so, delete or rewrite it.
4. Is `action` one instruction executable tomorrow without asking a follow-up question — never "monitor" or "pantau lebih lanjut"?

Output ONLY a JSON object with this shape: {"approved": true|false, "notes": "...", "revised_draft": {...}}.
- If the draft already passes all four checks, set "approved": true and return the ORIGINAL draft unchanged in "revised_draft".
- If it fails any check, set "approved": false, explain why in "notes", and return a CORRECTED draft in "revised_draft" that matches the exact same JSON schema as the original draft.
- The revised draft must still only use numbers that appear in the findings' evidence — you may not introduce a new number either.
"""


def build_critic_user_prompt(draft_json: dict, findings: list[Finding]) -> str:
    findings_json = [{"id": f.id, "evidence": f.evidence} for f in findings]
    return (
        f"DRAFT TO REVIEW:\n{json.dumps(draft_json, indent=2, ensure_ascii=False)}\n\n"
        f"FINDINGS THIS DRAFT MAY CITE (JSON):\n{json.dumps(findings_json, indent=2, ensure_ascii=False)}"
    )


CRITIC_JSON_SCHEMA_TEMPLATE = {
    "type": "object",
    "additionalProperties": False,
    "required": ["approved", "notes", "revised_draft"],
    "properties": {
        "approved": {"type": "boolean"},
        "notes": {"type": "string"},
        "revised_draft": {},  # filled in by the caller with the section's own schema
    },
}


# --- Synthesist: S6 (PRD §5.6) -----------------------------------------------

S6_SYSTEM = """You are a senior performance-marketing analyst writing the risk register, prioritized actions, and outlook section (S6) of a client-facing TikTok advertising brief, in Bahasa Indonesia.

YOU ARE GIVEN this brief's findings routed to this section, AND a summary of what the earlier sections (S2-S5) already said — do not repeat their claims, build on them.

HARD RULES:
1. Output ONLY the JSON object matching the required schema.
2. Produce 2-6 risk entries, each with a specific `risk` (with evidence), a `severity`, one executable `action`, and an `owner` (a team name, e.g. "Media Buying", "Creative", "Data / Ops").
3. Every risk's `evidence_refs` must cite a real finding ID from what you were given.
4. NEVER state a number not in the findings' evidence.
5. `outlook` is 1-3 bounded, evidence-grounded statements — never a number that is not in the findings.
"""


def build_s6_user_prompt(findings: list[Finding], accepted_sections_summary: str) -> str:
    findings_json = [{"id": f.id, "claim_frame": f.claim_frame, "evidence": f.evidence} for f in findings]
    example = (
        "EXAMPLE (different findings, for tone and structure only):\n"
        f"{json.dumps(S6_EXEMPLAR['output'], ensure_ascii=False)}\n\n"
    )
    return (
        example
        + f"WHAT S2-S5 ALREADY SAID: {accepted_sections_summary}\n\n"
        + f"FINDINGS ROUTED TO THIS SECTION (JSON):\n{json.dumps(findings_json, indent=2, ensure_ascii=False)}"
    )


# --- Synthesist: S1 (PRD §5.6, written last) ---------------------------------

S1_SYSTEM = """You are a senior performance-marketing analyst writing the executive summary (S1) of a client-facing TikTok advertising brief, in Bahasa Indonesia. This is written LAST, after every other section is finished — you are summarizing, not analyzing fresh.

YOU ARE GIVEN a summary of what every other accepted section (S2-S6) said. Your job is to synthesize a headline and a short summary paragraph from THAT content — never introduce a claim or number that isn't already in one of those sections.

HARD RULES:
1. Output ONLY the JSON object matching the required schema.
2. `headline`: one sentence, the single most important thing in the brief. HARD LIMIT: 200 characters, no exceptions — count as you write it. A headline that runs long fails validation and the whole executive summary falls back to generic boilerplate, so keep it tight rather than comprehensive.
3. `summary`: 3-5 sentences synthesizing the accepted sections — lead with the outcome, not a generic opener. Limit: 900 characters.
4. NEVER introduce a number that doesn't already appear in the accepted sections' content you were given.
"""


def build_s1_user_prompt(accepted_sections_summary: str) -> str:
    example = (
        "EXAMPLE (different brief, for tone and structure only):\n"
        f"{json.dumps(S1_EXEMPLAR['output'], ensure_ascii=False)}\n\n"
    )
    return example + f"ACCEPTED SECTIONS (S2-S6):\n{accepted_sections_summary}"


# --- Analyst / probe loop (PRD §5.2, B7) ------------------------------------
# English throughout, not Bahasa Indonesia: this call produces structured
# probe requests and an audit rationale, not client-facing prose — PRD's
# "output language Bahasa Indonesia" governs the brief itself; "logs
# English" covers exactly this kind of internal reasoning trace.

ANALYST_SYSTEM = """You are the analyst in a TikTok advertising brief pipeline. A fixed battery of deterministic generators already ran and produced the findings below. Your ONLY job is to decide whether any additional, targeted question is worth asking of the data — you do not compute anything yourself.

Every probe is a flat JSON object: {{"instrument": ..., "level": ..., "metric": ..., "dimension": ..., "dimension_value": ..., "entity_id": ..., "rationale": ...}}. The schema allows every field except `instrument` and `rationale` to be null, but each instrument below only actually runs if YOU fill in ITS OWN required fields — leaving them null makes the probe fail with zero information gained. Only set the fields a given instrument needs; leave the rest null.

YOU MAY CALL ONLY these six instruments:

1. concentration — REQUIRES `level` AND `metric`. HHI/Gini/top-1 share of `metric` across entities at `level`.
2. efficiency_outliers — REQUIRES `level` AND `metric`. Robust z-score outliers of `metric` across entities at `level`.
3. decompose — REQUIRES `level`. LMDI delta decomposition for one entity (set `entity_id`, or leave it null for the whole account).
4. segment_contrast — REQUIRES `dimension` AND `metric`. FDR-corrected pairwise contrast of `metric` across `dimension`'s value-groups.
5. marginal_return — REQUIRES `level`. Δoutcome/Δspend per entity at `level` vs. the account average.
6. cohort_slice — REQUIRES `dimension` AND `dimension_value`. Aggregated totals for entities matching dimension=value.

Example of a correctly filled probe (concentration, one of the instruments that needs `level` and `metric`):
{{"instrument": "concentration", "level": "session", "metric": "gmv", "dimension": null, "dimension_value": null, "entity_id": null, "rationale": "G03 flagged high GMV concentration at campaign level; checking whether it also concentrates at session level."}}

RULES:
1. Propose 0-6 probes. Zero is a legitimate answer if nothing in the findings below suggests an unanswered question worth asking.
2. Every probe needs a `rationale`: what specific thing in the findings below made you ask this, in one sentence.
3. Do not re-ask a question the findings already answer — read what's already there first.
4. {data_availability_note}
5. `level`, `metric`, `dimension`, and `dimension_value` MUST be chosen only from the "AVAILABLE PARAMETERS FOR THIS DATASET" list you are given below the findings — never guess a name that isn't listed there.
6. Output ONLY the JSON object matching the required schema.
"""

_NO_ENTITY_HISTORY_NOTE = (
    "This account has NO prior-period entity-level data (only the account-level rollup has both "
    "current and prior periods) — `decompose` and `marginal_return` will report a gap for any entity "
    "other than the account itself. Prefer `concentration`, `efficiency_outliers`, `segment_contrast`, "
    "or `cohort_slice` unless you have a specific reason to try the others anyway."
)


def build_analyst_system_prompt(has_entity_level_history: bool) -> str:
    note = "" if has_entity_level_history else _NO_ENTITY_HISTORY_NOTE
    return ANALYST_SYSTEM.format(data_availability_note=note)


def _parameter_surface(frame: MetricFrame) -> str:
    """What `level`/`metric`/`dimension`/`dimension_value` values actually
    exist in this frame — computed deterministically from the same
    `MetricFrame` the generators ran against, so the analyst is choosing
    among real options rather than guessing plausible-sounding names."""
    level_entities: dict[str, set[str]] = {}
    metrics_seen: set[str] = set()
    dims_seen: dict[str, set[str]] = {}
    for r in frame.records:
        level_entities.setdefault(r.entity.level.value, set()).add(r.entity.id)
        metrics_seen.update(r.metrics.keys())
        for k, v in r.dimensions.items():
            dims_seen.setdefault(k, set()).add(v)

    level_lines = "\n".join(
        f"  - {lvl}: {len(ids)} entities" for lvl, ids in sorted(level_entities.items())
    )
    metric_line = ", ".join(sorted(metrics_seen)) or "(none)"
    dim_lines = "\n".join(
        f"  - {name}: {', '.join(sorted(values))}" for name, values in sorted(dims_seen.items())
    ) or "  (none)"
    return (
        "AVAILABLE PARAMETERS FOR THIS DATASET:\n"
        f"levels:\n{level_lines}\n"
        f"metrics: {metric_line}\n"
        f"dimensions:\n{dim_lines}"
    )


def build_analyst_user_prompt(
    findings: list[Finding], frame: MetricFrame, round_number: int, prior_probes_summary: str
) -> str:
    findings_json = [
        {
            "id": f.id, "generator": f.generator, "claim_frame": f.claim_frame,
            "entity": f.entity.display_name, "level": f.level.value, "evidence": f.evidence,
        }
        for f in findings
    ]
    prior = f"\nPROBES ALREADY RUN THIS SESSION:\n{prior_probes_summary}\n" if prior_probes_summary else ""
    return (
        f"ROUND {round_number} of 2.\n\n"
        f"EXISTING FINDINGS (from the fixed generator battery):\n{json.dumps(findings_json, indent=2, ensure_ascii=False)}\n"
        f"\n{_parameter_surface(frame)}\n"
        f"{prior}\n"
        "Propose your probe batch now."
    )
