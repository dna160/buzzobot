"""The synthesist (PRD §5.6): writes S6 (risk, actions, outlook) then S1
(executive summary) — S1 last, from the accepted content of S2-S6, never
introducing a claim or number the earlier sections didn't already establish.
Same gate + retry + fallback discipline as the narrator (agents/narrator.py)
— "the brief always renders" is a universal guarantee, not scoped to S2-S5.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal

from engine.contracts import Finding
from engine.gates.fallback import deterministic_s1_draft, deterministic_s6_draft
from engine.gates.numeral_gate import run_numeral_gate
from engine.llm.client import LmStudioClient
from engine.llm.prompts import S1_SYSTEM, S6_SYSTEM, build_s1_user_prompt, build_s6_user_prompt
from engine.llm.schemas import S1_JSON_SCHEMA, S6_JSON_SCHEMA, S1Draft, S6Draft

MAX_ATTEMPTS = 2
S1_HEADLINE_MAX_LENGTH = 200


def _truncate_overlong_headline(parsed: dict) -> dict:
    """A small local model asked for "one sentence" routinely overshoots
    `S1Draft.headline`'s 200-char limit even with an explicit reminder in
    the prompt — found live: real, on-topic content discarded wholesale for
    generic fallback boilerplate over a length violation alone, the single
    most damaging failure mode for S1 since it's the first thing a reader
    sees. Trimming at the last word boundary under the limit preserves the
    model's real content instead of discarding it; this only ever shortens
    a string already produced by the model, so it cannot introduce a claim
    or number that wasn't there — the numeral gate re-checks the trimmed
    text regardless before it's accepted."""
    headline = parsed.get("headline")
    if not isinstance(headline, str) or len(headline) <= S1_HEADLINE_MAX_LENGTH:
        return parsed
    truncated = headline[:S1_HEADLINE_MAX_LENGTH]
    last_space = truncated.rfind(" ")
    if last_space > 0:
        truncated = truncated[:last_space]
    return {**parsed, "headline": truncated.rstrip(" ,.;:") + "."}
SYNTHESIST_TEMPERATURE = 0.1  # PRD §7: 0.1, same low-temperature/high-reasoning-budget lever as the critic.


@dataclass(frozen=True)
class S6Result:
    draft: S6Draft
    source: Literal["llm", "fallback"]
    attempts: int
    fallback_reason: str | None = None


@dataclass(frozen=True)
class S1Result:
    draft: S1Draft
    source: Literal["llm", "fallback"]
    attempts: int
    fallback_reason: str | None = None


def _s6_text(draft: S6Draft) -> str:
    parts = [r.risk + " " + r.action for r in draft.risks]
    parts.extend(draft.outlook)
    return " ".join(parts)


async def synthesize_s6(
    findings: list[Finding],
    accepted_sections_summary: str,
    client: LmStudioClient,
    *,
    max_attempts: int = MAX_ATTEMPTS,
) -> S6Result:
    if not findings:
        return S6Result(draft=deterministic_s6_draft([]), source="fallback", attempts=0, fallback_reason="no findings routed to S6")

    last_error = ""
    for attempt in range(1, max_attempts + 1):
        try:
            raw = await client.complete_json(
                system=S6_SYSTEM,
                user=build_s6_user_prompt(findings, accepted_sections_summary),
                json_schema=S6_JSON_SCHEMA,
                schema_name="s6_risk_register",
                temperature=SYNTHESIST_TEMPERATURE,
            )
            parsed = json.loads(raw)
            draft = S6Draft.model_validate(parsed)
        except Exception as exc:  # noqa: BLE001 - validation, JSON, and transport errors all mean "retry or fall back"
            last_error = str(exc)
            continue

        known_ids = {f.id for f in findings}
        bad_refs = [r for risk in draft.risks for r in risk.evidence_refs if r not in known_ids]
        if bad_refs:
            last_error = f"risk evidence_refs cite unknown finding id(s): {bad_refs}"
            continue

        numeral_result = run_numeral_gate(_s6_text(draft), findings)
        if not numeral_result.ok:
            last_error = f"numeral gate rejected token(s): {[v.token for v in numeral_result.violations]}"
            continue

        return S6Result(draft=draft, source="llm", attempts=attempt)

    return S6Result(draft=deterministic_s6_draft(findings), source="fallback", attempts=max_attempts, fallback_reason=last_error)


async def synthesize_s1(
    accepted_headlines: list[str],
    all_selected_findings: list[Finding],
    accepted_sections_summary: str,
    client: LmStudioClient,
    *,
    max_attempts: int = MAX_ATTEMPTS,
) -> S1Result:
    """`all_selected_findings` is every finding actually used anywhere in
    the brief (S2-S6 combined) — S1's numeral gate checks against that
    union, since S1 may legitimately restate any number the brief already
    established, not just one section's."""
    if not accepted_headlines:
        return S1Result(draft=deterministic_s1_draft([]), source="fallback", attempts=0, fallback_reason="no accepted sections to summarize")

    last_error = ""
    for attempt in range(1, max_attempts + 1):
        try:
            raw = await client.complete_json(
                system=S1_SYSTEM,
                user=build_s1_user_prompt(accepted_sections_summary),
                json_schema=S1_JSON_SCHEMA,
                schema_name="s1_executive_summary",
                temperature=SYNTHESIST_TEMPERATURE,
            )
            parsed = json.loads(raw)
            draft = S1Draft.model_validate(_truncate_overlong_headline(parsed))
        except Exception as exc:  # noqa: BLE001 - validation, JSON, and transport errors all mean "retry or fall back"
            last_error = str(exc)
            continue

        numeral_result = run_numeral_gate(draft.headline + " " + draft.summary, all_selected_findings)
        if not numeral_result.ok:
            last_error = f"numeral gate rejected token(s): {[v.token for v in numeral_result.violations]}"
            continue

        return S1Result(draft=draft, source="llm", attempts=attempt)

    return S1Result(
        draft=deterministic_s1_draft(accepted_headlines), source="fallback", attempts=max_attempts, fallback_reason=last_error
    )
