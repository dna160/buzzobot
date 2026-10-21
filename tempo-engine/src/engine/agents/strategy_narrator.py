"""Strategy Report section narrator and critic (PRD §8.3).

The same discipline as the deck's narrator (`agents/narrator.py`): typed
payload in, strict JSON out, deterministic gates, one quality retry with the
violations appended, then the deterministic writer. What differs is the
payload (the compact table), the schema (`StrategySectionDraft`) and the
gates (strategy numeral rules plus the generic-sentence check).

`LmStudioUnreachable` is the one exception that escapes: a dead server is not
a quality failure to retry per section, it ends the full tier for the whole
run (PRD §8.6), and the caller falls back to the instant tier.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Generic, Literal, TypeVar

from pydantic import ValidationError

from engine.contracts import Finding
from engine.contracts.strategy import StrategyFrame, StrategySectionDraft, StrategySectionId
from engine.gates.generic import generic_problems
from engine.gates.strategy_gates import allowed_from, orphan_numerals
from engine.llm.budget import PAYLOAD_BUDGET, trim_to_budget
from engine.llm.client import LmStudioClient, LmStudioError, LmStudioUnreachable, stable_seed
from engine.llm.strategy_prompts import build_critic_messages, build_section_messages, critic_schema, section_schema, section_table
from engine.llm.tokenize import NameTokenizer

MAX_ATTEMPTS = 2  # PRD §8.6: retry once, then fall back.
NARRATOR_TEMPERATURE = 0.3
CRITIC_TEMPERATURE = 0.1

V = TypeVar("V")


@dataclass
class GatedResult(Generic[V]):
    value: V | None
    attempts: int
    first_pass: bool
    errors: list[str] = field(default_factory=list)


async def gated_call(
    client: LmStudioClient,
    *,
    build: Callable[[list[str] | None], tuple[str, str]],
    schema: dict,
    schema_name: str,
    temperature: float,
    seed: int,
    thinking: bool,
    agent: str,
    check: Callable[[Any], tuple[V | None, list[str]]],
    tok: NameTokenizer,
    max_attempts: int = MAX_ATTEMPTS,
) -> GatedResult[V]:
    """Call, de-tokenize, gate; retry once with the violations in the prompt."""
    violations: list[str] | None = None
    errors: list[str] = []
    for attempt in range(1, max_attempts + 1):
        system, user = build(violations)
        try:
            raw = await client.complete_json(
                system=system, user=user, json_schema=schema, schema_name=schema_name,
                temperature=temperature, seed=seed + attempt - 1, thinking=thinking, agent=agent,
            )
            parsed = tok.decode_obj(json.loads(raw))
        except LmStudioUnreachable:
            raise
        except (LmStudioError, json.JSONDecodeError) as exc:
            violations = [f"jawaban tidak valid ({type(exc).__name__})"]
            errors.append(str(exc)[:200])
            continue
        value, problems = check(parsed)
        if not problems and value is not None:
            return GatedResult(value=value, attempts=attempt, first_pass=attempt == 1, errors=errors)
        violations = problems[:6]
        errors.append("; ".join(problems)[:300])
    return GatedResult(value=None, attempts=max_attempts, first_pass=False, errors=errors)


def draft_problems(parsed: Any, ids: set[str], allowed: set[float], names: list[str]) -> tuple[StrategySectionDraft | None, list[str]]:
    if isinstance(parsed, dict) and isinstance(parsed.get("implication"), str) and not parsed["implication"].strip():
        parsed = {**parsed, "implication": None}
    try:
        draft = StrategySectionDraft.model_validate(parsed)
    except ValidationError as exc:
        return None, [f"skema: {'.'.join(str(p) for p in e['loc'])} {e['msg']}" for e in exc.errors()[:3]]
    problems: list[str] = []
    refs = {r for p in draft.paragraphs for r in p.evidence_refs}
    if refs - ids:
        problems.append(f"evidence_refs tidak dikenal: {sorted(refs - ids)}")
    texts = [draft.headline, *(p.text for p in draft.paragraphs), draft.implication or ""]
    orphans = [t for text in texts for t in orphan_numerals(text, allowed)]
    if orphans:
        problems.append(f"angka tidak ada di tabel: {orphans}")
    problems += generic_problems([p.text for p in draft.paragraphs], names)
    return draft, problems


def revision_problems(original: StrategySectionDraft, revised: StrategySectionDraft) -> list[str]:
    """A critic may tighten a gate-passing draft, not hollow it out. Seen live:
    a revision that dropped the implication and cut the headline mid-word
    passed every numeral and schema check."""
    problems = []
    if not revised.headline.rstrip().endswith((".", "!", "?")):
        problems.append("judul revisi tidak berakhir sebagai kalimat")
    if original.implication and not revised.implication:
        problems.append("revisi menghapus implikasi")
    if len(revised.headline) < 0.6 * len(original.headline):
        problems.append("judul revisi jauh lebih pendek")
    return problems


@dataclass(frozen=True)
class SectionNarration:
    draft: StrategySectionDraft | None
    source: Literal["llm", "fallback"]
    attempts: int
    first_pass: bool
    critic: Literal["approved", "revised", "kept", "skipped"]
    trimmed: list[str]
    errors: list[str]


async def narrate_strategy_section(
    sid: StrategySectionId,
    findings: list[Finding],
    frame: StrategyFrame,
    client: LmStudioClient,
    tok: NameTokenizer,
    *,
    run_id: str,
    names: list[str],
) -> SectionNarration:
    """`draft is None` means fall back to the instant copy for this section."""
    trim = trim_to_budget(
        findings, lambda fs: section_table(list(fs), frame.brand_name),
        materiality=lambda f: f.materiality, item_id=lambda f: f.id, budget=PAYLOAD_BUDGET,
    )
    kept: list[Finding] = trim.kept
    ids = [f.id for f in kept]
    allowed = allowed_from(kept, section_table(kept, frame.brand_name))
    schema = section_schema(ids)

    res = await gated_call(
        client,
        build=lambda v: build_section_messages(sid, kept, frame, tok, violations=v),
        schema=schema, schema_name=f"strategy_section_{int(sid)}",
        temperature=NARRATOR_TEMPERATURE, seed=stable_seed(run_id, "narrator", int(sid)), thinking=False, agent="narrator",
        check=lambda p: draft_problems(p, set(ids), allowed, names), tok=tok,
    )
    if res.value is None:
        return SectionNarration(None, "fallback", res.attempts, False, "skipped", trim.dropped_ids, res.errors)

    draft: StrategySectionDraft = res.value
    critic_state: Literal["approved", "revised", "kept", "skipped"] = "kept"
    try:
        system, user = build_critic_messages(draft.model_dump(mode="json"), kept, frame, tok)
        raw = await client.complete_json(
            system=system, user=user, json_schema=critic_schema(schema), schema_name="strategy_critic",
            temperature=CRITIC_TEMPERATURE, seed=stable_seed(run_id, "critic", int(sid)), thinking=True, agent="critic",
        )
        verdict = tok.decode_obj(json.loads(raw))
        if verdict.get("approved"):
            critic_state = "approved"
        else:
            revised, problems = draft_problems(verdict.get("revised_draft"), set(ids), allowed, names)
            if revised is not None:
                problems += revision_problems(draft, revised)
            if revised is not None and not problems:
                draft, critic_state = revised, "revised"
    except LmStudioUnreachable:
        raise
    except (LmStudioError, json.JSONDecodeError, AttributeError):
        critic_state = "kept"
    return SectionNarration(draft, "llm", res.attempts, res.first_pass, critic_state, trim.dropped_ids, res.errors)

