"""The five C1 tools — the only way the model reads data (PRD §7).

Each tool is a pydantic argument model (`extra="ignore"`, so an injected
`client_slug` is dropped not obeyed, PRD R3), an async handler
`(ctx, args) -> str`, and a Bahasa description the model sees. Output is compact
Bahasa with every value formatted and every change labelled by metric polarity,
capped at 6,000 characters (§7.1). The model is never handed raw rows (R5).

The client is on `ctx.scope`, bound by the server; no tool argument names it.
Two Market Scope calls in one turn share one built frame (§7.1 per-turn cache).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from engine.chat import metrics
from engine.chat.data import ChatData, client_today
from engine.chat.scope import ChatScope
from engine.contracts import Finding
from engine.contracts.strategy import StrategyFrame
from engine.copy.strategy import deterministic_action_copy, dec, finding_sentence, num, pct
from engine.generators.strategy import STRATEGY_GENERATORS, T09TargetSolver

OUTPUT_CAP = 6000

NORTH_STAR_LABEL = {
    "shop": "GMV & penjualan (shop)",
    "vtr": "jangkauan & tontonan (VTR)",
    "app_install": "instalasi aplikasi (app install)",
}
ACTION_STATUS = {
    "proposed": "diusulkan",
    "running": "berjalan",
    "worked": "berhasil",
    "weak": "lemah",
    "failed": "gagal",
    "snoozed": "ditunda",
}
CONFIDENCE = {"high": "tinggi", "medium": "sedang", "low": "rendah"}
TOPIC_GENERATORS: dict[str, tuple[str, ...]] = {
    "coverage": ("T10",),
    "funnel": ("T01",),
    "spend_response": ("T02",),
    "goal": ("T03",),
    "content": ("T04",),
    "share_of_voice": ("T05",),
    "competitors": ("T06",),
    "warnings": ("T07", "T08"),
    "action_results": ("T11",),
}
TOPIC_TITLE: dict[str, str] = {
    "coverage": "Cakupan data",
    "funnel": "Funnel dibanding kategori",
    "spend_response": "Respons belanja",
    "goal": "Laju menuju target",
    "content": "Komposisi konten & efek tular",
    "share_of_voice": "Share of Voice & peringkat",
    "competitors": "Pergerakan pesaing",
    "warnings": "Peringatan dini",
    "action_results": "Hasil tindakan berjalan",
    "actions": "Usulan tindakan (angka target dari Target Solver)",
}
Topic = Literal[
    "coverage", "funnel", "spend_response", "goal", "content",
    "share_of_voice", "competitors", "warnings", "actions", "action_results",
]


@dataclass
class ToolContext:
    scope: ChatScope
    data: ChatData
    _frames: dict[tuple[int, str | None], StrategyFrame | None] = field(default_factory=dict)

    async def frame(self, window_days: int, end_date: date | None) -> StrategyFrame | None:
        key = (window_days, end_date.isoformat() if end_date else None)
        if key not in self._frames:
            self._frames[key] = await self.data.strategy_frame(
                self.scope, window_days=window_days, end_date=end_date
            )
        return self._frames[key]


# ─── Argument models ─────────────────────────────────────────────────────────


class _Args(BaseModel):
    model_config = ConfigDict(extra="ignore")


class ClientOverviewArgs(_Args):
    pass


class AdsPerformanceArgs(_Args):
    window_days: int = Field(default=7, ge=1, le=90)
    end_date: date | None = None
    include_daily: bool = False


SortBy = Literal["spend", "impressions", "clicks", "ctr", "conversions", "conversion_value", "roas", "cpa"]


class CampaignBreakdownArgs(_Args):
    window_days: int = Field(default=7, ge=1, le=90)
    end_date: date | None = None
    sort_by: SortBy = "spend"
    limit: int = Field(default=10, ge=1, le=20)


class MarketScopeArgs(_Args):
    topics: list[Topic] = Field(
        default_factory=lambda: ["funnel", "share_of_voice", "content", "actions"]
    )
    window_days: int = Field(default=28, ge=14, le=90)
    end_date: date | None = None


class StrategyActionLogArgs(_Args):
    limit: int = Field(default=8, ge=1, le=20)


# ─── Handlers ────────────────────────────────────────────────────────────────


async def _client_overview(ctx: ToolContext, args: ClientOverviewArgs) -> str:
    o = await ctx.data.overview(ctx.scope)
    s = ctx.scope
    lines = [
        f"Klien {s.client_name} · bintang utara {NORTH_STAR_LABEL.get(s.north_star, s.north_star)} "
        f"· tier {o.tier or '—'} · mata uang {s.currency} · zona {s.timezone} · hari ini {o.today}."
    ]
    if o.paid.days_with_data and o.paid.first_date and o.paid.last_date:
        lines.append(
            f"Iklan berbayar: {o.paid.ad_accounts} akun, data {o.paid.first_date} s.d. {o.paid.last_date} "
            f"({o.paid.days_with_data} hari ada data)."
        )
    else:
        lines.append("Iklan berbayar: belum ada data iklan untuk klien ini.")

    answerable = ["pertanyaan iklan berbayar"] if o.paid.days_with_data else []
    t = o.ttms
    if not t.linked:
        lines.append("TikTok Market Scope: tidak terhubung. Pertanyaan kategori/funnel/pesaing tidak tersedia.")
    else:
        plan = f"{t.plan or 'Lite'}" + (" (Lite)" if t.is_lite else "")
        lines.append(
            f"TikTok Market Scope: {t.brand_name} · kategori {t.vertical or '—'} · paket {plan} "
            f"· data TTMS terakhir {t.last_data_date} · {t.history_days} hari riwayat audiens."
        )
        if t.is_lite:
            lines.append("  Paket Lite: volume pencarian & sentimen membutuhkan paket Full.")
        if t.history_days >= 14:
            answerable += ["funnel vs kategori", "share of voice", "pesaing", "usulan tindakan Market Scope"]
        else:
            lines.append(f"  Riwayat audiens baru {t.history_days} hari; analisis funnel butuh ≥ 14 hari.")

    if o.last_reports:
        reports = "; ".join(
            f"{r.brief_type} ({r.status}{', ' + r.updated_at.date().isoformat() if r.updated_at else ''})"
            for r in o.last_reports
        )
        lines.append(f"Laporan engine terakhir: {reports}.")
    if o.action_counts:
        counts = ", ".join(f"{n} {ACTION_STATUS.get(st, st)}" for st, n in sorted(o.action_counts.items()))
        lines.append(f"Tindakan strategi: {counts}.")
    lines.append("Yang bisa dijawab untuk klien ini: " + (", ".join(answerable) or "belum ada data.") + ".")
    return "\n".join(lines)


async def _ads_performance(ctx: ToolContext, args: AdsPerformanceArgs) -> str:
    s = ctx.scope
    today = client_today(s.timezone)
    available = await ctx.data.available_dates(s)
    bounds = metrics.window_bounds(available, today, args.end_date, args.window_days)
    if bounds is None:
        return f"Belum ada data iklan berbayar untuk {s.client_name} pada periode yang diminta."
    cur_first, cur_last, prior_first, prior_last = bounds

    use_aw = s.north_star in metrics.USES_AWARENESS
    fetch = ctx.data.awareness_rollup if use_aw else ctx.data.paid_rollup
    cur_rows = [r for r in await fetch(s, cur_first, cur_last) if r.adgroup_id is None]
    prior_rows = [r for r in await fetch(s, prior_first, prior_last) if r.adgroup_id is None]
    if not cur_rows:
        return f"Tidak ada data iklan pada {cur_first} s.d. {cur_last} untuk {s.client_name}."

    cur = metrics.metric_values(s.north_star, metrics.sum_rows(s.north_star, cur_rows))
    prior = metrics.metric_values(s.north_star, metrics.sum_rows(s.north_star, prior_rows)) if prior_rows else {}
    days_in_window = len({r.day for r in cur_rows})

    head = (
        f"Kinerja iklan {s.client_name} · {cur_first} s.d. {cur_last} ({args.window_days} hari), "
        f"dibanding {prior_first} s.d. {prior_last}. {days_in_window} hari ada data. "
        "Belanja termasuk GMV Max. Jendela berakhir pada hari lengkap terakhir, bukan hari ini."
    )
    if not prior_rows:
        head += " Tidak ada periode pembanding (klien baru)."
    body = metrics.summarize(s.north_star, cur, prior, s.currency)

    out = [head, *body]
    if args.include_daily:
        out.append("Harian:")
        by_day: dict[date, list] = {}
        for r in cur_rows:
            by_day.setdefault(r.day, []).append(r)
        key = "views_6s" if use_aw else "orders" if s.north_star == "shop" else "installs" if s.north_star == "app_install" else "clicks"
        label = {"views_6s": "tontonan 6d", "orders": "pesanan", "installs": "instalasi", "clicks": "klik"}[key]
        for day in sorted(by_day):
            d = metrics.metric_values(s.north_star, metrics.sum_rows(s.north_star, by_day[day]))
            out.append(
                f"- {day}: belanja {metrics.money(d.get('spend'), s.currency)}, "
                f"impresi {num(d.get('impressions'))}, {label} {num(d.get(key))}"
            )
    return "\n".join(out)


async def _campaign_breakdown(ctx: ToolContext, args: CampaignBreakdownArgs) -> str:
    s = ctx.scope
    today = client_today(s.timezone)
    available = await ctx.data.available_dates(s)
    bounds = metrics.window_bounds(available, today, args.end_date, args.window_days)
    if bounds is None:
        return f"Belum ada data iklan berbayar untuk {s.client_name} pada periode yang diminta."
    cur_first, cur_last, prior_first, prior_last = bounds

    use_aw = s.north_star in metrics.USES_AWARENESS
    fetch = ctx.data.awareness_rollup if use_aw else ctx.data.paid_rollup
    cur_rows = [r for r in await fetch(s, cur_first, cur_last) if r.adgroup_id is None]
    prior_rows = [r for r in await fetch(s, prior_first, prior_last) if r.adgroup_id is None]
    if not cur_rows:
        return f"Tidak ada data kampanye pada {cur_first} s.d. {cur_last} untuk {s.client_name}."
    meta = await ctx.data.campaign_meta(s)

    by_c: dict[str, list] = {}
    names: dict[str, str] = {}
    for r in cur_rows:
        by_c.setdefault(r.campaign_id, []).append(r)
        names[r.campaign_id] = r.campaign_name
    prior_spend: dict[str, float] = {}
    for r in prior_rows:
        prior_spend[r.campaign_id] = prior_spend.get(r.campaign_id, 0.0) + r.spend

    per: dict[str, dict[str, float]] = {
        cid: metrics.metric_values(s.north_star, metrics.sum_rows(s.north_star, rows)) for cid, rows in by_c.items()
    }
    total_spend = sum(m.get("spend", 0.0) for m in per.values())

    sort_key = {"conversions": "orders", "conversion_value": "gmv", "cpa": "cost_per_order"}.get(args.sort_by, args.sort_by)
    ranked = sorted(per.items(), key=lambda kv: kv[1].get(sort_key, 0.0), reverse=True)[: args.limit]

    sec = [
        f"Rincian kampanye {s.client_name} · {cur_first} s.d. {cur_last} ({args.window_days} hari), "
        f"urut berdasarkan {args.sort_by}. Total belanja {metrics.money(total_spend, s.currency)}."
    ]
    extra = {"shop": ("orders", "gmv", "roas"), "app_install": ("installs", "cpi"), "vtr": ("vtr6s", "views_6s")}.get(
        s.north_star, ("orders", "gmv")
    )
    for cid, m in ranked:
        share = m.get("spend", 0.0) / total_spend if total_spend else 0.0
        ps = prior_spend.get(cid)
        if ps is None:
            chg = "baru periode ini"
        elif ps == 0:
            chg = "—"
        else:
            d = (m.get("spend", 0.0) - ps) / ps
            chg = f"{'+' if d >= 0 else '−'}{_pct1(abs(d))} belanja"
        obj, status = meta.get(cid, ("—", "—"))
        tail = ", ".join(f"{k.upper()} {_mval(m, k, s.currency)}" for k in extra if k in m)
        sec.append(
            f"- {names.get(cid, cid)}: belanja {metrics.money(m.get('spend'), s.currency)} "
            f"({_pct1(share)} dari total, {chg}), CTR {_mval(m, 'ctr', s.currency)}"
            + (f", {tail}" if tail else "")
            + f" · {obj}/{status}"
        )
    return "\n".join(sec)


async def _market_scope(ctx: ToolContext, args: MarketScopeArgs) -> str:
    s = ctx.scope
    frame = await ctx.frame(args.window_days, args.end_date)
    if frame is None:
        o = await ctx.data.overview(s)
        if not o.ttms.linked:
            return (
                f"{s.client_name} belum terhubung ke TikTok Market Scope, jadi data kategori, funnel dan "
                "pesaing tidak tersedia. Gunakan pertanyaan tentang iklan berbayar."
            )
        if o.ttms.history_days < 14:
            return (
                f"Riwayat audiens TTMS {s.client_name} baru {o.ttms.history_days} hari; analisis Market Scope "
                "membutuhkan minimal 14 hari."
            )
        return f"Data Market Scope belum tersedia untuk {s.client_name} pada periode ini."

    findings: list[Finding] = []
    for g in STRATEGY_GENERATORS:
        findings.extend(g.run(frame).findings)
    solver_res, actions = T09TargetSolver().run(frame, findings)
    findings.extend(solver_res.findings)
    by_id = {f.id: f for f in findings}
    cls = frame.classification.report_class

    plan = f"{frame.plan or 'Lite'}" + (" (Lite)" if frame.is_lite else "")
    out = [
        f"Market Scope {frame.brand_name} · kategori {frame.vertical or '—'} · paket {plan} · kelas laporan {cls} "
        f"· periode {frame.current_start} s.d. {frame.as_of} ({args.window_days} hari, data TTMS terakhir yang sudah "
        f"final) · pembanding: rata-rata {frame.benchmark.replace('top', 'Top ')} kategori."
    ]
    for topic in dict.fromkeys(args.topics):  # dedupe, keep order
        out.append(f"## {TOPIC_TITLE.get(topic, topic)}")
        if topic == "actions":
            acts = [a.model_copy(update={"copy_": deterministic_action_copy(a, by_id, frame.brand_name, cls)}) for a in actions]
            if not acts:
                out.append("- Tidak ada usulan tindakan untuk periode ini.")
            for a in acts:
                c = a.copy_
                assert c is not None
                out.append(
                    f"- {a.priority} · {c.langkah} Dasar: {c.dasar} Gagal jika: {c.gagal_jika} "
                    f"(keyakinan {CONFIDENCE.get(a.confidence, a.confidence)}, basis {a.basis})"
                )
            continue
        gens = TOPIC_GENERATORS.get(topic, ())
        rows = [f for f in findings if f.generator in gens]
        if topic == "competitors":
            rows = rows[:6]
        if not rows:
            out.append("- Tidak ada temuan yang cukup besar untuk periode ini.")
        for f in rows:
            out.append(f"- {finding_sentence(f, frame.brand_name)} (keyakinan {CONFIDENCE.get(f.confidence.value, f.confidence.value)})")
    return "\n".join(out)


async def _strategy_action_log(ctx: ToolContext, args: StrategyActionLogArgs) -> str:
    rows = await ctx.data.action_log(ctx.scope, args.limit)
    if not rows:
        return f"Belum ada tindakan strategi yang tercatat untuk {ctx.scope.client_name}."
    out = [f"Log tindakan strategi {ctx.scope.client_name} (terbaru dulu):"]
    for r in rows:
        when = r.started_at or r.proposed_at
        measured = f" · terukur {dec(r.measured_value, 2)}" if r.measured_value is not None else ""
        out.append(
            f"- [{ACTION_STATUS.get(r.status, r.status)}] {r.langkah or '(tindakan)'}"
            + (f" · sejak {when}" if when else "")
            + measured
        )
    return "\n".join(out)


def _pct1(ratio: float) -> str:
    return pct(ratio, 1)


def _mval(m: dict[str, float], key: str, currency: str) -> str:
    if key not in m:
        return "—"
    v = m[key]
    if key in ("gmv", "cpi"):
        return metrics.money(v, currency)
    if key in ("ctr", "vtr6s"):
        return pct(v)
    if key == "roas":
        return f"{dec(v, 2)}×"
    return num(v)  # orders, installs, views_6s


# ─── Registry ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    args_model: type[BaseModel]
    handler: Callable[[ToolContext, BaseModel], Awaitable[str]]


@dataclass(frozen=True)
class ToolResult:
    name: str
    args: dict
    ok: bool
    output: str


TOOLS: dict[str, Tool] = {
    "client_overview": Tool(
        "client_overview",
        "Ringkasan apa yang tersedia untuk klien ini: bintang utara, tier, mata uang, zona waktu, cakupan "
        "data iklan, status tautan TikTok Market Scope (merek, kategori, paket, hari riwayat), laporan "
        "terakhir, dan jumlah tindakan strategi. Panggil ini lebih dulu bila belum yakin data apa yang ada.",
        ClientOverviewArgs,
        _client_overview,  # type: ignore[arg-type]
    ),
    "ads_performance": Tool(
        "ads_performance",
        "Kinerja iklan berbayar pada satu jendela dibanding jendela sebelumnya yang sama panjang: belanja, "
        "impresi, klik, CTR, CPM, CPC, plus metrik bintang utara (shop: pesanan, GMV, ROAS, biaya/pesanan, "
        "CVR, AOV; vtr: VTR 6d/15d, jangkauan; app_install: instalasi, CPI). Argumen: window_days (1–90, "
        "default 7), end_date opsional, include_daily untuk rincian harian.",
        AdsPerformanceArgs,
        _ads_performance,  # type: ignore[arg-type]
    ),
    "campaign_breakdown": Tool(
        "campaign_breakdown",
        "Rincian per kampanye pada satu jendela: belanja, porsi dari total, perubahan belanja vs periode "
        "sebelumnya, CTR, dua–tiga metrik bintang utara, objective dan status. Argumen: window_days, "
        "end_date, sort_by (spend/impressions/clicks/ctr/conversions/conversion_value/roas/cpa), limit (1–20).",
        CampaignBreakdownArgs,
        _campaign_breakdown,  # type: ignore[arg-type]
    ),
    "market_scope_insights": Tool(
        "market_scope_insights",
        "Analisis TikTok Market Scope untuk klien yang terhubung: funnel vs kategori, respons belanja, laju "
        "target, komposisi konten, share of voice, pesaing, peringatan, hasil tindakan, dan usulan tindakan "
        "bertarget (Target Solver). Argumen: topics (subset dari coverage/funnel/spend_response/goal/content/"
        "share_of_voice/competitors/warnings/actions/action_results), window_days (14–90, default 28), end_date.",
        MarketScopeArgs,
        _market_scope,  # type: ignore[arg-type]
    ),
    "strategy_action_log": Tool(
        "strategy_action_log",
        "Tindakan strategi yang diusulkan, berjalan, dan sudah dinilai (berhasil/lemah/gagal/ditunda), "
        "terbaru dulu, dengan langkah, status, tanggal dan nilai terukur. Argumen: limit (1–20, default 8).",
        StrategyActionLogArgs,
        _strategy_action_log,  # type: ignore[arg-type]
    ),
}


def tool_specs(allowed: tuple[str, ...]) -> list[dict]:
    """OpenAI-style function specs for the tools this turn may use."""
    specs: list[dict] = []
    for name in allowed:
        tool = TOOLS[name]
        schema = tool.args_model.model_json_schema()
        schema.pop("title", None)
        specs.append(
            {"type": "function", "function": {"name": name, "description": tool.description, "parameters": schema}}
        )
    return specs


async def run_tool(ctx: ToolContext, name: str, raw_args: dict | None) -> ToolResult:
    """Validate and run one tool. Any failure — unknown tool, bad argument,
    query error — comes back as text for the model, never as an exception that
    ends the turn (PRD §7.1)."""
    raw_args = raw_args or {}
    tool = TOOLS.get(name)
    if tool is None:
        return ToolResult(name, raw_args, False, f"Alat tidak dikenal: {name}. Pilih dari: {', '.join(TOOLS)}.")
    try:
        args = tool.args_model.model_validate(raw_args)
    except ValidationError as exc:
        msgs = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors())
        return ToolResult(name, raw_args, False, f"Argumen tidak valid untuk {name}: {msgs}")
    try:
        output = await tool.handler(ctx, args)
    except Exception as exc:  # noqa: BLE001 - surfaced to the model, logged by the caller
        return ToolResult(name, raw_args, False, f"Alat {name} gagal: {type(exc).__name__}: {exc}"[:OUTPUT_CAP])
    return ToolResult(name, raw_args, True, output[:OUTPUT_CAP])
