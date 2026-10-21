"""The closed loop (Strategy Report PRD §5.6, P5): an accepted action is
re-measured by the next run (T11) and shows in T9 with a verdict; an action an
earlier run already judged shows with its stored verdict and is not measured
again."""

from __future__ import annotations

import pathlib
from datetime import timedelta

import pytest

from engine.contracts.strategy import ActionItem, ClosedAction, OpenAction, StrategyFrame
from engine.graphs.strategy import strategy_fanout_node, strategy_instant_copy_node, strategy_route_node

FIXTURE = pathlib.Path(__file__).resolve().parents[1] / "eval" / "fixtures" / "bardi_strategy_frame.json"


@pytest.fixture(scope="module")
def bardi() -> StrategyFrame:
    return StrategyFrame.model_validate_json(FIXTURE.read_text(encoding="utf-8"))


async def _run(frame: StrategyFrame) -> dict:
    state = {"tenant_id": frame.tenant_id, "brief_type": "strategy", "run_id": "r", "strategy_frame": frame.model_dump(mode="json"), "tier": "instant"}
    state.update(await strategy_fanout_node(state))
    state.update(await strategy_route_node(state))
    state.update(await strategy_instant_copy_node(state))
    return state


async def test_accepted_action_is_measured_and_logged(bardi):
    first = await _run(bardi)
    plan = [ActionItem.model_validate(a) for a in first["strategy_actions"] if a["rank"] <= 3]
    mix = next(a for a in plan if a.lever == "content_mix")
    started = bardi.as_of - timedelta(days=21)
    closed_action = next(a for a in plan if a.lever == "stage_targeting")

    frame = bardi.model_copy(update={
        "open_actions": [OpenAction(id="11111111-aaaa", action=mix.model_dump(mode="json", by_alias=True), started_at=started)],
        "closed_actions": [ClosedAction(
            id="22222222-bbbb", action=closed_action.model_dump(mode="json", by_alias=True), started_at=started - timedelta(days=14),
            status="failed", measured_value=0.044, category_delta=0.01, measured_at=started,
        )],
    })
    second = await _run(frame)

    t11 = [f for f in second["findings"] if f["generator"] == "T11"]
    assert len(t11) == 1 and t11[0]["evidence"]["action_id"] == "11111111-aaaa"
    assert t11[0]["evidence"]["days_running"] == 21
    log = second["action_log"]
    assert [r["action_id"] for r in log] == ["11111111-aaaa", "22222222-bbbb"]  # newest first
    measured, judged = log
    assert measured["verdict"] in ("worked", "weak", "failed", "running")
    assert measured["langkah"] == mix.copy_.langkah and measured["start_value"] == pytest.approx(mix.current.value)
    assert judged == {
        **judged, "verdict": "failed", "measured_value": 0.044, "category_delta": 0.01, "days_running": 14,
        "langkah": closed_action.copy_.langkah,
    }
    # T9 is drafted from the measured action, not the empty state.
    assert second["section_drafts"]["109"]["draft"]["paragraphs"][0]["evidence_refs"] == [t11[0]["id"]]


async def test_log_caps_at_six(bardi):
    first = await _run(bardi)
    a = next(x for x in first["strategy_actions"] if x["rank"] == 1)
    closed = [
        ClosedAction(id=f"c{i}", action=a, started_at=bardi.as_of - timedelta(days=40 + i), status="weak", measured_at=bardi.as_of - timedelta(days=i))
        for i in range(8)
    ]
    second = await _run(bardi.model_copy(update={"closed_actions": closed}))
    assert [r["action_id"] for r in second["action_log"]] == [f"c{i}" for i in range(6)]
    # Nothing running: T9 says so and tallies the judged ones, never "none accepted".
    t9 = second["section_drafts"]["109"]["draft"]
    assert t9["paragraphs"][0]["text"].endswith("8 lemah.") and "Belum ada tindakan yang diterima" not in t9["headline"]
