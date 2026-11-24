"""Strategy Report full tier, offline (PRD §8, §11.2, §13 #2–#4).

The LLM client's control flow against a mock transport; the token budget and
name tokenizer; the strategy numeral rules, Action Gate, Chip Gate, generic
detector and consistency checker on hand-written good and bad copy; and the
full-tier node end to end with a scripted model — accepted, rejected, server
down, and out of time.
"""

from __future__ import annotations

import asyncio
import json
import pathlib

import httpx
import pytest

import engine.graphs.strategy_agents as agents_module
import engine.llm.client as client_module
from engine.api.dispatcher import _content_from_state
from engine.contracts import Finding
from engine.contracts.content import BriefContentV2
from engine.contracts.strategy import ActionCopy, ActionItem, StrategyFrame, VerdictChip
from engine.gates.consistency import check_consistency, class_highlight_ok
from engine.gates.generic import generic_problems
from engine.gates.strategy_gates import allowed_from, numerals, orphan_numerals, run_action_gate, run_chip_gate
from engine.graphs.strategy import strategy_fanout_node, strategy_instant_copy_node, strategy_route_node
from engine.graphs.strategy_agents import strategy_full_node
from engine.llm.budget import estimate_tokens, trim_to_budget
from engine.llm.client import CallStats, LmStudioClient, LmStudioConfig, LmStudioTruncated, LmStudioUnreachable, _LoopShared
from engine.llm.tokenize import NameTokenizer
from eval.fixtures.strategy_synthetic import brand_full

FIXTURE = pathlib.Path(__file__).resolve().parents[1] / "eval" / "fixtures" / "bardi_strategy_frame.json"


@pytest.fixture(scope="module")
def bardi() -> StrategyFrame:
    return StrategyFrame.model_validate_json(FIXTURE.read_text(encoding="utf-8"))


# ─── LM Studio client (§13 #2–#4) ────────────────────────────────────────────


def _install_transport(handler, concurrency: int = 1) -> None:
    loop = asyncio.get_running_loop()
    client_module._SHARED[id(loop)] = _LoopShared(
        semaphore=asyncio.Semaphore(concurrency), http=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )


def _reply(content: str | None, finish: str = "stop") -> httpx.Response:
    return httpx.Response(200, json={
        "choices": [{"message": {"content": content}, "finish_reason": finish}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    })


async def _call(client: LmStudioClient, **kw) -> str:
    return await client.complete_json(system="s", user="u", json_schema={"type": "object"}, schema_name="x", **kw)


def test_config_reads_env(monkeypatch):
    monkeypatch.setenv("LM_STUDIO_URL", "http://127.0.0.1:9999/v1")
    monkeypatch.setenv("LM_STUDIO_MODEL", "some/model")
    monkeypatch.setenv("LM_STUDIO_MAX_TOKENS", "2048")
    monkeypatch.setenv("LM_STUDIO_TIMEOUT_S", "30")
    monkeypatch.setenv("LM_STUDIO_CONCURRENCY", "2")
    c = LmStudioConfig.from_env()
    assert (c.base_url, c.model, c.max_tokens, c.timeout_s, c.concurrency) == ("http://127.0.0.1:9999/v1", "some/model", 2048, 30.0, 2)


def test_config_defaults(monkeypatch):
    for k in ("LM_STUDIO_URL", "LM_STUDIO_MODEL", "LM_STUDIO_MAX_TOKENS", "LM_STUDIO_TIMEOUT_S", "LM_STUDIO_CONCURRENCY"):
        monkeypatch.delenv(k, raising=False)
    c = LmStudioConfig.from_env()
    assert (c.max_tokens, c.concurrency, c.timeout_s) == (8192, 1, 180.0)


async def test_payload_carries_seed_and_thinking_toggle():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.update(json.loads(req.content))
        return _reply('{"a": 1}')

    _install_transport(handler)
    client = LmStudioClient(LmStudioConfig())
    assert await _call(client, seed=42, thinking=False, agent="narrator") == '{"a": 1}'
    assert seen["seed"] == 42 and seen["reasoning_effort"] == "none" and seen["max_tokens"] == 8192
    assert client.stats.calls == 1 and client.stats.by_agent == {"narrator": 1} and client.stats.prompt_tokens == 10


async def test_length_with_empty_content_is_truncated():
    _install_transport(lambda req: _reply("", finish="length"))
    client = LmStudioClient(LmStudioConfig())
    with pytest.raises(LmStudioTruncated):
        await _call(client)
    assert client.stats.truncated == 1


async def test_transport_retries_then_succeeds(monkeypatch):
    monkeypatch.setattr(client_module, "TRANSPORT_BACKOFF_S", (0.0, 0.0))
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.ConnectError("down", request=req)
        return _reply('{"ok": true}')

    _install_transport(handler)
    client = LmStudioClient(LmStudioConfig())
    assert await _call(client) == '{"ok": true}'
    assert client.stats.transport_retries == 2


async def test_transport_gives_up_as_unreachable(monkeypatch):
    monkeypatch.setattr(client_module, "TRANSPORT_BACKOFF_S", (0.0, 0.0))

    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=req)

    _install_transport(handler)
    with pytest.raises(LmStudioUnreachable):
        await _call(LmStudioClient(LmStudioConfig()))


async def test_semaphore_serialises_concurrent_calls():
    active = {"now": 0, "max": 0}

    async def handler(req: httpx.Request) -> httpx.Response:
        active["now"] += 1
        active["max"] = max(active["max"], active["now"])
        await asyncio.sleep(0.02)
        active["now"] -= 1
        return _reply("{}")

    _install_transport(handler, concurrency=1)
    a, b = LmStudioClient(LmStudioConfig()), LmStudioClient(LmStudioConfig())  # two runs, one GPU
    await asyncio.gather(*(_call(c) for c in (a, b, a, b)))
    assert active["max"] == 1


# ─── Budget and tokenizer (§8.1, §8.7) ───────────────────────────────────────


def test_trim_drops_lowest_materiality_first():
    items = [("a", 0.9, "x" * 4000), ("b", 0.1, "y" * 4000), ("c", 0.5, "z" * 4000)]
    res = trim_to_budget(items, lambda it: "".join(i[2] for i in it), materiality=lambda i: i[1], item_id=lambda i: i[0], budget=estimate_tokens("x" * 8000))
    assert res.dropped_ids == ["b"] and [i[0] for i in res.kept] == ["a", "c"]


def test_trim_keeps_one_item_even_over_budget():
    res = trim_to_budget([("a", 0.5, "x" * 40000)], lambda it: "".join(i[2] for i in it), materiality=lambda i: i[1], item_id=lambda i: i[0], budget=10)
    assert [i[0] for i in res.kept] == ["a"] and res.tokens > 10


def test_tokenizer_round_trip():
    tok = NameTokenizer(["BARDI Smart Home", "BARDI"], ["Kampanye Payday"])
    enc = tok.encode("BARDI Smart Home naik; bardi turun; Kampanye Payday selesai; TP-Link tetap.")
    assert enc == "BRAND naik; BRAND turun; KAMPANYE_1 selesai; TP-Link tetap."
    assert tok.decode_obj({"t": [enc]}) == {"t": ["BARDI Smart Home naik; BARDI Smart Home turun; Kampanye Payday selesai; TP-Link tetap."]}


# ─── Numeral rules (§8.6) ────────────────────────────────────────────────────


def test_percent_and_poin_are_one_family():
    allowed = {0.045, 0.112}
    assert orphan_numerals("Tahap ini 4,5% dan selisih 11,2 poin.", allowed) == []
    assert orphan_numerals("Tahap ini 4,5 poin.", allowed) == []
    assert orphan_numerals("Tahap ini 7,5%.", allowed) == ["7,5%"]


def test_rupiah_without_space_is_checked():
    assert [n.value for n in numerals("Belanja Rp48.596.564.")] == [48596564.0]
    assert orphan_numerals("Belanja Rp48.000.000.", {48596564.0}) == ["48.000.000"]
    assert orphan_numerals("Belanja Rp48.596.564.", {48596564.0}) == []


def test_scale_words_and_labels():
    allowed = {48596564.0, 236000.0}
    assert orphan_numerals("Belanja Rp48,6 juta untuk 236 ribu orang.", allowed) == []
    assert orphan_numerals("Biaya per 1.000 audiens; Top 50 merek; R² rendah; pada 26 September 2026.", set()) == []
    assert orphan_numerals("Belanja Rp51 juta.", allowed) == ["51"]


def test_allowed_includes_payload_numerals():
    f = Finding.model_validate({
        "id": "f", "generator": "T01", "tenant_id": "t", "brief_type": "strategy", "section_affinity": [103],
        "entity": {"level": "brand", "id": "b", "display_name": "B"}, "level": "brand", "claim_frame": "stage_leak",
        "evidence": {"size_ratio": 0.0447}, "comparison": None, "magnitude_pct": 0.5, "direction": "negative",
        "actionability": "high", "confidence": "high", "materiality": 0.5,
    })
    allowed = allowed_from([f], "selisih 11,21 poin")
    assert orphan_numerals("Ukuran 4,47% dengan selisih 11,21 poin.", allowed) == []


# ─── Action Gate (§8.6) ──────────────────────────────────────────────────────


async def _instant(frame: StrategyFrame) -> dict:
    state = {"tenant_id": frame.tenant_id, "brief_type": "strategy", "run_id": "r", "strategy_frame": frame.model_dump(mode="json"), "tier": "instant"}
    state.update(await strategy_fanout_node(state))
    state.update(await strategy_route_node(state))
    return state


@pytest.fixture
async def bardi_state(bardi) -> dict:
    return await _instant(bardi)


async def test_deterministic_copy_passes_action_gate(bardi_state):
    out = await strategy_instant_copy_node(bardi_state)
    by_id = {f["id"]: Finding.model_validate(f) for f in bardi_state["findings"]}
    plan = [ActionItem.model_validate(a) for a in out["strategy_actions"] if a["rank"] <= 3]
    assert {a.lever for a in plan} == {"stage_targeting", "content_mix", "investigate"}
    for a in plan:
        assert run_action_gate(a.copy_, a, by_id.get(a.evidence_refs[0])) == [], a.id


async def test_action_gate_rejects_bad_copy(bardi_state):
    out = await strategy_instant_copy_node(bardi_state)
    a = next(ActionItem.model_validate(x) for x in out["strategy_actions"] if x["lever"] == "stage_targeting")
    good = a.copy_
    # Rounded to the written precision is fine; a different value is not.
    assert run_action_gate(good.model_copy(update={"langkah": good.langkah.replace("4,47%", "4,5%")}), a, None) == []
    cases = {
        "wrong target": good.langkah.replace("9,47%", "12,00%"),
        "no horizon": good.langkah.replace(" dalam 4 minggu", ""),
        "extra numeral": good.langkah.replace(".", " untuk 3 produk.", 1) if good.langkah.endswith(".") else good.langkah + " untuk 37 produk",
        "unapproved phrase": good.langkah.replace("Naikkan ukuran tahap", "Dorong ukuran tahap"),
    }
    for name, langkah in cases.items():
        assert run_action_gate(good.model_copy(update={"langkah": langkah}), a, None), name
    assert run_action_gate(good.model_copy(update={"gagal_jika": "Klik kartu produk tidak naik dalam 30 hari."}), a, None)


async def test_investigate_gate_needs_both_ranks_and_name(bardi_state):
    out = await strategy_instant_copy_node(bardi_state)
    by_id = {f["id"]: Finding.model_validate(f) for f in bardi_state["findings"]}
    a = next(ActionItem.model_validate(x) for x in out["strategy_actions"] if x["lever"] == "investigate")
    f = by_id[a.evidence_refs[0]]
    bad = a.copy_.model_copy(update={"langkah": f"Selidiki pesaing: dari #{f.evidence['rank_14d']} ke #3 di tahap Awareness."})
    probs = run_action_gate(bad, a, f)
    assert any("peringkat sekarang" in p for p in probs) and any("tidak menyebut" in p for p in probs)


# ─── Chip Gate, generic detector, consistency ────────────────────────────────


def test_chip_gate():
    ref = [
        VerdictChip(label="Hambatan", value="Consideration → Conversion", status="critical", finding_id="a"),
        VerdictChip(label="Efisiensi belanja", value="Belum terbaca (R² 0,00)", status="unknown", finding_id="b"),
        VerdictChip(label="Laju target", value="#38 → target #25", status="off_track", finding_id="c"),
    ]
    assert run_chip_gate([c.model_copy(update={"label": c.label.upper()}) for c in ref], ref) == []
    bad = [ref[0], ref[1].model_copy(update={"status": "watch"}), ref[2].model_copy(update={"value": "#38 → target #20"})]
    probs = run_chip_gate(bad, ref)
    assert any("chip 2" in p for p in probs) and any("chip 3" in p for p in probs)
    assert run_chip_gate(ref[:2], ref) == ["harus ada 3 chip"]


def test_generic_detector():
    assert generic_problems(["Ukuran tahap Conversion hanya 4,47% dari Consideration."]) == []
    assert generic_problems(["Hal ini menunjukkan bahwa performa meningkat secara signifikan."])
    assert generic_problems(["Strategi ini akan membawa hasil yang baik bagi bisnis ke depan."])  # no entity, no number
    assert generic_problems(["Setiap impresi berbayar menghasilkan 0,64 untuk Top 10 (bukan 'jauh di bawah')."])
    assert generic_problems(["Penjualan Kiehl's naik di tahap Awareness."]) == []


async def test_class_highlight_gate(bardi, bardi_state):
    t6 = [Finding.model_validate(f) for f in bardi_state["findings"] if f["id"] in bardi_state["rankings"]["106"]["selected_ids"]]
    assert class_highlight_ok("shop", t6, []) is True
    brand_state = await _instant(brand_full())
    bt6 = [Finding.model_validate(f) for f in brand_state["findings"] if f["id"] in brand_state["rankings"]["106"]["selected_ids"]]
    assert class_highlight_ok("brand", bt6, []) is True
    assert class_highlight_ok("brand", [], []) is False
    assert class_highlight_ok("brand", [], [{"generator": "T05", "reason": "x"}]) is True


def test_consistency_flags_unresolved_actions_and_stray_chips():
    a = ActionItem.model_validate({
        "id": "act_01", "rank": 1, "priority": "P0", "lever": "investigate", "metric_key": "m", "entity": {}, "current": None,
        "target": None, "horizon_days": 7, "basis": "defensive", "confidence": "low", "kill_signal": None, "evidence_refs": ["ghost"],
    })
    chips = [VerdictChip(label="x", value="y", status="unknown", finding_id="elsewhere")]
    rep = check_consistency(report_class="shop", t6=[], coverage_gaps=[], actions=[a], finding_ids={"real"}, chips=chips, chip_source_ids={"real"})
    assert rep.violations == ["class_highlight_missing", "action_evidence_unresolved:act_01", "chip_unrouted:1"]


# ─── Full-tier node with a scripted model ────────────────────────────────────


class ScriptedClient:
    """Answers each agent from the instant tier's own copy (which passes every
    gate), optionally corrupted per schema name."""

    def __init__(self, instant: dict, *, corrupt: set[str] = frozenset(), raise_unreachable: bool = False) -> None:
        self.instant = instant
        self.corrupt = corrupt
        self.raise_unreachable = raise_unreachable
        self.config = LmStudioConfig()
        self.stats = CallStats()
        self.names: list[str] = []

    async def complete_json(self, **kw) -> str:
        name = kw["schema_name"]
        self.names.append(name)
        self.stats.calls += 1
        agent = kw.get("agent") or "?"
        self.stats.by_agent[agent] = self.stats.by_agent.get(agent, 0) + 1
        if self.raise_unreachable:
            raise LmStudioUnreachable("down")
        bad = any(name.startswith(c) for c in self.corrupt)
        if name.startswith("strategy_section_"):
            draft = dict(self.instant["section_drafts"][name.rsplit("_", 1)[1]]["draft"])
            draft.setdefault("implication", None)
            if bad:
                draft["headline"] = "Funnel turun 73,9% minggu ini karena hal lain."
            return json.dumps(draft)
        if name == "strategy_critic":
            return json.dumps({"approved": True, "notes": "", "revised_draft": {"headline": "x" * 10, "paragraphs": [], "implication": None}})
        if name in ("strategy_actions", "strategy_action_critic"):
            items = [{"id": a["id"], **a["copy"]} for a in self.instant["strategy_actions"] if a["rank"] <= 3]
            if bad:
                items = [{**i, "langkah": i["langkah"] + " Tambah 999 video."} for i in items]
            body = {"items": items} if name == "strategy_actions" else {"approved": True, "notes": "", "items": items}
            return json.dumps(body)
        if name == "strategy_verdict":
            v = dict(self.instant["section_drafts"]["101"]["draft"])
            if bad:
                v["chips"] = [{**c, "status": "good"} for c in v["chips"]]
            return json.dumps(v)
        raise AssertionError(name)


async def _full(state: dict, monkeypatch, **kw) -> tuple[dict, ScriptedClient]:
    instant = await strategy_instant_copy_node(state)
    client = ScriptedClient(instant, **kw)
    monkeypatch.setattr(agents_module, "LmStudioClient", lambda *a, **k: client)
    out = await strategy_full_node(state)
    content = _content_from_state({**state, **out, "tier": "full"})
    BriefContentV2.model_validate(content)
    return content, client


async def test_full_tier_accepts_gate_passing_copy(bardi_state, monkeypatch):
    c, client = await _full(bardi_state, monkeypatch)
    ev = c["meta"]["eval"]
    assert c["meta"]["degraded"] == []
    assert {k: c["sections"][k]["narration_source"] for k in ("101", "103", "104", "105", "106", "107")} == dict.fromkeys(("101", "103", "104", "105", "106", "107"), "llm")
    assert c["sections"]["108"]["narration_source"] == "template"  # T8 renders as signal rows
    assert ev["pass_at_1"] == {"narrator": 1.0, "action_phraser": True, "synthesist": True, "chip_gate": True}
    assert ev["fallback_rate"] == {"sections": 0.0, "actions": 0.0}
    assert ev["prompt_version"] == "strategy-1" and ev["llm_calls"] == client.stats.calls
    # Class order: shop narrates T3, T4, T6, T5, T7 — then actions, then T1.
    sections = [n for n in client.names if n.startswith("strategy_section_")]
    assert sections == ["strategy_section_103", "strategy_section_104", "strategy_section_106", "strategy_section_105", "strategy_section_107"]
    assert client.names[-1] == "strategy_verdict"


async def test_full_tier_falls_back_per_part(bardi_state, monkeypatch):
    c, _ = await _full(bardi_state, monkeypatch, corrupt={"strategy_section_104", "strategy_actions", "strategy_verdict"})
    ev = c["meta"]["eval"]
    assert c["sections"]["104"]["narration_source"] == "fallback"
    assert c["sections"]["104"]["narration_attempts"] == 2  # retried once
    assert c["sections"]["103"]["narration_source"] == "llm"
    assert set(ev["actions"]["sources"].values()) == {"fallback"}
    assert c["sections"]["101"]["narration_source"] == "fallback" and ev["verdict"]["chip_pass_at_1"] is False
    # Fallback copy is the deterministic copy, so the report is still complete.
    assert all(a["copy"]["langkah"] for a in c["action_plan"])


async def test_full_tier_unreachable_returns_instant_report(bardi_state, monkeypatch):
    c, _ = await _full(bardi_state, monkeypatch, raise_unreachable=True)
    assert c["meta"]["degraded"] == ["llm_unreachable"]
    assert {e["narration_source"] for e in c["sections"].values()} == {"template"}


async def test_full_tier_time_cap(bardi_state, monkeypatch):
    monkeypatch.setenv("STRATEGY_FULL_TIER_CAP_S", "0")
    c, client = await _full(bardi_state, monkeypatch)
    assert "full_tier_time_cap" in c["meta"]["degraded"]
    assert client.names == []
