"""Tanya Tempo's tools — the only way the model reads data (PRD §7).

Each tool is a pydantic argument model (`extra="ignore"`), an async handler
`(ctx, args) -> str`, and a Bahasa description the model sees. Output is compact
Bahasa with every value formatted and every change labelled by metric polarity,
capped at 6,000 characters (§7.1). The model is never handed raw rows (R5).

The chat is general: two workspace tools (`find_clients`, `portfolio_overview`)
span every client the workspace allows, and the per-client tools take a
`client` argument (name or slug) that the server resolves *inside the
workspace* (`ToolContext.client`). An ambiguous or unknown name returns the
candidates as text, never a guess. Two Market Scope calls for the same client
in one turn share one built frame (§7.1 per-turn cache).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from engine.chat import improve, metrics
from engine.chat import reports as reports_mod
from engine.chat.data import ChatData, ClientMatch, PortfolioRow, SavedReport, client_today
from engine.chat.reports import ReportRef, ReportRunner
from engine.chat.scope import ChatScope, ChatWorkspace
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


def is_brand_heavy(scope: ChatScope, report_class: str | None = None) -> bool:
    """A client that does not sell through TikTok Shop: a non-shop north star
    (vtr / app_install), or a Strategy Report classified as brand class."""
    return scope.north_star != "shop" or report_class == "brand"


def no_shop_note(scope: ChatScope, report_class: str | None = None) -> str:
    """The sentence every tool appends for a brand-heavy client, so the model
    never turns a Conversion gap into TikTok Shop advice."""
    if not is_brand_heavy(scope, report_class):
        return ""
    return (
        f" {scope.client_name} adalah klien brand-heavy yang tidak berjualan lewat TikTok Shop: jangan menyarankan "
        "membuka/mengaktifkan TikTok Shop, kartu produk, etalase, checkout, atau mendorong tahap Conversion."
    )


@dataclass
class ToolContext:
    workspace: ChatWorkspace
    data: ChatData
    #: Clients this turn resolved, in order — logged with the turn.
    touched: dict[str, ChatScope] = field(default_factory=dict)
    #: Runs the report pipeline when `client_report` finds no fresh report.
    #: `None` (tests, or a context without an engine) = reuse only, never generate.
    runner: ReportRunner | None = None
    #: Reports this turn reused or generated — the web app links their HTML.
    reports: list[ReportRef] = field(default_factory=list)
    _resolved: dict[str, ChatScope | str] = field(default_factory=dict)
    _frames: dict[tuple[str, int, str | None], StrategyFrame | None] = field(default_factory=dict)

    async def client(self, ref: str | None) -> ChatScope | str:
        """Resolve the model's `client` argument inside the workspace. A
        `ChatScope` on one match; otherwise Bahasa text listing the candidates
        (or saying there are none) for the model to act on."""
        ref = (ref or "").strip() or (self.workspace.focus_slug or "")
        if not ref:
            return (
                "Sebutkan klien yang dimaksud lewat argumen client (nama atau slug). "
                "Gunakan find_clients untuk mencari nama yang tepat."
            )
        if ref not in self._resolved:
            got = await self.data.resolve_client(self.workspace, ref)
            if isinstance(got, ChatScope):
                self._resolved[ref] = got
            elif got:
                self._resolved[ref] = (
                    f"Nama klien \"{ref}\" cocok dengan beberapa klien. Pilih salah satu slug di bawah dan panggil "
                    "alat lagi, atau tanyakan ke pengguna klien mana yang dimaksud:\n"
                    + "\n".join(_match_line(m) for m in got)
                )
            else:
                self._resolved[ref] = (
                    f"Tidak ada klien yang cocok dengan \"{ref}\". Gunakan find_clients dengan kata kunci yang "
                    "lebih pendek untuk mencari namanya."
                )
        res = self._resolved[ref]
        if isinstance(res, ChatScope):
            self.touched.setdefault(res.client_slug, res)
        return res

    async def frame(self, scope: ChatScope, window_days: int, end_date: date | None) -> StrategyFrame | None:
        key = (scope.client_slug, window_days, end_date.isoformat() if end_date else None)
        if key not in self._frames:
            self._frames[key] = await self.data.strategy_frame(
                scope, window_days=window_days, end_date=end_date
            )
        return self._frames[key]


def _match_line(m: ClientMatch) -> str:
    data = f"data iklan s.d. {m.last_date}" if m.last_date else "belum ada data iklan"
    ttms = " · TTMS terhubung" if m.ttms_linked else ""
    return f"- {m.name} (slug: {m.slug}) · bintang utara {NORTH_STAR_LABEL.get(m.north_star, m.north_star)} · {data}{ttms}"


# ─── Argument models ─────────────────────────────────────────────────────────


class _Args(BaseModel):
    model_config = ConfigDict(extra="ignore")


class _ClientArgs(_Args):
    client: str | None = Field(
        default=None,
        max_length=200,
        description="Nama atau slug klien, mis. \"Cimory\" atau \"cimory\". Wajib kecuali pengguna sedang membuka satu klien.",
    )


class FindClientsArgs(_Args):
    query: str = Field(default="", max_length=200, description="Kata kunci nama/slug klien; kosong = semua klien.")
    limit: int = Field(default=10, ge=1, le=25)


PortfolioSort = Literal["spend", "gmv", "orders", "roas", "impressions", "clicks", "ctr", "installs", "views_6s"]


class PortfolioArgs(_Args):
    window_days: int = Field(default=7, ge=1, le=90)
    end_date: date | None = None
    sort_by: PortfolioSort = "spend"
    limit: int = Field(default=10, ge=1, le=25)
    north_star: Literal["shop", "vtr", "app_install"] | None = None


class ClientOverviewArgs(_ClientArgs):
    pass


class ClientReportArgs(_ClientArgs):
    refresh: bool = Field(
        default=False,
        description="true hanya bila pengguna meminta laporan baru walau ada laporan ≤ 24 jam.",
    )


class ImprovementArgs(_ClientArgs):
    window_days: int = Field(default=7, ge=7, le=90)
    end_date: date | None = None
    limit: int = Field(default=6, ge=1, le=10)


class AdsPerformanceArgs(_ClientArgs):
    window_days: int = Field(default=7, ge=1, le=90)
    end_date: date | None = None
    include_daily: bool = False


SortBy = Literal["spend", "impressions", "clicks", "ctr", "conversions", "conversion_value", "roas", "cpa"]


class CampaignBreakdownArgs(_ClientArgs):
    window_days: int = Field(default=7, ge=1, le=90)
    end_date: date | None = None
    sort_by: SortBy = "spend"
    limit: int = Field(default=10, ge=1, le=20)


class MarketScopeArgs(_ClientArgs):
    topics: list[Topic] = Field(
        default_factory=lambda: ["funnel", "share_of_voice", "content", "actions"]
    )
    window_days: int = Field(default=28, ge=14, le=90)
    end_date: date | None = None


class StrategyActionLogArgs(_ClientArgs):
    limit: int = Field(default=8, ge=1, le=20)


# ─── Handlers ────────────────────────────────────────────────────────────────


async def _client_overview(ctx: ToolContext, args: ClientOverviewArgs) -> str:
    s = await ctx.client(args.client)
    if isinstance(s, str):
        return s
    o = await ctx.data.overview(s)
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
    if no_shop_note(s):
        lines.append(no_shop_note(s).strip())

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
    s = await ctx.client(args.client)
    if isinstance(s, str):
        return s
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
    s = await ctx.client(args.client)
    if isinstance(s, str):
        return s
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
    s = await ctx.client(args.client)
    if isinstance(s, str):
        return s
    frame = await ctx.frame(s, args.window_days, args.end_date)
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
        + no_shop_note(s, cls)
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
    s = await ctx.client(args.client)
    if isinstance(s, str):
        return s
    rows = await ctx.data.action_log(s, args.limit)
    if not rows:
        return f"Belum ada tindakan strategi yang tercatat untuk {s.client_name}."
    out = [f"Log tindakan strategi {s.client_name} (terbaru dulu):"]
    for r in rows:
        when = r.started_at or r.proposed_at
        measured = f" · terukur {dec(r.measured_value, 2)}" if r.measured_value is not None else ""
        out.append(
            f"- [{ACTION_STATUS.get(r.status, r.status)}] {r.langkah or '(tindakan)'}"
            + (f" · sejak {when}" if when else "")
            + measured
        )
    return "\n".join(out)


async def _report_kinds(ctx: ToolContext, s: ChatScope) -> list[tuple[str, int]]:
    """Which report this client gets, best first: the Strategy Report when it
    has a TTMS link with ≥ 14 days of audience, then its objective brief."""
    kinds: list[tuple[str, int]] = []
    try:
        o = await ctx.data.overview(s)
        if o.ttms.linked and o.ttms.history_days >= 14:
            kinds.append(("strategy", reports_mod.STRATEGY_WINDOW_DAYS))
    except Exception:  # noqa: BLE001 - eligibility probe only; the brief still works
        pass
    brief = improve.BRIEF_FOR_NORTH_STAR.get(s.north_star)
    if brief:
        kinds.append((brief, reports_mod.BRIEF_WINDOW_DAYS))
    return kinds


async def _client_report(ctx: ToolContext, args: ClientReportArgs) -> str:
    s = await ctx.client(args.client)
    if isinstance(s, str):
        return s
    kinds = await _report_kinds(ctx, s)
    if not kinds:
        return f"Laporan belum tersedia untuk bintang utara {s.north_star} ({s.client_name})."

    report: SavedReport | None = None
    kind, window, cached, duration = kinds[0][0], kinds[0][1], True, None
    # 1. Cache: a report of the preferred kind approved within 24 hours.
    if not args.refresh:
        for k, w in kinds[:1]:
            fresh = [
                r for r in await ctx.data.saved_reports(s, k, 1)
                if reports_mod.is_fresh(r) and reports_mod.is_current(r)
            ]
            if fresh:
                report, kind, window = fresh[0], k, w
    # 2. Otherwise generate it (falling back to the brief if the strategy frame refuses).
    if report is None:
        if ctx.runner is None:
            return f"Tidak ada laporan {s.client_name} dalam 24 jam terakhir, dan pembuatan laporan tidak tersedia di sini."
        tier = reports_mod.generation_tier()
        reasons: list[str] = []
        for k, w in kinds:
            started = reports_mod.timed()
            try:
                report = await ctx.runner.generate(s.client_slug, k, window_days=w, tier=tier)
            except reports_mod.NotEligible as exc:
                reasons.append(str(exc))
                continue
            kind, window, cached = k, w, False
            duration = round(reports_mod.timed() - started, 1)
            break
        if report is None:
            return f"Laporan {s.client_name} tidak bisa dibuat: {'; '.join(reasons) or 'data tidak cukup'}."

    ctx.reports.append(
        ReportRef(
            slug=s.client_slug, client_name=s.client_name, brief_type=kind, run_id=report.run_id,
            tier=str(report.content.get("tier") or report.tier or "—"), cached=cached,
            generated_at=report.updated_at, window_days=window, duration_s=duration,
        )
    )
    label = improve.BRIEF_LABEL.get(kind, kind)
    if cached:
        age = reports_mod.age_hours(report)
        source = f"diambil dari cache — laporan ini dibuat {age:.0f} jam lalu, jadi tidak dibuat ulang" if age is not None else "diambil dari cache"
    else:
        source = f"baru dibuat sekarang oleh pipeline laporan (tier {report.content.get('tier') or report.tier}, {duration} dtk)"
    note = ""
    if kind != "strategy" and kinds[0][0] != "strategy":
        note = f" {s.client_name} tidak terhubung ke TikTok Market Scope, jadi laporannya adalah {label}, bukan Strategy Report."
    report_class = (report.content.get("report_class") or {}).get("report_class")
    note += no_shop_note(s, report_class)
    head = (
        f"Laporan untuk {s.client_name}: {label}, {source}.{note} Laporan lengkap (HTML) ditampilkan sebagai "
        "tautan di bawah jawaban — sebutkan itu, jangan menulis URL. Ringkas laporan di bawah ini."
    )
    today = client_today(s.timezone).isoformat()
    return head + "\n\n" + improve.format_saved_report(report, s.client_name, today)


async def _improvement_diagnostics(ctx: ToolContext, args: ImprovementArgs) -> str:
    s = await ctx.client(args.client)
    if isinstance(s, str):
        return s
    brief_type = improve.BRIEF_FOR_NORTH_STAR.get(s.north_star)
    if brief_type is None:
        return f"Diagnostik perbaikan belum tersedia untuk bintang utara {s.north_star} ({s.client_name})."
    frame = await ctx.data.metric_frame(s, brief_type, window_days=args.window_days, end_date=args.end_date)
    if frame is None:
        return f"Belum ada data iklan yang cukup untuk diagnostik {s.client_name} pada periode yang diminta."
    d = improve.run_diagnostics(frame, brief_type)
    return improve.format_diagnostics(d, s.client_name, frame, args.limit) + no_shop_note(s)


async def _find_clients(ctx: ToolContext, args: FindClientsArgs) -> str:
    total = await ctx.data.client_count(ctx.workspace)
    rows = await ctx.data.find_clients(ctx.workspace, args.query, args.limit)
    if not rows:
        return (
            f"Tidak ada klien yang cocok dengan \"{args.query}\" di antara {num(total)} klien. "
            "Coba kata kunci yang lebih pendek."
        )
    head = (
        f"Klien yang cocok dengan \"{args.query}\"" if args.query.strip() else "Daftar klien (urut nama)"
    ) + f": {len(rows)} ditampilkan dari {num(total)} klien di database."
    return "\n".join([head, *(_match_line(m) for m in rows)])


_PORTFOLIO_KEY = {"orders": "orders", "gmv": "gmv", "roas": "roas", "installs": "installs", "views_6s": "views_6s"}


def _portfolio_metrics(r: PortfolioRow) -> dict[str, float]:
    if r.north_star in metrics.USES_AWARENESS:
        sums = {
            "spend": r.spend, "impressions": r.impressions, "reach": r.reach,
            "video_watched_6s": r.video_watched_6s, "engaged_view_15s": r.engaged_view_15s,
        }
    else:
        sums = {
            "spend": r.spend, "impressions": r.impressions, "clicks": r.clicks,
            "conversions": r.conversions, "conversion_value": r.conversion_value,
        }
    m = metrics.metric_values(r.north_star, sums)
    if r.north_star == "shop" and not r.conversion_value:
        for k in ("gmv", "roas", "roi", "aov"):
            m.pop(k, None)
    m.setdefault("impressions", float(r.impressions))
    m.setdefault("clicks", float(r.clicks))
    if "ctr" not in m and r.impressions:
        m["ctr"] = r.clicks / r.impressions
    return m


async def _portfolio_overview(ctx: ToolContext, args: PortfolioArgs) -> str:
    ws = ctx.workspace
    last = await ctx.data.portfolio_last_date(ws)
    if last is None:
        return "Belum ada data iklan berbayar di database."
    today = client_today(ws.timezone)
    ceiling = args.end_date or (today - timedelta(days=1))
    cur_last = min(last, ceiling)
    cur_first = cur_last - timedelta(days=args.window_days - 1)
    prior_last = cur_first - timedelta(days=1)
    prior_first = prior_last - timedelta(days=args.window_days - 1)

    cur = await ctx.data.portfolio(ws, cur_first, cur_last)
    prior = {r.slug: r for r in await ctx.data.portfolio(ws, prior_first, prior_last)}
    if args.north_star:
        cur = [r for r in cur if r.north_star == args.north_star]
    cur = [r for r in cur if r.spend > 0 or r.impressions > 0]
    if not cur:
        return f"Tidak ada klien dengan aktivitas iklan pada {cur_first} s.d. {cur_last}."

    total_clients = await ctx.data.client_count(ws)
    scope_note = f" (hanya bintang utara {NORTH_STAR_LABEL.get(args.north_star, args.north_star)})" if args.north_star else ""
    out = [
        f"Portofolio iklan semua klien{scope_note} · {cur_first} s.d. {cur_last} ({args.window_days} hari), "
        f"dibanding {prior_first} s.d. {prior_last}. {len(cur)} dari {num(total_clients)} klien beriklan. "
        "Hanya baris tingkat kampanye; belanja termasuk GMV Max. Jendela berakhir pada hari lengkap terakhir."
    ]

    by_ccy: dict[str, list[PortfolioRow]] = {}
    for r in cur:
        by_ccy.setdefault(r.currency, []).append(r)
    for ccy, rows in sorted(by_ccy.items()):
        spend = sum(r.spend for r in rows)
        prior_spend = sum(prior[r.slug].spend for r in rows if r.slug in prior)
        impressions = sum(r.impressions for r in rows)
        clicks = sum(r.clicks for r in rows)
        shop = [r for r in rows if r.north_star == "shop"]
        line = (
            f"Total ({ccy}, {len(rows)} klien): belanja {metrics.money(spend, ccy)} "
            f"({metrics._change(spend, prior_spend if prior_spend else None, 0)}), impresi {num(impressions)}, "
            f"klik {num(clicks)}"
        )
        if impressions:
            line += f", CTR {pct(clicks / impressions)}"
        if shop:
            gmv = sum(r.conversion_value for r in shop)
            shop_spend = sum(r.spend for r in shop)
            line += f"; klien shop: pesanan {num(sum(r.conversions for r in shop))}, GMV {metrics.money(gmv, ccy)}"
            if shop_spend:
                line += f", ROAS {dec(gmv / shop_spend, 2)}×"
        out.append(line + ".")

    per = [(r, _portfolio_metrics(r)) for r in cur]
    key = _PORTFOLIO_KEY.get(args.sort_by, args.sort_by)
    if args.sort_by != "spend":
        per = [x for x in per if key in x[1]]
    per.sort(key=lambda x: x[1].get(key, 0.0), reverse=True)
    out.append(f"Peringkat klien berdasarkan {args.sort_by} (teratas {min(args.limit, len(per))}):")
    spend_by_ccy = {ccy: sum(r.spend for r in rows) for ccy, rows in by_ccy.items()}
    for rank, (r, m) in enumerate(per[: args.limit], start=1):
        tot = spend_by_ccy.get(r.currency) or 0.0
        share = f", {_pct1(r.spend / tot)} dari total" if tot else ""
        p = prior.get(r.slug)
        chg = metrics._change(r.spend, p.spend if p else None, 0)
        extra = {"shop": ("orders", "gmv", "roas"), "app_install": ("installs", "cpi"), "vtr": ("vtr6s", "views_6s")}.get(
            r.north_star, ("orders", "gmv")
        )
        tail = ", ".join(f"{k.upper()} {_mval(m, k, r.currency)}" for k in extra if k in m)
        if r.north_star == "shop" and not r.conversion_value:
            # No GMV booked (e.g. no shop attribution): a 0,00× ROAS would read as a result.
            tail = (tail + ", " if tail else "") + "GMV belum tercatat (ROAS tidak bisa dihitung)"
        out.append(
            f"{rank}. {r.name} (slug: {r.slug}) · belanja {metrics.money(r.spend, r.currency)}{share} ({chg})"
            f", CTR {_mval(m, 'ctr', r.currency)}" + (f", {tail}" if tail else "")
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
    "find_clients": Tool(
        "find_clients",
        "Cari klien di database iklan berdasarkan nama atau slug: nama, slug, bintang utara, tanggal data "
        "iklan terakhir, dan apakah terhubung ke TikTok Market Scope. Argumen: query (kosong = semua, urut "
        "nama), limit (1–25, default 10). Pakai ini bila nama klien dari pengguna tidak persis.",
        FindClientsArgs,
        _find_clients,  # type: ignore[arg-type]
    ),
    "portfolio_overview": Tool(
        "portfolio_overview",
        "Gambaran lintas SEMUA klien pada satu jendela dibanding jendela sebelumnya: total belanja, impresi, "
        "klik, CTR, pesanan/GMV/ROAS klien shop, dan peringkat klien. Untuk pertanyaan seperti \"klien mana "
        "yang belanja paling besar\", \"ROAS tertinggi minggu ini\", atau total portofolio. Argumen: "
        "window_days (1–90, default 7), end_date, sort_by (spend/gmv/orders/roas/impressions/clicks/ctr/"
        "installs/views_6s), limit (1–25), north_star opsional (shop/vtr/app_install).",
        PortfolioArgs,
        _portfolio_overview,  # type: ignore[arg-type]
    ),
    "client_report": Tool(
        "client_report",
        "Laporan strategi satu klien (argumen client): Strategy Report bila klien terhubung ke TikTok Market "
        "Scope, selain itu GMV/Awareness/Install Brief sesuai bintang utaranya. Bila laporan sudah dibuat dalam "
        "24 jam terakhir, laporan itu dipakai (cache); bila belum, laporan baru dibuat oleh agen laporan (±1 "
        "menit). Mengembalikan isi laporan — temuan, rencana tindakan, risiko — dan tautan HTML-nya tampil di "
        "bawah jawaban. Panggil PERTAMA untuk pertanyaan strategi/perbaikan/langkah berikutnya atau permintaan "
        "laporan. Argumen: refresh (true hanya bila pengguna minta laporan baru).",
        ClientReportArgs,
        _client_report,  # type: ignore[arg-type]
    ),
    "improvement_diagnostics": Tool(
        "improvement_diagnostics",
        "Diagnostik perbaikan langsung untuk satu klien (argumen client), memakai generator brief yang sama "
        "dengan laporan (efisiensi kampanye, konsentrasi, nol hasil, respons marginal, kontras segmen, dsb.), "
        "diurutkan menurut materialitas, masing-masing dengan bukti angka dan tindakan dari templat brief. "
        "Berlaku untuk semua klien yang punya data iklan. Argumen: window_days (7–90, default 7), end_date, "
        "limit (1–10, default 6).",
        ImprovementArgs,
        _improvement_diagnostics,  # type: ignore[arg-type]
    ),
    "client_overview": Tool(
        "client_overview",
        "Ringkasan apa yang tersedia untuk satu klien (argumen client): bintang utara, tier, mata uang, zona "
        "waktu, cakupan data iklan, status tautan TikTok Market Scope (merek, kategori, paket, hari riwayat), "
        "laporan terakhir, dan jumlah tindakan strategi.",
        ClientOverviewArgs,
        _client_overview,  # type: ignore[arg-type]
    ),
    "ads_performance": Tool(
        "ads_performance",
        "Kinerja iklan berbayar satu klien (argumen client) pada satu jendela dibanding jendela sebelumnya: belanja, "
        "impresi, klik, CTR, CPM, CPC, plus metrik bintang utara (shop: pesanan, GMV, ROAS, biaya/pesanan, "
        "CVR, AOV; vtr: VTR 6d/15d, jangkauan; app_install: instalasi, CPI). Argumen: window_days (1–90, "
        "default 7), end_date opsional, include_daily untuk rincian harian.",
        AdsPerformanceArgs,
        _ads_performance,  # type: ignore[arg-type]
    ),
    "campaign_breakdown": Tool(
        "campaign_breakdown",
        "Rincian per kampanye satu klien (argumen client): belanja, porsi dari total, perubahan belanja vs periode "
        "sebelumnya, CTR, dua–tiga metrik bintang utara, objective dan status. Argumen: window_days, "
        "end_date, sort_by (spend/impressions/clicks/ctr/conversions/conversion_value/roas/cpa), limit (1–20).",
        CampaignBreakdownArgs,
        _campaign_breakdown,  # type: ignore[arg-type]
    ),
    "market_scope_insights": Tool(
        "market_scope_insights",
        "Analisis TikTok Market Scope untuk satu klien yang terhubung (argumen client): funnel vs kategori, respons belanja, laju "
        "target, komposisi konten, share of voice, pesaing, peringatan, hasil tindakan, dan usulan tindakan "
        "bertarget (Target Solver). Argumen: topics (subset dari coverage/funnel/spend_response/goal/content/"
        "share_of_voice/competitors/warnings/actions/action_results), window_days (14–90, default 28), end_date.",
        MarketScopeArgs,
        _market_scope,  # type: ignore[arg-type]
    ),
    "strategy_action_log": Tool(
        "strategy_action_log",
        "Tindakan strategi satu klien (argumen client) yang diusulkan, berjalan, dan sudah dinilai (berhasil/lemah/gagal/ditunda), "
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
