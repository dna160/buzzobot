"""The critic (PRD §5.4): in a `SectionDraft` + the findings behind it, out
a revised `SectionDraft` + rubric verdicts. No tools, thinking on (PRD §7:
temperature 0.1 for critique, the lowest of the three agent temperatures —
the closest lever this client has over "thinking mode" against an
OpenAI-compatible endpoint that has no standard reasoning-effort field;
genuine chain-of-thought toggling is model/server-specific and not
represented here rather than faked with an undocumented parameter).

"Separate agent, not a second turn of the narrator — a model critiquing its
own draft in the same context defends it." This module makes a fresh call
with no shared conversation history with whatever produced the draft.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from engine.contracts import Finding
from engine.gates.numeral_gate import run_numeral_gate
from engine.gates.schema_gate import run_schema_gate
from engine.llm.client import LmStudioClient, LmStudioError
from engine.llm.prompts import CRITIC_JSON_SCHEMA_TEMPLATE, CRITIC_SYSTEM, build_critic_user_prompt

CRITIC_TEMPERATURE = 0.1


@dataclass(frozen=True)
class CriticResult:
    approved: bool
    notes: str
    revised_draft_json: dict
    ok: bool  # False if the critic call itself failed — caller keeps the original draft.


async def critique_section(
    draft_json: dict,
    draft_json_schema: dict,
    findings: list[Finding],
    client: LmStudioClient,
) -> CriticResult:
    """Never raises. On any failure (unreachable server, malformed reply,
    or a "corrected" draft that itself fails the gates), returns
    `ok=False` and the caller keeps the original, already-gate-passed draft
    — the critic can only make a draft better or leave it alone, never
    replace a good draft with a broken one."""
    schema = dict(CRITIC_JSON_SCHEMA_TEMPLATE)
    schema["properties"] = {**schema["properties"], "revised_draft": draft_json_schema}

    try:
        raw = await client.complete_json(
            system=CRITIC_SYSTEM,
            user=build_critic_user_prompt(draft_json, findings),
            json_schema=schema,
            schema_name="critic_verdict",
            temperature=CRITIC_TEMPERATURE,
        )
        parsed = json.loads(raw)
    except (LmStudioError, json.JSONDecodeError) as exc:
        return CriticResult(approved=True, notes=f"critic call failed: {exc}", revised_draft_json=draft_json, ok=False)

    if not isinstance(parsed, dict) or "approved" not in parsed or "revised_draft" not in parsed:
        return CriticResult(approved=True, notes="critic response malformed", revised_draft_json=draft_json, ok=False)

    revised = parsed["revised_draft"]
    schema_result = run_schema_gate(revised, _tier_from_schema(draft_json_schema), findings)
    if not schema_result.ok:
        return CriticResult(
            approved=True, notes=f"critic's revision failed schema gate: {schema_result.error}",
            revised_draft_json=draft_json, ok=False,
        )

    text = " ".join(str(v) for k, v in revised.items() if k != "confidence" and isinstance(v, str))
    numeral_result = run_numeral_gate(text, findings)
    if not numeral_result.ok:
        return CriticResult(
            approved=True,
            notes=f"critic's revision introduced orphan numeral(s): {[v.token for v in numeral_result.violations]}",
            revised_draft_json=draft_json, ok=False,
        )

    return CriticResult(
        approved=bool(parsed.get("approved", True)),
        notes=str(parsed.get("notes", "")),
        revised_draft_json=revised,
        ok=True,
    )


def _tier_from_schema(schema: dict):  # noqa: ANN201
    """The schema gate needs a `Confidence` to pick which model to validate
    against — recovered from the schema's own `confidence` enum rather than
    threaded as a separate parameter, since the schema and the tier are
    already 1:1 (json_schema_for's own mapping)."""
    from engine.contracts import Confidence

    enum_values = schema.get("properties", {}).get("confidence", {}).get("enum", [])
    if enum_values == ["low"]:
        return Confidence.LOW
    return Confidence.HIGH
