"""Brand-class Strategy Reports (no TikTok Shop) never surface or target the
Conversion stage, product-card share, or TikTok Shop wording."""

from __future__ import annotations

import json
import pathlib

import pytest

from engine.contracts.strategy import StrategyFrame
from engine.copy.strategy import deterministic_action_copy
from engine.generators.strategy import STRATEGY_GENERATORS, T09TargetSolver
from engine.llm.strategy_prompts import BRAND_CLASS_RULE, header_line

FIXTURE = pathlib.Path(__file__).resolve().parents[1] / "eval" / "fixtures" / "bardi_strategy_frame.json"


def _frame(cls: str) -> StrategyFrame:
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["classification"]["report_class"] = cls
    return StrategyFrame.model_validate(raw)


def _run(frame: StrategyFrame):
    findings = []
    for g in STRATEGY_GENERATORS:
        findings.extend(g.run(frame).findings)
    solver, actions = T09TargetSolver().run(frame, findings)
    return findings + list(solver.findings), actions


@pytest.mark.parametrize("cls", ["brand"])
def test_brand_class_has_no_conversion_or_product_card_findings(cls):
    findings, actions = _run(_frame(cls))
    assert not [f for f in findings if f.evidence.get("next_stage") == "conversion"]
    assert not [f for f in findings if f.evidence.get("metric") == "product_card_clicks"]
    assert not [f for f in findings if f.id == "t01_offset_conversion"]
    assert not [a for a in actions if a.kill_signal and a.kill_signal.metric_key == "ttms.product_card_clicks"]


def test_shop_class_still_targets_conversion():
    findings, actions = _run(_frame("shop"))
    assert [f for f in findings if f.evidence.get("next_stage") == "conversion"]  # BARDI's real leak


def test_brand_class_action_copy_never_mentions_tiktok_shop():
    frame = _frame("brand")
    findings, actions = _run(frame)
    by_id = {f.id: f for f in findings}
    for a in actions:
        copy = deterministic_action_copy(a, by_id, frame.brand_name, "brand")
        text = " ".join([copy.langkah, copy.dasar, copy.cara, copy.gagal_jika]).lower()
        assert "tiktok shop" not in text and "kartu produk" not in text, (a.lever, text)


def test_agents_get_the_brand_rule_only_for_brand_class():
    assert BRAND_CLASS_RULE in header_line(_frame("brand"))
    assert BRAND_CLASS_RULE not in header_line(_frame("shop"))
