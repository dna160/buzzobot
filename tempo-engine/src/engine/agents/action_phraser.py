"""Action Phraser and action critic (Strategy Report PRD §8.3).

One call writes the copy for every ranked action (≤ 3): numbers from the
Target Solver, prose from the model. Each action's copy passes the schema
gate, the strategy numeral gate and the Action Gate, or that action keeps its
deterministic copy (`deterministic_action_copy`, PRD Appendix D). Gating is
per action, so one bad item never discards two good ones.

The action critic is the deck's critic pattern pointed at actions: a fresh
call that may only replace an item with one that passes the same gates.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from engine.agents.strategy_narrator import gated_call
from engine.contracts import Finding
from engine.contracts.strategy import ActionCopy, ActionItem, StrategyFrame
from engine.copy.strategy import dec, finding_sentence, idr, num, pct
from engine.gates.generic import banned_in
from engine.gates.strategy_gates import APPROVED_PHRASES, allowed_from, orphan_numerals, run_action_gate
from engine.llm.client import LmStudioClient, LmStudioError, LmStudioUnreachable, stable_seed
from engine.llm.strategy_prompts import action_block, action_critic_schema, action_schema, build_action_critic_messages, build_action_messages
from engine.llm.tokenize import NameTokenizer

PHRASER_TEMPERATURE = 0.2
ACTION_CRITIC_TEMPERATURE = 0.1

APPROVED_OPENING = {
    "content_mix": "Naikkan porsi impresi",
    "stage_targeting": "Naikkan ukuran tahap",
    "budget_cap": "Batasi belanja harian",
    "creator_boost": "Tambah boost video kreator",
    "creative_refresh": "Luncurkan materi kreatif baru",
    "investigate": "Selidiki",
}


def fmt_value(v: float | None, fmt: str) -> str:
    if v is None:
        return "-"
    if fmt == "percent":
        return pct(v)
    if fmt == "idr":
        return idr(v)
    if fmt == "rank":
        return f"#{num(v)}"
    if fmt == "ratio":
        return dec(v)
    return num(v)


@dataclass
class ActionPhrasing:
    actions: list[ActionItem]
    #: action id → "llm" | "fallback"
    sources: dict[str, str] = field(default_factory=dict)
    first_pass: bool = False
    attempts: int = 0
    critic: str = "skipped"
    errors: list[str] = field(default_factory=list)


def _item_problems(raw: dict, action: ActionItem, finding: Finding | None, allowed: set[float]) -> tuple[ActionCopy | None, list[str]]:
    try:
        copy = ActionCopy(langkah=raw["langkah"], dasar=raw["dasar"], cara=raw["cara"], gagal_jika=raw["gagal_jika"])
    except (KeyError, TypeError, ValueError) as exc:
        return None, [f"{action.id}: skema ({exc})"]
    problems = [f"{action.id}: {p}" for p in run_action_gate(copy, action, finding)]
    for name in ("dasar", "cara", "gagal_jika"):
        orphans = orphan_numerals(getattr(copy, name), allowed)
        if orphans:
            problems.append(f"{action.id}: {name} memuat angka yang tidak diberikan {orphans}")
        problems += [f"{action.id}: {name} memakai frasa umum {p!r}" for p in banned_in(getattr(copy, name))]
    return copy, problems


async def phrase_actions(
    actions: list[ActionItem],
    findings_by_id: dict[str, Finding],
    frame: StrategyFrame,
    client: LmStudioClient,
    tok: NameTokenizer,
    *,
    run_id: str,
) -> ActionPhrasing:
    """`actions` already carry deterministic copy; the result replaces it per
    action only where the model's copy passes every gate."""
    plan = [a for a in actions if a.rank <= 3]
    if not plan:
        return ActionPhrasing(actions=actions)
    ids = [a.id for a in plan]
    by_id = {a.id: a for a in plan}
    trig = {a.id: findings_by_id.get(a.evidence_refs[0]) if a.evidence_refs else None for a in plan}

    blocks = []
    for a in plan:
        facts = " ".join(finding_sentence(findings_by_id[r], frame.brand_name) for r in a.evidence_refs if r in findings_by_id)
        if a.copy_:
            facts = f"{facts} {a.copy_.dasar}".strip()
        cur = fmt_value(a.current.value, a.current.format) if a.current else "-"
        tgt = fmt_value(a.target.value, a.target.format) if a.target else "-"
        blocks.append(action_block(a, APPROVED_OPENING.get(a.lever, ""), cur, tgt, facts))
    used = [findings_by_id[r] for a in plan for r in a.evidence_refs if r in findings_by_id]
    allowed = allowed_from(used, *blocks)

    best: dict[str, ActionCopy] = {}  # passing items from any attempt; a retry targets the rest

    def check(parsed: Any) -> tuple[dict[str, ActionCopy] | None, list[str]]:
        items = parsed.get("items") if isinstance(parsed, dict) else None
        if not isinstance(items, list) or sorted(str(i.get("id")) for i in items if isinstance(i, dict)) != sorted(ids):
            return None, [f"items harus berisi tepat id {ids}"]
        out: dict[str, ActionCopy] = {}
        problems: list[str] = []
        for raw in items:
            copy, probs = _item_problems(raw, by_id[raw["id"]], trig[raw["id"]], allowed)
            problems += probs
            if copy is not None and not probs:
                out[raw["id"]] = copy
        best.update(out)
        return (out if not problems else None), problems

    res = await gated_call(
        client,
        build=lambda v: build_action_messages(blocks, frame, tok, violations=v),
        schema=action_schema(ids), schema_name="strategy_actions",
        temperature=PHRASER_TEMPERATURE, seed=stable_seed(run_id, "action_phraser"), thinking=False, agent="action_phraser",
        check=check, tok=tok,
    )
    accepted: dict[str, ActionCopy] = dict(res.value or best)

    critic = "skipped"
    if accepted:
        critic = "kept"
        try:
            current_items = [{"id": a.id, **(accepted.get(a.id) or a.copy_).model_dump()} for a in plan if (accepted.get(a.id) or a.copy_)]
            system, user = build_action_critic_messages(current_items, blocks, frame, tok)
            raw = await client.complete_json(
                system=system, user=user, json_schema=action_critic_schema(ids), schema_name="strategy_action_critic",
                temperature=ACTION_CRITIC_TEMPERATURE, seed=stable_seed(run_id, "action_critic"), thinking=True, agent="action_critic",
            )
            verdict = tok.decode_obj(json.loads(raw))
            if verdict.get("approved"):
                critic = "approved"
            else:
                for item in verdict.get("items") or []:
                    aid = item.get("id") if isinstance(item, dict) else None
                    if aid in accepted:
                        copy, probs = _item_problems(item, by_id[aid], trig[aid], allowed)
                        if copy is not None and not probs:
                            accepted[aid] = copy
                            critic = "revised"
        except LmStudioUnreachable:
            raise
        except (LmStudioError, json.JSONDecodeError, AttributeError, TypeError):
            critic = "kept"

    out_actions = []
    sources: dict[str, str] = {}
    for a in actions:
        if a.id in accepted:
            out_actions.append(a.model_copy(update={"copy_": accepted[a.id]}))
            sources[a.id] = "llm"
        else:
            out_actions.append(a)
            if a.id in by_id:
                sources[a.id] = "fallback"
    return ActionPhrasing(
        actions=out_actions, sources=sources, first_pass=res.first_pass, attempts=res.attempts, critic=critic, errors=res.errors,
    )


__all__ = ["APPROVED_OPENING", "APPROVED_PHRASES", "ActionPhrasing", "phrase_actions"]
