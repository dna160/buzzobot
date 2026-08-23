"""The narrator (PRD §5.3): in a `SectionPayload`, out a `SectionDraft`.
No tools, thinking off (§7's model config). This module is the orchestrator
tying together the LM Studio client and every gate — draft, schema-check,
numeral-check, retry up to 2 times, then fall back to the deterministic
writer. PRD §8: "Any hard gate failure -> deterministic writer, stated in
the footer. The brief always renders." — this function is where that
guarantee actually lives; it has no path that raises to its caller.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal

from engine.contracts import SECTION_SPEC_BY_ID, SectionPayload
from engine.gates.fallback import deterministic_section_draft
from engine.gates.numeral_gate import run_numeral_gate
from engine.gates.schema_gate import run_schema_gate
from engine.llm.client import LmStudioClient, LmStudioError
from engine.llm.prompts import build_system_prompt, build_user_prompt_with_exemplar
from engine.llm.schemas import SectionDraft, SectionDraftFull, json_schema_for

MAX_ATTEMPTS = 2  # PRD §8: numeral gate "regenerate, max 2, then flag."


@dataclass(frozen=True)
class NarrationResult:
    draft: SectionDraft
    source: Literal["llm", "fallback"]
    attempts: int
    fallback_reason: str | None = None


def _draft_text(draft: SectionDraft) -> str:
    parts = [draft.headline, draft.mechanism, draft.action]
    if isinstance(draft, SectionDraftFull):
        parts.append(draft.implication)
    return " ".join(parts)


async def narrate_section(
    payload: SectionPayload,
    client: LmStudioClient,
    *,
    max_attempts: int = MAX_ATTEMPTS,
) -> NarrationResult:
    if not payload.findings:
        return NarrationResult(
            draft=deterministic_section_draft([], payload.confidence_tier),
            source="fallback",
            attempts=0,
            fallback_reason="no findings routed to this section",
        )

    section_spec = SECTION_SPEC_BY_ID[payload.section_id]
    system = build_system_prompt(section_spec, payload.brief_type, payload.confidence_tier.value)
    user = build_user_prompt_with_exemplar(payload.findings, payload.objective_contract, payload.section_id)
    schema = json_schema_for(payload.confidence_tier)

    last_error = ""
    for attempt in range(1, max_attempts + 1):
        try:
            raw = await client.complete_json(
                system=system,
                user=user,
                json_schema=schema,
                schema_name=f"section_{payload.section_id.value}_{payload.confidence_tier.value}",
            )
            parsed = json.loads(raw)
        except (LmStudioError, json.JSONDecodeError) as exc:
            last_error = str(exc)
            continue

        schema_result = run_schema_gate(parsed, payload.confidence_tier, payload.findings)
        if not schema_result.ok or schema_result.draft is None:
            last_error = schema_result.error or "schema gate failed"
            continue

        numeral_result = run_numeral_gate(_draft_text(schema_result.draft), payload.findings)
        if not numeral_result.ok:
            tokens = [v.token for v in numeral_result.violations]
            last_error = f"numeral gate rejected token(s): {tokens}"
            continue

        return NarrationResult(draft=schema_result.draft, source="llm", attempts=attempt)

    return NarrationResult(
        draft=deterministic_section_draft(payload.findings, payload.confidence_tier),
        source="fallback",
        attempts=max_attempts,
        fallback_reason=last_error,
    )
