"""Strategy Report full tier (PRD §8.4): narrators and critics, the Action
Phraser and its critic, the T1 synthesist, then the consistency checker.

The instant tier's deterministic report is built first and every agent only
ever *replaces* a part of it with copy that passed its gates. So the full tier
degrades section by section, never as a whole, except in two cases where it
keeps the instant copy and records why in `meta.degraded`:
- LM Studio unreachable after the client's transport retries (PRD §8.6);
- the wall-clock cap (`STRATEGY_FULL_TIER_CAP_S`, default 600 s): whatever is
  not yet written when it passes keeps its instant copy.

T8 is not narrated: the renderer prints its signal rows, not a paragraph
(P3 decision), so narrating it would spend two calls on text nobody sees.

`meta.eval` records per-agent pass@1 (PRD §11.3: the AI KPI for this report),
attempts, fallbacks, critic outcomes, payload trims and call counts.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from engine.agents.action_phraser import phrase_actions
from engine.agents.strategy_narrator import narrate_strategy_section
from engine.agents.strategy_synthesist import synthesize_verdict
from engine.contracts import Finding
from engine.contracts.strategy import SECTION_ORDER, ActionItem, StrategySectionDraft, StrategySectionId, VerdictDraft
from engine.copy.strategy import deterministic_verdict
from engine.gates.consistency import check_consistency
from engine.graphs.strategy import NARRATED, PROMPT_VERSION, TEMPLATE_ONLY, frame_of, selected, strategy_instant_copy_node
from engine.llm.client import LmStudioClient, LmStudioUnreachable
from engine.llm.tokenize import NameTokenizer

T = StrategySectionId
LLM_SECTIONS = (T.T3_FUNNEL, T.T4_SPEND, T.T5_PACE, T.T6_CLASS, T.T7_CONTENT)
T1 = str(int(T.T1_VERDICT))


def _cap_seconds() -> float:
    try:
        return float(os.environ.get("STRATEGY_FULL_TIER_CAP_S", "") or 600)
    except ValueError:
        return 600.0


def _ratio(hits: list[bool]) -> float | None:
    return round(sum(hits) / len(hits), 3) if hits else None


async def strategy_full_node(state: dict) -> dict[str, Any]:
    base = await strategy_instant_copy_node(state)
    frame = frame_of(state)
    cls = frame.classification.report_class
    run_id = str(state.get("run_id", ""))
    loop = asyncio.get_running_loop()
    started = loop.time()
    cap = _cap_seconds()

    client = LmStudioClient()
    tok = NameTokenizer([frame.brand_name, frame.client_name])
    competitor_names = sorted({c.brand for rows in frame.competitors.values() for c in rows})
    names = [frame.brand_name, frame.client_name, *competitor_names]
    findings_by_id = {f["id"]: Finding.model_validate(f) for f in state["findings"]}

    drafts: dict[str, dict] = dict(base["section_drafts"])
    actions = [ActionItem.model_validate(a) for a in base["strategy_actions"]]
    routed_all = {sid: selected(state, sid) for sid in (*NARRATED, *TEMPLATE_ONLY)}
    degraded: list[str] = []
    sections_eval: dict[str, dict] = {}
    action_eval: dict[str, Any] = {}
    verdict_eval: dict[str, Any] = {}
    timed_out = False

    def over_cap() -> bool:
        return loop.time() - started >= cap

    try:
        for sid in [s for s in SECTION_ORDER[cls] if s in LLM_SECTIONS]:
            key = str(int(sid))
            if over_cap():
                timed_out = True
                break
            routed = routed_all.get(sid, [])
            if not routed:
                sections_eval[key] = {"source": "template", "reason": "no findings routed"}
                continue
            n = await narrate_strategy_section(sid, routed, frame, client, tok, run_id=run_id, names=names)
            if n.draft is not None:
                drafts[key] = {
                    "draft": n.draft.model_dump(mode="json"), "narration_source": "llm", "narration_attempts": n.attempts,
                    "critic_ok": n.critic != "kept", "critic_approved": n.critic == "approved", "critic_notes": n.critic,
                }
            else:
                drafts[key] = {**drafts[key], "narration_source": "fallback", "narration_attempts": n.attempts}
            sections_eval[key] = {
                "source": "llm" if n.draft is not None else "fallback", "attempts": n.attempts, "pass_at_1": n.first_pass,
                "critic": n.critic, "trimmed": n.trimmed, "errors": n.errors[-2:],
            }

        if not timed_out and not over_cap():
            phrasing = await phrase_actions(actions, findings_by_id, frame, client, tok, run_id=run_id)
            actions = phrasing.actions
            action_eval = {
                "pass_at_1": phrasing.first_pass, "attempts": phrasing.attempts, "critic": phrasing.critic,
                "sources": phrasing.sources, "errors": phrasing.errors[-2:],
            }
        else:
            timed_out = True

        # The deterministic verdict is rebuilt from the final action copy: it is
        # both the synthesist's fallback and the Chip Gate's reference.
        reference = deterministic_verdict(frame, routed_all, actions)
        drafts[T1] = {"draft": reference.model_dump(mode="json"), "narration_source": "template", "narration_attempts": 0}
        if not timed_out and not over_cap():
            headlines = [
                StrategySectionDraft.model_validate(drafts[str(int(s))]["draft"]).headline
                for s in SECTION_ORDER[cls] if s in LLM_SECTIONS and routed_all.get(s)
            ]
            langkah = [a.copy_.langkah for a in actions if a.rank <= 3 and a.copy_]
            used = [f for fs in routed_all.values() for f in fs]
            confidence = "rendah" if len(frame.audience.get("consideration", [])) < 28 else "sedang"
            v = await synthesize_verdict(headlines, langkah, reference.chips, used, confidence, frame, client, tok, run_id=run_id)
            if v.draft is not None:
                drafts[T1] = {"draft": v.draft.model_dump(mode="json"), "narration_source": "llm", "narration_attempts": v.attempts}
            else:
                drafts[T1] = {**drafts[T1], "narration_source": "fallback", "narration_attempts": v.attempts}
            verdict_eval = {
                "source": "llm" if v.draft is not None else "fallback", "attempts": v.attempts,
                "pass_at_1": v.first_pass, "chip_pass_at_1": v.chip_first_pass, "errors": v.errors[-2:],
            }
        else:
            timed_out = True
    except LmStudioUnreachable as exc:
        return _finish(base, ["llm_unreachable"], {"prompt_version": PROMPT_VERSION, "error": str(exc)[:300], "llm_calls": client.stats.calls}, base["strategy_actions"])

    if timed_out:
        degraded.append("full_tier_time_cap")

    # ── Consistency checker ────────────────────────────────────────────────
    verdict = VerdictDraft.model_validate(drafts[T1]["draft"])
    chip_sources = {f.id for s in (T.T3_FUNNEL, T.T4_SPEND, T.T5_PACE, T.T6_CLASS) for f in routed_all.get(s, [])}
    report = check_consistency(
        report_class=cls, t6=routed_all.get(T.T6_CLASS, []), coverage_gaps=state.get("coverage_gaps") or [],
        actions=[a for a in actions if a.rank <= 3], finding_ids=set(findings_by_id), chips=verdict.chips, chip_source_ids=chip_sources,
    )
    if report.stray_chips and drafts[T1]["narration_source"] == "llm":
        drafts[T1] = {"draft": reference.model_dump(mode="json"), "narration_source": "fallback", "narration_attempts": drafts[T1]["narration_attempts"]}
    degraded += report.violations

    narrated = [e for e in sections_eval.values() if e.get("source") != "template"]
    sources = action_eval.get("sources") or {}
    eval_block = {
        "prompt_version": PROMPT_VERSION,
        "model": client.config.model,
        "duration_s": round(loop.time() - started, 1),
        "llm_calls": client.stats.calls,
        "calls_by_agent": client.stats.by_agent,
        "transport_retries": client.stats.transport_retries,
        "truncated": client.stats.truncated,
        "prompt_tokens": client.stats.prompt_tokens,
        "completion_tokens": client.stats.completion_tokens,
        "pass_at_1": {
            "narrator": _ratio([bool(e.get("pass_at_1")) for e in narrated]),
            "action_phraser": action_eval.get("pass_at_1"),
            "synthesist": verdict_eval.get("pass_at_1"),
            "chip_gate": verdict_eval.get("chip_pass_at_1"),
        },
        "fallback_rate": {
            "sections": _ratio([e.get("source") == "fallback" for e in narrated]),
            "actions": _ratio([s == "fallback" for s in sources.values()]),
        },
        "sections": sections_eval,
        "actions": action_eval,
        "verdict": verdict_eval,
        "consistency": report.violations,
    }
    return _finish(
        {**base, "section_drafts": drafts}, degraded, eval_block,
        [a.model_dump(mode="json", by_alias=True) for a in actions],
    )


def _finish(base: dict, degraded: list[str], eval_block: dict, actions: list[dict]) -> dict[str, Any]:
    meta = dict(base["strategy_meta"])
    meta["degraded"] = [*meta.get("degraded", []), *degraded]
    meta["eval"] = eval_block
    return {**base, "strategy_actions": actions, "strategy_meta": meta}
