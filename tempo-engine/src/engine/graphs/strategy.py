"""Strategy Report path through the brief graph (PRD §8.4).

`strategy_fanout` → `strategy_route` → `strategy_instant_copy` (instant tier)
or the agent path (full tier, `graphs/strategy_agents.py`) → the shared
`review_gate`. State stays plain JSON, like the rest of the graph.

Everything a renderer draws — funnel bars, the spend-response scatter and its
fit, the weekly rank line, the content mix, the ranking list — is exported in
`charts` from the same helpers the generators computed from, so a chart can
never show a number the findings do not.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from engine.contracts import Finding
from engine.contracts.strategy import (
    SECTION_ORDER,
    ActionItem,
    ActionMeasured,
    GoalPace,
    StrategyCharts,
    StrategyFrame,
    StrategyMeta,
    StrategySectionId,
)
from engine.copy.strategy import (
    deterministic_action_copy,
    deterministic_verdict,
    instant_section_draft,
    signal_for,
    strategy_card_copy,
)
from engine.generators.strategy import STRATEGY_GENERATORS, T09TargetSolver
from engine.generators.strategy._util import flow_sum, in_range, last_day, value_sum
from engine.generators.strategy.t02_spend_response import LAG_DAYS, spend_response
from engine.generators.strategy.t03_goal_pacing import weekly_goal_series
from engine.materiality.strategy import route_strategy, score_strategy_findings

T = StrategySectionId
PROMPT_VERSION = "strategy-1"
NARRATED = (T.T3_FUNNEL, T.T4_SPEND, T.T5_PACE, T.T6_CLASS, T.T7_CONTENT, T.T8_WARNINGS)
TEMPLATE_ONLY = (T.T9_ACTION_LOG, T.LAMPIRAN_A)


def frame_of(state: dict) -> StrategyFrame:
    return StrategyFrame.model_validate(state["strategy_frame"])


async def strategy_fanout_node(state: dict) -> dict[str, Any]:
    frame = frame_of(state)
    findings: list[Finding] = []
    gaps = []
    for g in STRATEGY_GENERATORS:
        res = g.run(frame)
        findings.extend(res.findings)
        if res.coverage_gap:
            gaps.append(res.coverage_gap.model_dump(mode="json"))
    solver_res, actions = T09TargetSolver().run(frame, findings)
    findings.extend(solver_res.findings)
    return {
        "findings": [f.model_dump(mode="json") for f in findings],
        "coverage_gaps": gaps,
        "strategy_actions": [a.model_dump(mode="json", by_alias=True) for a in actions],
    }


async def strategy_route_node(state: dict) -> dict[str, Any]:
    frame = frame_of(state)
    cls = frame.classification.report_class
    scored = score_strategy_findings([Finding.model_validate(f) for f in state["findings"]], cls)
    rankings = route_strategy(scored, cls)
    return {
        "findings": [f.model_dump(mode="json") for f in scored],
        "rankings": {
            str(int(sid)): {
                "selected_ids": [r.finding.id for r in rk.ranked if r.included],
                "below_cut": [{"id": r.finding.id, "materiality": r.finding.materiality} for r in rk.ranked if not r.included],
            }
            for sid, rk in rankings.items()
        },
        "card_copy": {f.id: strategy_card_copy(f, frame.brand_name) for f in scored},
    }


def selected(state: dict, sid: StrategySectionId) -> list[Finding]:
    by_id = {f["id"]: f for f in state["findings"]}
    ids = state.get("rankings", {}).get(str(int(sid)), {}).get("selected_ids", [])
    return [Finding.model_validate(by_id[i]) for i in ids if i in by_id]


def with_copy(state: dict, frame: StrategyFrame) -> list[ActionItem]:
    """Actions with deterministic copy — the instant tier's text and the full
    tier's fallback for any action whose phrasing fails the Action Gate."""
    by_id = {f["id"]: Finding.model_validate(f) for f in state["findings"]}
    cls = frame.classification.report_class
    out = []
    for raw in state.get("strategy_actions", []):
        a = ActionItem.model_validate(raw)
        out.append(a.model_copy(update={"copy_": deterministic_action_copy(a, by_id, frame.brand_name, cls)}))
    return out


async def strategy_instant_copy_node(state: dict) -> dict[str, Any]:
    """Zero model calls (PRD §7.6). The same section slots and content shape as
    the full tier — a tier is a copy source, not a different document."""
    frame = frame_of(state)
    actions = with_copy(state, frame)
    drafts = {}
    for sid in (*NARRATED, *TEMPLATE_ONLY):
        draft = instant_section_draft(sid, selected(state, sid), frame, "t10_coverage")
        drafts[str(int(sid))] = {"draft": draft.model_dump(mode="json"), "narration_source": "template", "narration_attempts": 0}
    routed = {sid: selected(state, sid) for sid in (*NARRATED, *TEMPLATE_ONLY)}
    verdict = deterministic_verdict(frame, routed, actions)
    drafts[str(int(T.T1_VERDICT))] = {"draft": verdict.model_dump(mode="json"), "narration_source": "template", "narration_attempts": 0}
    return {
        "section_drafts": drafts,
        "strategy_actions": [a.model_dump(mode="json", by_alias=True) for a in actions],
        **export_blocks(state, frame, actions),
        "probe_loop_enabled": False,
        "probes_executed": 0,
        "probe_yield_rate": 0.0,
        "probe_rounds_used": 0,
        "probe_log": [],
    }


# ─── Export blocks ───────────────────────────────────────────────────────────


def export_blocks(state: dict, frame: StrategyFrame, actions: list[ActionItem], degraded: list[str] | None = None) -> dict[str, Any]:
    findings = [Finding.model_validate(f) for f in state["findings"]]
    by_id = {f.id: f for f in findings}
    signals = [signal_for(f, frame.brand_name).model_dump(mode="json") for f in selected(state, T.T8_WARNINGS)]
    meta = StrategyMeta(
        ttms_account_id=frame.ttms_account_id, brand_name=frame.brand_name, vertical=frame.vertical, plan=frame.plan,
        is_lite=frame.is_lite, as_of=frame.as_of, window_start=frame.current_start, window_end=frame.as_of,
        benchmark=frame.benchmark, section_order=[int(s) for s in SECTION_ORDER[frame.classification.report_class]],
        prompt_version=PROMPT_VERSION, degraded=degraded or [],
    )
    return {
        "report_class": frame.classification.model_dump(mode="json"),
        "signals": signals,
        "goal_pace": goal_pace(frame, by_id.get("t03_goal")),
        "action_log": action_log(frame, findings),
        "charts": build_charts(frame).model_dump(mode="json"),
        "strategy_meta": meta.model_dump(mode="json"),
    }


def goal_pace(frame: StrategyFrame, f: Finding | None) -> dict | None:
    g = frame.goal
    weekly = [{"date": d.isoformat(), "value": v} for d, v in weekly_goal_series(frame)] if g else []
    if g is None:
        return None
    if f is None:
        return GoalPace(kind=g.kind, stage=g.stage, metric=g.metric, target=g.value, deadline=g.deadline, status="insufficient_history", weekly=weekly).model_dump(mode="json")
    e = f.evidence
    return GoalPace(
        kind=g.kind, stage=g.stage, metric=g.metric, target=g.value, deadline=g.deadline,
        current=e.get("current"), projected=e.get("projected"), projected_low=e.get("projected_low"),
        projected_high=e.get("projected_high"), required_pace_per_week=e.get("required_per_week"),
        current_pace_per_week=e.get("pace_per_week"), feasibility=e.get("feasibility"),
        status=e.get("status", "insufficient_history"), weekly=weekly,  # type: ignore[arg-type]
    ).model_dump(mode="json")


def action_log(frame: StrategyFrame, findings: list[Finding]) -> list[dict]:
    """T9's table (PRD §5.6): the running actions this run measured (T11) and
    the actions earlier runs already judged, newest first, at most 6."""
    measured = {str(f.evidence.get("action_id")): f for f in findings if f.generator == "T11"}
    rows: list[tuple[date, dict]] = []
    for oa in frame.open_actions:
        f = measured.get(oa.id)
        copy = (oa.action.get("copy") or {}) if isinstance(oa.action, dict) else {}
        if f is None:
            continue
        e = f.evidence
        rows.append((frame.as_of, ActionMeasured(
            action_id=oa.id, started_at=oa.started_at, langkah=copy.get("langkah"), metric_key=str(e["metric_key"]),
            start_value=e.get("start_value"), measured_value=e.get("measured_value"), target_value=e.get("target_value"),
            category_delta=e.get("category_delta"), verdict=str(e["verdict"]), days_running=int(e["days_running"]),  # type: ignore[arg-type]
        ).model_dump(mode="json")))
    for ca in frame.closed_actions:
        if ca.started_at is None:
            continue
        a = ca.action if isinstance(ca.action, dict) else {}
        when = ca.measured_at or frame.as_of
        rows.append((when, ActionMeasured(
            action_id=ca.id, started_at=ca.started_at, langkah=(a.get("copy") or {}).get("langkah"),
            metric_key=str(a.get("metric_key", "")), start_value=(a.get("current") or {}).get("value"),
            measured_value=ca.measured_value, target_value=(a.get("target") or {}).get("value"),
            category_delta=ca.category_delta, verdict=ca.status, days_running=max(0, (when - ca.started_at).days),
        ).model_dump(mode="json")))
    rows.sort(key=lambda r: r[0], reverse=True)
    return [r for _, r in rows[:6]]


def build_charts(frame: StrategyFrame) -> StrategyCharts:
    lv = frame.benchmark
    funnel = []
    for stage in ("awareness", "consideration", "conversion"):
        d = last_day(frame.audience.get(stage, []), frame.as_of)
        if d:
            funnel.append({"stage": stage, "total": d.total, "bench_total": d.bench_total.get(lv), "rank": d.rank, "rank_n": d.rank_n})

    sr = spend_response(frame)
    spend_chart = None
    if sr and sr.points:
        spend_chart = {
            "stage": sr.stage,
            "lag_days": LAG_DAYS,
            "points": [{"spend": s, "new": y} for s, y in sr.points],
            "fit": {"a": sr.fit.a, "b": sr.fit.b, "r2": sr.fit.r2, "knee": sr.fit.knee} if sr.fit else None,
        }

    rank_weekly = []
    for stage in ("awareness", "consideration", "conversion"):
        weeks: dict[date, tuple[date, int]] = {}
        for d in frame.audience.get(stage, []):
            if d.rank is not None:
                weeks[d.date - timedelta(days=d.date.weekday())] = (d.date, d.rank)
        rank_weekly.extend({"stage": stage, "date": v[0].isoformat(), "rank": v[1]} for _, v in sorted(weeks.items()))

    win = lambda ct: in_range(frame.insight("impressions", ct), frame.current_start, frame.as_of)  # noqa: E731
    total = value_sum(win("all"))
    bench_all = sum((d.bench_value.get(lv) or 0) for d in win("all"))
    mix = []
    if total:
        for ct in ("paid", "non_paid", "ads", "bgc_organic", "bgc_boosted", "creator_organic", "creator_boosted", "ugc_organic", "ugc_boosted"):
            v = value_sum(win(ct))
            b = sum((d.bench_value.get(lv) or 0) for d in win(ct))
            mix.append({"content_type": ct, "share": (v or 0) / total, "bench_share": b / bench_all if bench_all else None})

    stage_table = []
    for stage in ("acc", "awareness", "consideration", "conversion"):
        series = frame.audience.get(stage, [])
        d = last_day(series, frame.as_of)
        if not d:
            continue
        stage_table.append(
            {
                "stage": stage, "total": d.total, "rank": d.rank, "rank_n": d.rank_n,
                "new": flow_sum(series, frame.current_start, frame.as_of, "new"),
                "outflow": flow_sum(series, frame.current_start, frame.as_of, "outflow"),
                "bench_total": d.bench_total.get(lv),
            }
        )

    # The Consideration list (the stage the PRD's T6/Lampiran ranking shows):
    # top 10 plus the brand's neighbourhood of ±5, names and ranks only.
    rank_list = None
    comps = frame.competitors.get("consideration")
    own = last_day(frame.audience.get("consideration", []), frame.as_of)
    if comps and own and own.rank is not None:
        rows = sorted(
            [{"brand": c.brand, "rank": c.rank_now, "rank_7d": c.rank_7d, "own": False} for c in comps]
            + [{"brand": frame.brand_name, "rank": own.rank, "rank_7d": None, "own": True}],
            key=lambda r: (r["rank"], not r["own"]),
        )
        keep = [r for i, r in enumerate(rows) if i < 10 or abs(r["rank"] - own.rank) <= 5]
        rank_list = {"stage": "consideration", "as_of": frame.as_of.isoformat(), "n": own.rank_n, "rows": keep}

    return StrategyCharts(funnel=funnel, spend_response=spend_chart, rank_weekly=rank_weekly, content_mix=mix, rank_list=rank_list, stage_table=stage_table)
