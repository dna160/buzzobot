"""T1 verdict synthesist (Strategy Report PRD §8.3, §8.5 rule 5).

Reads only what the report has already accepted — section headlines and the
action `langkah` lines — plus the three chips code computed. Gates: schema,
the strategy numeral gate against the union of everything the report used,
and the Chip Gate (each chip cites the same finding, status and numbers as
its deterministic twin). Fallback: `deterministic_verdict`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import ValidationError

from engine.agents.strategy_narrator import gated_call
from engine.contracts import Finding
from engine.contracts.strategy import StrategyFrame, VerdictChip, VerdictDraft
from engine.gates.generic import banned_in
from engine.gates.strategy_gates import allowed_from, orphan_numerals, run_chip_gate
from engine.llm.client import LmStudioClient, stable_seed
from engine.llm.strategy_prompts import build_verdict_messages, verdict_schema
from engine.llm.tokenize import NameTokenizer

SYNTHESIST_TEMPERATURE = 0.1


@dataclass
class VerdictResult:
    draft: VerdictDraft | None
    source: Literal["llm", "fallback"]
    attempts: int
    first_pass: bool
    chip_first_pass: bool
    errors: list[str] = field(default_factory=list)


async def synthesize_verdict(
    headlines: list[str],
    langkah: list[str],
    reference_chips: list[VerdictChip],
    used_findings: list[Finding],
    confidence: str,
    frame: StrategyFrame,
    client: LmStudioClient,
    tok: NameTokenizer,
    *,
    run_id: str,
) -> VerdictResult:
    allowed = allowed_from(used_findings, *headlines, *langkah, *(c.value for c in reference_chips))
    chip_ids = sorted({c.finding_id for c in reference_chips if c.finding_id})
    chip_failures: list[bool] = []

    def check(parsed: Any) -> tuple[VerdictDraft | None, list[str]]:
        try:
            draft = VerdictDraft.model_validate(parsed)
        except ValidationError as exc:
            return None, [f"skema: {'.'.join(str(p) for p in e['loc'])} {e['msg']}" for e in exc.errors()[:3]]
        chips = run_chip_gate(draft.chips, reference_chips)
        chip_failures.append(bool(chips))
        problems = list(chips)
        orphans = orphan_numerals(f"{draft.headline} {draft.paragraph}", allowed)
        if orphans:
            problems.append(f"angka tidak ada di judul/langkah: {orphans}")
        problems += [f"frasa umum {p!r}" for p in banned_in(draft.paragraph)]
        return draft, problems

    res = await gated_call(
        client,
        build=lambda v: build_verdict_messages(headlines, langkah, reference_chips, confidence, frame, tok, violations=v),
        schema=verdict_schema(chip_ids), schema_name="strategy_verdict",
        temperature=SYNTHESIST_TEMPERATURE, seed=stable_seed(run_id, "synthesist", 101), thinking=True, agent="synthesist",
        check=check, tok=tok,
    )
    chip_first = bool(chip_failures) and not chip_failures[0]
    if res.value is None:
        return VerdictResult(None, "fallback", res.attempts, False, chip_first, res.errors)
    # Chips are code-defined dials. The gate measures whether the model kept
    # their finding, status and numbers; the printed label and value are then
    # restored from code, so a misspelt word in a chip never reaches the page.
    draft = res.value.model_copy(update={"chips": [r.model_copy() for r in reference_chips]})
    return VerdictResult(draft, "llm", res.attempts, res.first_pass, chip_first, res.errors)
