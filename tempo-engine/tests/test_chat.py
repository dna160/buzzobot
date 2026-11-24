"""Tanya Tempo pure tests — no DB, no LM Studio (PRD §13.2).

Covers metrics/windows, each tool's output on fixtures, client resolution
inside the workspace (named, ambiguous, unknown, other agency), the portfolio
tool, bad tool calls, the number gate, and the loop (against the real
`LmStudioClient` wired to an `httpx.MockTransport`).
"""

from __future__ import annotations

import asyncio
import json
import pathlib
from datetime import date

import httpx
import pytest

from engine.chat import gate, metrics
from engine.chat.agent import run_chat
from engine.chat.data import (
    ClientOverview,
    FakeChatData,
    PaidCoverage,
    PortfolioRow,
    TtmsLink,
)
from engine.chat.scope import ALL_TOOLS, ChatScope, ChatWorkspace, Principal, allowed_tools, workspace_for
from engine.chat.tools import ToolContext, run_tool, tool_specs
from engine.contracts.strategy import StrategyFrame
from engine.llm import client as llm_client
from engine.llm.client import LmStudioClient, LmStudioConfig
from engine.ports.tempo_read import AwarenessRollupRow, RollupRow

FIXTURE = pathlib.Path(__file__).resolve().parents[1] / "eval" / "fixtures" / "bardi_strategy_frame.json"
CANARY = 55_555_555  # an out-of-workspace client's distinctive spend; must never surface.


def shop_scope(slug: str = "acme", name: str = "Acme") -> ChatScope:
    return ChatScope(
        client_slug=slug, tenant_id="t-acme", agency_id="ag-1", client_name=name,
        north_star="shop", currency="IDR", timezone="UTC",
    )


def ctx_for(data: FakeChatData, scope: ChatScope | None = None) -> ToolContext:
    """A context whose workspace holds `scope` (default Acme) and focuses on it,
    so a tool called without `client` reads that client — the UI-focus path."""
    scope = scope or shop_scope()
    if scope not in data.clients:
        data.clients.append(scope)
    return ToolContext(workspace=ChatWorkspace(focus_slug=scope.client_slug), data=data)


def _rows(days: list[date], *, campaign="c1", cname="Kampanye A", spend=100_000.0,
          impressions=10_000, clicks=200, conversions=10, conversion_value=500_000.0,
          adgroup=None) -> list[RollupRow]:
    return [
        RollupRow(day=d, campaign_id=campaign, campaign_name=cname, adgroup_id=adgroup,
                  adgroup_name=None, spend=spend, impressions=impressions, clicks=clicks,
                  conversions=conversions, conversion_value=conversion_value)
        for d in days
    ]


def _window(end: date, n: int) -> list[date]:
    return [date.fromordinal(end.toordinal() - i) for i in range(n - 1, -1, -1)]


# ─── Window resolution (§7.3) ────────────────────────────────────────────────


def test_window_excludes_todays_partial_day():
    today = date(2026, 10, 11)
    available = _window(today, 30)  # includes today
    bounds = metrics.window_bounds(available, today, None, 7)
    assert bounds is not None
    cur_first, cur_last, prior_first, prior_last = bounds
    assert cur_last == date(2026, 10, 10)  # today-1, partial today dropped
    assert cur_first == date(2026, 10, 4)
    assert (prior_first, prior_last) == (date(2026, 9, 27), date(2026, 10, 3))


def test_window_clamps_to_explicit_end_date():
    today = date(2026, 10, 20)
    available = _window(today, 60)
    bounds = metrics.window_bounds(available, today, date(2026, 10, 10), 7)
    assert bounds is not None
    assert bounds[1] == date(2026, 10, 10)


def test_window_none_when_no_data():
    assert metrics.window_bounds([], date(2026, 10, 11), None, 7) is None


# ─── Metrics: ratios from sums, zero denominators, polarity ──────────────────


def test_shop_metrics_derived_from_sums():
    m = metrics.metric_values("shop", {
        "spend": 700_000, "impressions": 70_000, "clicks": 1_400,
        "conversions": 70, "conversion_value": 3_500_000,
    })
    assert m["ctr"] == pytest.approx(0.02)
    assert m["cvr"] == pytest.approx(0.05)
    assert m["aov"] == pytest.approx(50_000)
    assert m["roas"] == pytest.approx(5.0)
    assert m["cpm"] == pytest.approx(10_000)
    assert m["cpc"] == pytest.approx(500)
    assert m["cost_per_order"] == pytest.approx(10_000)


def test_ratios_omitted_when_denominator_zero():
    m = metrics.metric_values("shop", {
        "spend": 0, "impressions": 0, "clicks": 0, "conversions": 0, "conversion_value": 0,
    })
    assert "ctr" not in m and "cpm" not in m and "roas" not in m and "aov" not in m
    assert m["spend"] == 0 and m["orders"] == 0


def test_vtr_metrics_use_awareness_surface():
    m = metrics.metric_values("vtr", {
        "spend": 1_000_000, "impressions": 500_000, "reach": 250_000,
        "video_watched_6s": 100_000, "engaged_view_15s": 40_000,
    })
    assert m["vtr6s"] == pytest.approx(0.2)
    assert m["vtr15s"] == pytest.approx(0.08)
    assert m["cost_per_6s"] == pytest.approx(10.0)
    assert m["views_6s"] == 100_000


def test_change_names_direction_of_merit():
    # CPM up is "memburuk" (polarity −1); CTR up is "membaik" (polarity +1).
    cpm = metrics._change(12_000, 10_000, -1)
    assert "+20,0%" in cpm and "memburuk" in cpm
    ctr = metrics._change(0.03, 0.02, 1)
    assert "membaik" in ctr
    assert metrics._change(5, None, 1) == "tidak ada pembanding"


def test_money_formats_currency_and_small_values():
    assert metrics.money(8_563, "IDR") == "Rp8.563"
    assert metrics.money(8_562.83, "USD") == "8.562,83 USD"
    assert metrics.money(0.03, "USD") == "0,0300 USD"


# ─── ads_performance / campaign_breakdown output ─────────────────────────────


async def test_ads_performance_summarises_window_vs_prior():
    end = date(2026, 10, 10)
    cur = _rows(_window(end, 7))
    prior = _rows(_window(date(2026, 10, 3), 7), spend=50_000.0)  # half the spend
    data = FakeChatData(dates=_window(end, 30), rollup=cur + prior)
    ctx = ctx_for(data, shop_scope())
    out = await run_tool(ctx, "ads_performance", {"window_days": 7, "end_date": "2026-10-10"})
    assert out.ok
    assert "Belanja: Rp700.000" in out.output
    assert "ROAS: 5,00×" in out.output
    assert "GMV: Rp3.500.000" in out.output
    assert "membaik" in out.output or "memburuk" in out.output


async def test_ads_performance_excludes_adgroup_rows():
    end = date(2026, 10, 10)
    campaign = _rows(_window(end, 7))
    adgroup = _rows(_window(end, 7), adgroup="ag1", spend=999_999.0)  # must be ignored
    data = FakeChatData(dates=_window(end, 30), rollup=campaign + adgroup)
    ctx = ctx_for(data, shop_scope())
    out = await run_tool(ctx, "ads_performance", {"end_date": "2026-10-10"})
    assert "Rp700.000" in out.output and "999.999" not in out.output


async def test_ads_performance_new_client_has_no_comparison():
    end = date(2026, 10, 10)
    data = FakeChatData(dates=_window(end, 7), rollup=_rows(_window(end, 7)))
    ctx = ctx_for(data, shop_scope())
    out = await run_tool(ctx, "ads_performance", {"end_date": "2026-10-10"})
    assert "tidak ada pembanding" in out.output.lower() or "klien baru" in out.output.lower()


async def test_campaign_breakdown_shares_and_meta():
    end = date(2026, 10, 10)
    a = _rows(_window(end, 7), campaign="c1", cname="Kampanye A", spend=100_000.0)
    b = _rows(_window(end, 7), campaign="c2", cname="Kampanye B", spend=50_000.0)
    data = FakeChatData(
        dates=_window(end, 30), rollup=a + b,
        campaigns={"c1": ("product_sales", "ENABLE"), "c2": ("product_sales", "DISABLE")},
    )
    ctx = ctx_for(data, shop_scope())
    out = await run_tool(ctx, "campaign_breakdown", {"end_date": "2026-10-10", "sort_by": "spend"})
    assert "Kampanye A" in out.output and "Kampanye B" in out.output
    assert "product_sales/ENABLE" in out.output
    assert out.output.index("Kampanye A") < out.output.index("Kampanye B")  # sorted by spend desc


# ─── market_scope_insights parity with the report (BARDI) ────────────────────


@pytest.fixture(scope="module")
def bardi_frame() -> StrategyFrame:
    return StrategyFrame.model_validate_json(FIXTURE.read_text(encoding="utf-8"))


async def test_market_scope_matches_report_funnel_numbers(bardi_frame):
    data = FakeChatData(frame=bardi_frame)
    ctx = ctx_for(data, shop_scope("bardi", "BARDI"))
    out = await run_tool(ctx, "market_scope_insights", {"topics": ["funnel", "actions"]})
    assert out.ok
    assert "4,47%" in out.output and "15,68%" in out.output and "11,21 poin" in out.output
    assert "## Funnel dibanding kategori" in out.output
    assert "## Usulan tindakan" in out.output


async def test_market_scope_not_linked_is_honest():
    overview = ClientOverview(
        tier="standard", today=date(2026, 10, 10),
        paid=PaidCoverage(1, date(2026, 9, 1), date(2026, 10, 9), 38),
        ttms=TtmsLink(linked=False), last_reports=(), action_counts={},
    )
    data = FakeChatData(frame=None, overview_facts=overview)
    ctx = ctx_for(data, shop_scope())
    out = await run_tool(ctx, "market_scope_insights", {})
    assert "belum terhubung" in out.output.lower()


async def test_market_scope_short_history_is_honest():
    overview = ClientOverview(
        tier="standard", today=date(2026, 10, 10),
        paid=PaidCoverage(1, date(2026, 9, 1), date(2026, 10, 9), 38),
        ttms=TtmsLink(linked=True, brand_name="Baru", history_days=9, is_lite=True), last_reports=(), action_counts={},
    )
    data = FakeChatData(frame=None, overview_facts=overview)
    ctx = ctx_for(data, shop_scope())
    out = await run_tool(ctx, "market_scope_insights", {})
    assert "9 hari" in out.output and "14 hari" in out.output


# ─── Client resolution inside the workspace ─────────────────────────────────


def _two_clients() -> tuple[FakeChatData, ToolContext]:
    end = date(2026, 10, 10)
    acme = shop_scope("acme", "Acme")
    beta = shop_scope("beta-shop", "Beta Shop")
    data = FakeChatData(dates=_window(end, 30), rollup=_rows(_window(end, 7)), clients=[acme, beta])
    return data, ToolContext(workspace=ChatWorkspace(), data=data)


async def test_tool_reads_the_client_it_names():
    _, ctx = _two_clients()
    out = await run_tool(ctx, "ads_performance", {"client": "beta shop", "end_date": "2026-10-10"})
    assert out.ok and "Beta Shop" in out.output
    assert list(ctx.touched) == ["beta-shop"]


async def test_ambiguous_client_lists_candidates_not_a_guess():
    data, ctx = _two_clients()
    data.clients.append(shop_scope("acme-id", "Acme ID"))
    out = await run_tool(ctx, "ads_performance", {"client": "acm", "end_date": "2026-10-10"})
    assert "beberapa klien" in out.output and "slug: acme)" in out.output and "slug: acme-id)" in out.output
    assert "Belanja" not in out.output and not ctx.touched


async def test_exact_name_beats_substring():
    data, ctx = _two_clients()
    data.clients.append(shop_scope("acme-id", "Acme ID"))
    out = await run_tool(ctx, "ads_performance", {"client": "Acme", "end_date": "2026-10-10"})
    assert "Kinerja iklan Acme ·" in out.output


async def test_unknown_client_is_text():
    _, ctx = _two_clients()
    out = await run_tool(ctx, "client_overview", {"client": "Zebra"})
    assert "Tidak ada klien yang cocok" in out.output


async def test_missing_client_without_focus_asks_for_one():
    _, ctx = _two_clients()
    out = await run_tool(ctx, "ads_performance", {"end_date": "2026-10-10"})
    assert "Sebutkan klien" in out.output


async def test_other_agency_is_outside_the_workspace():
    end = date(2026, 10, 10)
    ours = shop_scope("acme", "Acme")
    theirs = ChatScope(client_slug="rival", tenant_id="t-rival", agency_id="ag-2", client_name="Rival",
                       north_star="shop", currency="IDR", timezone="UTC")
    rows = [_portfolio("acme", "Acme", 700_000.0), _portfolio("rival", "Rival", float(CANARY))]
    data = FakeChatData(clients=[ours, theirs], dates=_window(end, 30), rollup=_rows(_window(end, 7)),
                        portfolio_rows=rows, last_date=end)
    ctx = ToolContext(workspace=ChatWorkspace(agency_ids=("ag-1",)), data=data)
    out = await run_tool(ctx, "ads_performance", {"client": "rival", "end_date": "2026-10-10"})
    assert "Tidak ada klien yang cocok" in out.output
    port = await run_tool(ctx, "portfolio_overview", {"end_date": "2026-10-10"})
    assert "Rival" not in port.output and "55.555.555" not in port.output
    found = await run_tool(ctx, "find_clients", {"query": ""})
    assert "Rival" not in found.output and "Acme" in found.output


async def test_find_clients_lists_slugs():
    _, ctx = _two_clients()
    out = await run_tool(ctx, "find_clients", {"query": "beta"})
    assert out.ok and "Beta Shop (slug: beta-shop)" in out.output and "Acme" not in out.output


def test_per_client_tools_take_a_client_argument():
    workspace_tools = {"find_clients", "portfolio_overview"}
    for spec in tool_specs(ALL_TOOLS):
        props = set(spec["function"]["parameters"].get("properties") or {})
        if spec["function"]["name"] not in workspace_tools:
            assert "client" in props, spec["function"]["name"]


def test_allowed_tools_returns_all_in_c1():
    assert allowed_tools(Principal(), ChatWorkspace()) == ALL_TOOLS


def test_workspace_for_supports_only_super_admin():
    assert workspace_for(Principal(), "super_admin").agency_ids is None
    assert workspace_for(Principal(), None).scope == "super_admin"
    with pytest.raises(ValueError):
        workspace_for(Principal(), "agency_viewer")


# ─── portfolio_overview ──────────────────────────────────────────────────────


def _portfolio(slug: str, name: str, spend: float, *, gmv: float = 0.0, orders: int = 0,
               north_star: str = "shop", impressions: int = 100_000, clicks: int = 2_000) -> PortfolioRow:
    return PortfolioRow(slug=slug, name=name, north_star=north_star, currency="IDR", spend=spend,
                        impressions=impressions, clicks=clicks, conversions=orders, conversion_value=gmv,
                        reach=0, video_watched_6s=0, engaged_view_15s=0)


def _portfolio_ctx() -> ToolContext:
    cur_w = (date(2026, 10, 4), date(2026, 10, 10))
    prior_w = (date(2026, 9, 27), date(2026, 10, 3))
    data = FakeChatData(
        last_date=date(2026, 10, 10),
        portfolio_by_window={
            cur_w: [
                _portfolio("acme", "Acme", 1_000_000.0, gmv=5_000_000.0, orders=50),
                _portfolio("beta", "Beta", 3_000_000.0, gmv=6_000_000.0, orders=40),
                _portfolio("vee", "Vee", 500_000.0, north_star="vtr"),
            ],
            prior_w: [_portfolio("acme", "Acme", 500_000.0), _portfolio("beta", "Beta", 3_000_000.0)],
        },
    )
    data.clients = [shop_scope("acme", "Acme"), shop_scope("beta", "Beta"), shop_scope("vee", "Vee")]
    return ToolContext(workspace=ChatWorkspace(), data=data)


async def test_portfolio_totals_and_ranks_by_spend():
    out = await run_tool(_portfolio_ctx(), "portfolio_overview", {"end_date": "2026-10-10"})
    assert out.ok
    assert "3 dari 3 klien beriklan" in out.output
    assert "belanja Rp4.500.000" in out.output  # 1,0 + 3,0 + 0,5 jt
    assert "GMV Rp11.000.000" in out.output and "pesanan 90" in out.output
    assert out.output.index("Beta (slug: beta)") < out.output.index("Acme (slug: acme)")
    assert "+100,0% vs periode sebelumnya" in out.output  # Acme doubled
    assert "tidak ada pembanding" in out.output  # Vee had no prior window


async def test_portfolio_sorts_by_roas_and_filters_north_star():
    ctx = _portfolio_ctx()
    out = await run_tool(ctx, "portfolio_overview", {"end_date": "2026-10-10", "sort_by": "roas"})
    assert out.output.index("Acme (slug: acme)") < out.output.index("Beta (slug: beta)")  # 5× > 2×
    assert "Vee" not in out.output.split("Peringkat")[1]  # vtr has no ROAS
    only_vtr = await run_tool(ctx, "portfolio_overview", {"end_date": "2026-10-10", "north_star": "vtr"})
    assert "Vee" in only_vtr.output and "Acme" not in only_vtr.output


# ─── Bad tool calls come back as text ────────────────────────────────────────


async def test_unknown_tool_is_text_not_exception():
    ctx = ctx_for(FakeChatData(), shop_scope())
    out = await run_tool(ctx, "run_sql", {})
    assert not out.ok and "tidak dikenal" in out.output.lower()


async def test_out_of_range_argument_is_text():
    ctx = ctx_for(FakeChatData(dates=[], rollup=[]), shop_scope())
    out = await run_tool(ctx, "ads_performance", {"window_days": 999})
    assert not out.ok and "tidak valid" in out.output.lower()


# ─── Number gate (§9.1) ──────────────────────────────────────────────────────


def test_gate_passes_copied_and_rounded_numbers():
    tool = "Belanja: Rp700.000. CTR 2,47%."
    assert gate.check_reply("Belanja Rp700.000, CTR 2,5%.", tool_outputs=[tool], user_texts=[], prior_replies=[]) == []


def test_gate_flags_invented_number():
    orphans = gate.check_reply("GMV Rp999.999.999.", tool_outputs=["GMV: Rp3.500.000."], user_texts=[], prior_replies=[])
    assert orphans == ["999.999.999"]


def test_gate_allows_user_stated_target_and_years():
    out = gate.check_reply(
        "Target Anda 12.000.000 pada 2026 masih mungkin.",
        tool_outputs=["Belanja: Rp700.000."], user_texts=["Target saya 12.000.000."], prior_replies=[],
    )
    assert out == []


def test_gate_ignores_numbers_inside_reasoning():
    reply = gate.clean_reply("<think>maybe 123.456.789</think>GMV Rp3.500.000.")
    assert "123.456.789" not in reply
    assert gate.check_reply(reply, tool_outputs=["GMV: Rp3.500.000."], user_texts=[], prior_replies=[]) == []


def test_clean_reply_handles_eaten_opening_think_tag():
    assert gate.clean_reply("thinking out loud 9.9.9 </think>Jawaban: Rp700.000.").startswith("Jawaban")


# ─── The loop, against the real client + MockTransport ───────────────────────


def _mk_client(monkeypatch, handler) -> LmStudioClient:
    client = LmStudioClient(LmStudioConfig(model="qwen-test", base_url="http://local/v1", reasoning_effort="low"))
    shared = llm_client._LoopShared(
        semaphore=asyncio.Semaphore(1),
        http=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    monkeypatch.setattr(llm_client, "_shared", lambda config: shared)
    return client


def _assistant(message: dict) -> httpx.Response:
    finish = message.pop("finish_reason", "stop")
    return httpx.Response(200, json={"choices": [{"message": message, "finish_reason": finish}],
                                     "usage": {"prompt_tokens": 5, "completion_tokens": 5}})


def _tool_call(name: str, args: dict, cid: str = "c1") -> dict:
    return {"role": "assistant", "content": "",
            "tool_calls": [{"id": cid, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}


def _ctx_with_ads() -> ToolContext:
    end = date(2026, 10, 10)
    data = FakeChatData(dates=_window(end, 40), rollup=_rows(_window(end, 10)))
    return ctx_for(data)


async def test_loop_tool_then_verified_answer(monkeypatch):
    responses = [
        _tool_call("market_scope_insights", {}),  # fails gracefully (no frame) → text
        {"content": "Belanja minggu ini Rp700.000."},  # cites nothing unverifiable
    ]
    # Replace market_scope with ads so the tool yields a real number to cite.
    responses[0] = _tool_call("ads_performance", {"end_date": "2026-10-10"})

    def handler(request: httpx.Request) -> httpx.Response:
        return _assistant(dict(responses.pop(0)))

    ctx = _ctx_with_ads()
    client = _mk_client(monkeypatch, handler)
    res = await run_chat(client=client, ctx=ctx, allowed=ALL_TOOLS,
                         history=[{"role": "user", "content": "Bagaimana belanja minggu ini?"}])
    assert res.verified and res.unverified_numerals == []
    assert res.tool_calls and res.tool_calls[0]["name"] == "ads_performance"
    assert res.rounds == 2
    assert [c.client_slug for c in res.clients] == ["acme"]


async def test_loop_parses_inline_tool_call(monkeypatch):
    responses = [
        {"content": 'Sebentar <tool_call>{"name": "ads_performance", "arguments": {"end_date": "2026-10-10"}}</tool_call>'},
        {"content": "Belanja Rp700.000."},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return _assistant(dict(responses.pop(0)))

    res = await run_chat(client=_mk_client(monkeypatch, handler), ctx=_ctx_with_ads(), allowed=ALL_TOOLS,
                         history=[{"role": "user", "content": "belanja?"}])
    assert res.tool_calls and res.tool_calls[0]["name"] == "ads_performance"
    assert res.verified


async def test_loop_orphan_retries_once_then_verifies(monkeypatch):
    responses = [
        _tool_call("ads_performance", {"end_date": "2026-10-10"}),
        {"content": "GMV Rp41.000.000.000."},   # invented → orphan
        {"content": "GMV Rp3.500.000."},         # corrected
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return _assistant(dict(responses.pop(0)))

    res = await run_chat(client=_mk_client(monkeypatch, handler), ctx=_ctx_with_ads(), allowed=ALL_TOOLS,
                         history=[{"role": "user", "content": "berapa GMV?"}])
    assert res.gate_attempts == 1 and res.verified and res.unverified_numerals == []


async def test_loop_persistent_orphan_is_flagged(monkeypatch):
    responses = [
        _tool_call("ads_performance", {"end_date": "2026-10-10"}),
        {"content": "GMV Rp41.000.000.000."},
        {"content": "GMV Rp42.000.000.000."},  # still invented
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return _assistant(dict(responses.pop(0)))

    res = await run_chat(client=_mk_client(monkeypatch, handler), ctx=_ctx_with_ads(), allowed=ALL_TOOLS,
                         history=[{"role": "user", "content": "berapa GMV?"}])
    assert not res.verified and res.unverified_numerals == ["42.000.000.000"]


async def test_loop_cuts_off_endless_tool_calls(monkeypatch):
    from engine.chat.agent import _TOOLS_WITHDRAWN

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body["messages"][-1].get("content") == _TOOLS_WITHDRAWN:
            return _assistant({"content": "Maaf, saya jawab dengan data seadanya."})
        return _assistant(_tool_call("ads_performance", {"end_date": "2026-10-10"}))

    res = await run_chat(client=_mk_client(monkeypatch, handler), ctx=_ctx_with_ads(), allowed=ALL_TOOLS,
                         history=[{"role": "user", "content": "terus menerus"}])
    assert res.reply  # it terminated with an answer
    assert len([c for c in res.tool_calls]) <= 8


async def test_loop_requires_last_message_user(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:  # never called
        return _assistant({"content": "x"})

    with pytest.raises(ValueError, match="last message must be from the user"):
        await run_chat(client=_mk_client(monkeypatch, handler), ctx=_ctx_with_ads(), allowed=ALL_TOOLS,
                       history=[{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hai"}])
