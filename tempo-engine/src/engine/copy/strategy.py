"""Strategy Report copy — the instant tier's whole prose layer and the full
tier's fallback (Strategy Report PRD §7.6, Appendix D).

Bahasa Indonesia, zero model calls. Every numeral is formatted from a value in
the finding's own `evidence` (or the Target Solver's `ActionItem`), never
recomputed, so this text passes the numeral gate by construction. Formatting is
Indonesian: `.` groups thousands, `,` is the decimal mark.

Wording rules carried from P0 (`docs/phases/strategy-report/P0_DISCOVERY.md`):
a stage *size ratio* is never described as people moving on ("pindah",
"lanjut", "berpindah"), and spend/outcome links say "selaras"/"bersamaan",
never "menyebabkan".
"""

from __future__ import annotations

from engine.contracts import ClaimFrame, Finding
from engine.contracts.strategy import (
    ActionCopy,
    ActionItem,
    ReportClass,
    Signal,
    StrategyFrame,
    StrategyParagraph,
    StrategySectionDraft,
    StrategySectionId,
    VerdictChip,
    VerdictDraft,
)

T = StrategySectionId
CF = ClaimFrame

STAGE = {"acc": "ACC", "awareness": "Awareness", "consideration": "Consideration", "conversion": "Conversion"}
METRIC = {
    "impressions": "impresi",
    "engagements": "interaksi",
    "video_views_6s": "tontonan 6 detik",
    "video_views_p100": "tontonan penuh",
    "search_volume": "volume pencarian",
    "product_card_clicks": "klik kartu produk",
}
KILL_LABEL = {
    "ttms.product_card_clicks": "Klik kartu produk",
    "ttms.audience.consideration.new": "Audiens baru Consideration",
    "ttms.engagements.share": "Pangsa interaksi",
}


# ─── Indonesian number formatting ────────────────────────────────────────────


def num(v: float | int | str | None) -> str:
    return "—" if v is None else f"{round(float(v)):,}".replace(",", ".")


def dec(v: float | None, dp: int = 2) -> str:
    return "—" if v is None else f"{float(v):,.{dp}f}".replace(",", "_").replace(".", ",").replace("_", ".")


def pct(ratio: float | None, dp: int = 2) -> str:
    """0.0447 → "4,47%"; small shares keep enough digits to stay within the gate's 1%."""
    if ratio is None:
        return "—"
    v = float(ratio) * 100
    if 0 < abs(v) < 1:
        dp = max(dp, 3)
    return f"{dec(v, dp)}%"


def idr(v: float | None) -> str:
    return "—" if v is None else f"Rp{num(v)}"


def _p(text: str, *refs: str) -> StrategyParagraph:
    return StrategyParagraph(text=text, evidence_refs=list(refs)[:5])


def _e(f: Finding, k: str):
    return f.evidence.get(k)


# ─── One paragraph and one headline per finding ──────────────────────────────


def finding_sentence(f: Finding, brand: str) -> str:
    c, e = f.claim_frame, f.evidence
    st, nx = STAGE.get(str(e.get("stage")), ""), STAGE.get(str(e.get("next_stage")), "")
    if c == CF.STAGE_LEAK.value:
        return (
            f"Ukuran tahap {nx} hanya {pct(e['size_ratio'])} dari tahap {st}, sedangkan rata-rata Top 10 "
            f"{pct(e['bench_size_ratio'])} — selisih {dec(abs(float(e['gap_pt'])))} poin. Saat ini {num(e['stage_total'])} orang "
            f"ada di {st} dan {num(e['next_total'])} di {nx}."
        )
    if c == CF.STAGE_HEALTHY.value:
        return (
            f"Ukuran tahap {nx} setara {pct(e['size_ratio'])} dari tahap {st}, dekat dengan rata-rata Top 10 "
            f"({pct(e['bench_size_ratio'])})."
        )
    if c == CF.STAGE_INFLOW_OFFSET.value:
        return (
            f"Dalam {num(e['window_days'])} hari, {num(e['new_total'])} orang masuk tahap {st} dan {num(e['outflow_total'])} keluar: "
            f"{pct(e['offset_ratio'], 1)} audiens baru tertutup oleh yang keluar, sehingga bersihnya {num(e['net_change'])} orang."
        )
    if c in (CF.OUTFLOW_SPIKE.value, CF.OUTFLOW_FLIGHT_END.value):
        s = (
            f"Audiens keluar tahap {st} pada {e['date']} mencapai {num(e['outflow'])} orang, {dec(e['ratio_to_mean'])}× "
            f"rata-rata 14 hari sebelumnya ({num(e['mean_14d'])})."
        )
        if c == CF.OUTFLOW_FLIGHT_END.value:
            s += f" Ini selaras dengan turunnya belanja {pct(e['spend_drop_pct'], 0)} pada {e['spend_drop_date']}."
        return s
    if c == CF.SPEND_RESPONSE_UNRELATED.value:
        return (
            f"Dari {num(e['n_days'])} hari, belanja harian dan audiens baru {STAGE[str(e['stage'])]} {num(e['lag_days'])} hari kemudian "
            f"belum bergerak bersama (R² {dec(e['r2'])}), jadi batas belanja belum bisa ditarik. Rata-rata biayanya "
            f"{idr(e.get('cost_per_1k_new'))} per seribu audiens baru: {idr(e['window_spend'])} untuk {num(e['window_new'])} orang."
        )
    if c == CF.SPEND_RESPONSE_DIMINISHING.value:
        return (
            f"Di atas sekitar {idr(e['knee_daily_spend'])}/hari, tambahan belanja menghasilkan audiens baru {STAGE[str(e['stage'])]} "
            f"makin sedikit: {idr(e.get('cost_per_1k_above_knee'))} per seribu di atas batas, {idr(e.get('cost_per_1k_below_knee'))} di "
            f"bawahnya. {num(e['days_above_knee'])} hari dalam periode ini berada di atas batas (R² {dec(e['r2'])})."
        )
    if c == CF.SPEND_RESPONSE_LINEAR.value:
        return (
            f"Audiens baru {STAGE[str(e['stage'])]} masih naik seiring belanja (R² {dec(e['r2'])}); belum terlihat titik jenuh "
            f"antara {idr(e['spend_min_day'])} dan {idr(e['spend_max_day'])} per hari."
        )
    if c in (CF.GOAL_ON_TRACK.value, CF.GOAL_OFF_TRACK.value, CF.GOAL_UNREACHABLE.value):
        return _goal_sentence(e)
    if c == CF.DATA_COVERAGE_GAP.value and e.get("signal") == "goal":
        if e.get("reason") == "no_goal":
            return "Belum ada target untuk dipantau. Tetapkan target — peringkat, pangsa, rasio ukuran tahap, atau biaya per seribu audiens baru — di panel Strategy Report."
        return f"Riwayat baru {num(e.get('weeks'))} minggu; laju target butuh minimal {num(e.get('weeks_needed'))} minggu data."
    if c in (CF.CONTENT_MIX_PAID_HEAVY.value, CF.CONTENT_MIX_BALANCED.value):
        return (
            f"{pct(e['paid_share'], 1)} impresi konten yang menyebut {brand} berasal dari konten berbayar; non-berbayar "
            f"{pct(e['non_paid_share'], 1)} dari {num(e['impressions_all'])} impresi."
        )
    if c == CF.HALO_BELOW_BENCHMARK.value:
        return (
            f"Setiap impresi berbayar menghasilkan {dec(e['halo'])} impresi gratis; rata-rata Top 10 {dec(e['bench_halo'])}. "
            f"Porsi {_ct(e['weakest_type'])} hanya {pct(e['weakest_share'], 1)} vs {pct(e.get('weakest_bench_share'), 1)} di Top 10."
        )
    if c in (CF.CREATOR_COST_EFFICIENT.value, CF.CREATOR_COST_HIGHER.value):
        return (
            f"Biaya konten kreator {idr(e['creator_cost_per_1k'])} per seribu impresi, iklan {idr(e['ads_cost_per_1k'])}. "
            + ("Kreator lebih murah untuk menjangkau." if c == CF.CREATOR_COST_EFFICIENT.value else "Iklan lebih murah untuk menjangkau.")
        )
    if c in (CF.SOV_GAINING.value, CF.SOV_LOSING.value):
        m = METRIC.get(str(e["metric"]), str(e["metric"]))
        verb = "naik" if c == CF.SOV_GAINING.value else "turun"
        bench = f" (rata-rata Top 10 {pct(e['bench_share'])})" if e.get("bench_share") is not None else ""
        return f"Pangsa kategori untuk {m} {verb} dari {pct(e['share_prior'])} ke {pct(e['share_now'])}{bench}."
    if c == CF.SOV_STABLE.value:
        m = METRIC.get(str(e["metric"]), str(e["metric"]))
        bench = f" (rata-rata Top 10 {pct(e['bench_share'])})" if e.get("bench_share") is not None else ""
        return f"Pangsa kategori untuk {m} stabil di {pct(e['share_now'])}{bench}."
    if c in (CF.GROWING_FASTER_THAN_CATEGORY.value, CF.GROWING_SLOWER_THAN_CATEGORY.value):
        m = METRIC.get(str(e["metric"]), str(e["metric"]))
        return f"{m.capitalize()} {brand} tumbuh {pct(e['brand_growth'], 1)} dibanding periode sebelumnya, sementara kategori {pct(e['category_growth'], 1)}."
    if c == CF.RANK_MOVED.value:
        verb = "naik" if float(e["rank_change"]) > 0 else "turun"
        return f"Peringkat {STAGE[str(e['stage'])]} {verb} dari #{e['rank_7d']} ke #{e['rank_now']} dari {num(e['rank_n'])} merek dalam 7 hari."
    if c == CF.COMPETITOR_CLIMBING.value:
        return f"{e['competitor']} naik dari #{e['rank_14d']} ke #{e['rank_now']} di tahap {st} dalam 14 hari ({brand} #{e['own_rank']}). TikTok hanya membagikan peringkatnya, bukan angkanya."
    if c == CF.COMPETITOR_FALLING.value:
        return f"{e['competitor']} turun dari #{e['rank_14d']} ke #{e['rank_now']} di tahap {st} dalam 14 hari ({brand} #{e['own_rank']})."
    if c == CF.BRAND_OVERTAKEN.value:
        return f"{e['competitor']} menyalip di tahap {st}: dari #{e['rank_14d']} ke #{e['rank_now']}, kini di atas {brand} (#{e['own_rank']})."
    if c == CF.SEARCH_SHARE_DROP.value:
        return f"Pangsa pencarian 7 hari terakhir {pct(e['search_share_7d'])} vs {pct(e['search_share_28d'])} rata-rata 28 hari."
    if c == CF.SENTIMENT_SPIKE_NEGATIVE.value:
        return "Lonjakan komentar bersamaan dengan turunnya sentimen bersih minggu ini."
    if c == CF.ACTION_MEASURED.value:
        return f"Tindakan sejak {e['started_at']}: {num(e['days_running'])} hari berjalan, status {VERDICT[str(e['verdict'])]}."
    if c == CF.DATA_COVERAGE_GAP.value and e.get("locked_reason"):
        return f"{_signal_label(str(e['signal']))} membutuhkan paket TTMS penuh; akun ini memakai paket Lite."
    if c == CF.DATA_COVERAGE_GAP.value and "history_days" in e:
        return (
            f"Data per {e['as_of']}: riwayat {num(e['history_days'])} hari, belanja tercatat {num(e['spend_days_in_window'])} dari "
            f"{num(e['window_days'])} hari, paket {str(e['plan']).capitalize()}, benchmark tersedia di "
            f"{num(len([x for x in str(e['benchmark_levels']).split(',') if x.startswith('top')]))} tingkat."
        )
    return f"Temuan pada {f.entity.display_name}."


def _goal_sentence(e: dict) -> str:
    kind, deadline = str(e["goal_kind"]), str(e["deadline"])
    status = {"on_track": "sesuai jalur", "off_track": "belum sesuai jalur", "unreachable": "sulit tercapai"}.get(str(e["status"]), str(e["status"]))
    if kind == "rank":
        stage = STAGE.get(str(e["goal_stage"]), "")
        s = (
            f"Target #{num(e['target'])} di tahap {stage} pada {deadline}: saat ini #{num(e['current'])}, proyeksi #{num(e['projected'])} "
            f"(rentang #{num(e['projected_low'])}–#{num(e['projected_high'])}) — {status}."
        )
    else:
        fmt = idr if kind == "cost_per_new" else pct
        s = f"Target {fmt(e['target'])} pada {deadline}: saat ini {fmt(e['current'])}, proyeksi {fmt(e['projected'])} — {status}."
    if e.get("feasibility") not in (None, 0, 0.0) and str(e["status"]) != "on_track":
        s += f" Laju yang dibutuhkan {dec(e['feasibility'])}× laju saat ini."
    return s


def _ct(ct: object) -> str:
    return {
        "bgc_organic": "konten BGC internal (organik)",
        "creator_organic": "video afiliasi/kreator (organik)",
        "ugc_organic": "konten pengguna (UGC) organik",
    }.get(str(ct), str(ct))


def _signal_label(signal: str) -> str:
    return {"search_volume": "Pangsa pencarian merek", "nsr": "Sentimen bersih (NSR)", "goal": "Target"}.get(signal, signal)


VERDICT = {"worked": "Berhasil", "weak": "Lemah", "failed": "Gagal", "running": "Berjalan"}

HEADLINE = {
    CF.STAGE_LEAK.value: "Tahap {st} → {nx} adalah titik bocor utama.",
    CF.STAGE_HEALTHY.value: "Tahap {st} → {nx} sejalan dengan kategori.",
    CF.STAGE_INFLOW_OFFSET.value: "Audiens baru {st} sebagian besar tertutup oleh yang keluar.",
    CF.OUTFLOW_SPIKE.value: "Audiens keluar {st} melonjak minggu ini.",
    CF.OUTFLOW_FLIGHT_END.value: "Audiens keluar {st} melonjak setelah belanja turun.",
    CF.SPEND_RESPONSE_UNRELATED.value: "Belanja dan audiens baru belum bergerak bersama.",
    CF.SPEND_RESPONSE_DIMINISHING.value: "Belanja sudah melewati titik jenuh pada hari-hari puncak.",
    CF.SPEND_RESPONSE_LINEAR.value: "Audiens baru masih naik seiring belanja.",
    CF.GOAL_ON_TRACK.value: "Target berada di jalur yang benar.",
    CF.GOAL_OFF_TRACK.value: "Target belum di jalur dengan laju saat ini.",
    CF.GOAL_UNREACHABLE.value: "Target sulit tercapai dengan laju saat ini.",
    CF.CONTENT_MIX_PAID_HEAVY.value: "Jangkauan merek sangat bergantung pada konten berbayar.",
    CF.CONTENT_MIX_BALANCED.value: "Komposisi konten berbayar dan non-berbayar seimbang.",
    CF.HALO_BELOW_BENCHMARK.value: "Efek tular konten jauh di bawah kategori.",
    CF.CREATOR_COST_EFFICIENT.value: "Konten kreator lebih murah untuk menjangkau.",
    CF.CREATOR_COST_HIGHER.value: "Iklan lebih murah untuk menjangkau daripada kreator.",
    CF.SOV_GAINING.value: "Pangsa kategori sedang naik.",
    CF.SOV_LOSING.value: "Pangsa kategori sedang turun.",
    CF.SOV_STABLE.value: "Pangsa kategori stabil.",
    CF.GROWING_FASTER_THAN_CATEGORY.value: "Merek tumbuh lebih cepat daripada kategori.",
    CF.GROWING_SLOWER_THAN_CATEGORY.value: "Merek tumbuh lebih lambat daripada kategori.",
    CF.RANK_MOVED.value: "Peringkat {st} bergerak minggu ini.",
    CF.COMPETITOR_CLIMBING.value: "Pesaing naik cepat di tahap {st}.",
    CF.COMPETITOR_FALLING.value: "Pesaing turun di tahap {st}.",
    CF.BRAND_OVERTAKEN.value: "Pesaing menyalip di tahap {st}.",
    CF.SEARCH_SHARE_DROP.value: "Pangsa pencarian merek turun.",
    CF.SENTIMENT_SPIKE_NEGATIVE.value: "Sentimen memburuk bersama lonjakan komentar.",
}


def finding_headline(f: Finding) -> str:
    e = f.evidence
    st, nx = STAGE.get(str(e.get("stage")), ""), STAGE.get(str(e.get("next_stage")), "")
    tpl = HEADLINE.get(f.claim_frame)
    if tpl:
        return tpl.format(st=st, nx=nx)
    if f.claim_frame == CF.DATA_COVERAGE_GAP.value and e.get("signal") == "goal":
        return "Belum ada target untuk dipantau." if e.get("reason") == "no_goal" else "Riwayat belum cukup untuk mengukur laju."
    if f.claim_frame == CF.DATA_COVERAGE_GAP.value and e.get("locked_reason"):
        return f"{_signal_label(str(e['signal']))} terkunci di paket Lite."
    return "Ringkasan data dan cakupan."


# ─── Section drafts ──────────────────────────────────────────────────────────

EMPTY = {
    T.T3_FUNNEL: "Data tidak cukup untuk membandingkan tahap funnel dengan kategori pada periode ini.",
    T.T4_SPEND: "Data tidak cukup: butuh ≥ 21 hari belanja yang dapat dipasangkan dengan audiens baru.",
    T.T5_PACE: "Belum ada target untuk dipantau.",
    T.T6_CLASS: "Tidak ada perubahan yang cukup besar untuk dilaporkan di bagian ini.",
    T.T7_CONTENT: "Data tidak cukup: rincian jenis konten belum tersedia untuk periode ini.",
    T.T8_WARNINGS: "Tidak ada sinyal yang bergerak cukup jauh sejak laporan sebelumnya.",
    T.T9_ACTION_LOG: "Belum ada tindakan yang diterima. Terima keputusan di atas untuk mulai mengukurnya.",
    T.LAMPIRAN_A: "Definisi dan cakupan data.",
}


def instant_section_draft(sid: StrategySectionId, selected: list[Finding], frame: StrategyFrame, fallback_ref: str) -> StrategySectionDraft:
    if not selected:
        return StrategySectionDraft(headline=EMPTY[sid] if len(EMPTY[sid]) <= 200 else EMPTY[sid][:197] + "…", paragraphs=[_p(EMPTY[sid], fallback_ref)])
    lead = selected[0]
    paras = [_p(finding_sentence(f, frame.brand_name), f.id) for f in selected[:3]]
    return StrategySectionDraft(headline=finding_headline(lead), paragraphs=paras)


# ─── Action copy (PRD Appendix D) ────────────────────────────────────────────


def deterministic_action_copy(a: ActionItem, findings_by_id: dict[str, Finding], brand: str, cls: ReportClass) -> ActionCopy:
    weeks = num(a.horizon_days / 7)
    trig = findings_by_id.get(a.evidence_refs[0]) if a.evidence_refs else None
    e = trig.evidence if trig else {}
    kill = ""
    if a.kill_signal:
        key = a.kill_signal.metric_key
        label = KILL_LABEL.get(key) or (
            f"Porsi impresi dari {a.subject}" if key.startswith("ttms.impressions.share.")
            else f"Biaya per seribu audiens baru {STAGE.get(key.split('.')[-1], '')}" if key.startswith("strategy.cost_per_1k_new.")
            else f"Audiens keluar tahap {STAGE.get(key.split('.')[2], '')}" if key.endswith(".outflow")
            else f"Nilai {a.subject}"
        )
        direction = "tidak naik" if a.kill_signal.condition == "no_rise_within_days" else "tidak turun"
        kill = f"{label} {direction} dalam {num(a.kill_signal.days)} hari."
    cur = a.current.value if a.current else None
    tgt = a.target.value if a.target else None

    if a.lever == "content_mix":
        return ActionCopy(
            langkah=f"Naikkan porsi impresi dari {a.subject} dari {pct(cur, 1)} → {pct(tgt, 1)} dalam {weeks} minggu.",
            dasar=f"Rata-rata Top 10 {pct(e.get('weakest_bench_share'), 1)}; {brand} {pct(cur, 1)}. Setiap impresi berbayar baru menghasilkan {dec(e.get('halo'))} impresi gratis.",
            cara=f"Tambah produksi {a.subject} setiap minggu dan pantau porsinya tiap pekan.",
            gagal_jika=kill,
        )
    if a.lever == "stage_targeting":
        stage, nxt = str(e.get("stage")), str(e.get("next_stage"))
        how = (
            "Tujukan kampanye ke audiens Consideration dengan penawaran TikTok Shop pada produk terlaris."
            if stage == "consideration"
            else "Tujukan ulang audiens Awareness dengan konten yang mengajak komentar, simpan, atau klik."
        )
        return ActionCopy(
            langkah=f"Naikkan ukuran tahap {STAGE.get(nxt, nxt)} dari {pct(cur)} → {pct(tgt)} ukuran tahap {STAGE.get(stage, stage)} dalam {weeks} minggu.",
            dasar=f"Rata-rata Top 10 {pct(e.get('bench_size_ratio'))}; saat ini {num(e.get('next_total'))} orang di {STAGE.get(nxt, nxt)} dari {num(e.get('stage_total'))} di {STAGE.get(stage, stage)}.",
            cara=how,
            gagal_jika=kill,
        )
    if a.lever == "budget_cap":
        return ActionCopy(
            langkah=f"Batasi belanja harian di {idr(tgt)}/hari (saat ini rata-rata {idr(cur)}/hari) selama {weeks} minggu.",
            dasar=f"Di atas {idr(e.get('knee_daily_spend'))}/hari, biaya per seribu audiens baru naik dari {idr(e.get('cost_per_1k_below_knee'))} ke {idr(e.get('cost_per_1k_above_knee'))}.",
            cara="Pindahkan kelebihan anggaran ke hari-hari di bawah batas atau ke kampanye Consideration.",
            gagal_jika=kill,
        )
    if a.lever == "creator_boost":
        m = METRIC.get(a.metric_key.split(".")[1], "impresi")
        return ActionCopy(
            langkah=f"Tambah boost video kreator agar pangsa {m} naik dari {pct(cur)} → {pct(tgt)} dalam {weeks} minggu.",
            dasar=f"Pangsa {m} turun dari {pct(e.get('share_prior'))} ke {pct(e.get('share_now'))} dibanding periode sebelumnya.",
            cara="Pilih 3 video kreator dengan interaksi tertinggi dan boost secara bergiliran.",
            gagal_jika=kill,
        )
    if a.lever == "creative_refresh":
        return ActionCopy(
            langkah=f"Luncurkan materi kreatif baru agar audiens keluar harian turun dari {num(cur)} → {num(tgt)} orang dalam 2 minggu.",
            dasar=f"Audiens keluar pada {e.get('date')} mencapai {dec(e.get('ratio_to_mean'))}× rata-rata 14 hari.",
            cara="Mulai flight baru dengan materi yang belum pernah tayang.",
            gagal_jika=kill,
        )
    # investigate
    return ActionCopy(
        langkah=f"Selidiki {a.subject}: dari #{e.get('rank_14d')} ke #{e.get('rank_now')} di tahap {STAGE.get(str(e.get('stage')), '')} dalam 14 hari.",
        dasar="TikTok hanya membagikan peringkat pesaing, bukan angkanya.",
        cara="Periksa listing TikTok Shop dan unggahan kreator mereka minggu ini; catat produk dan kampanye yang mereka dorong.",
        gagal_jika="Peringkat mereka kembali turun dalam 7 hari — kemungkinan lonjakan kampanye sesaat.",
    )


# ─── T1 verdict (deterministic; the synthesist's fallback) ──────────────────


def deterministic_verdict(frame: StrategyFrame, routed: dict[StrategySectionId, list[Finding]], actions: list[ActionItem]) -> VerdictDraft:
    cls = frame.classification.report_class
    by_claim = {f.claim_frame: f for fs in routed.values() for f in fs}
    leak = next((f for f in routed.get(T.T3_FUNNEL, []) if f.claim_frame == CF.STAGE_LEAK.value), None)
    sov = next((f for f in routed.get(T.T6_CLASS, []) if f.claim_frame in (CF.SOV_GAINING.value, CF.SOV_LOSING.value)), None)
    lead = leak if (cls == "shop" or not sov) and leak else sov or leak or next((fs[0] for fs in routed.values() if fs), None)
    headline = finding_headline(lead) if lead else f"Ringkasan strategi {frame.brand_name}."
    sentences = [finding_sentence(lead, frame.brand_name)] if lead else []
    if actions and actions[0].copy_:
        sentences.append(f"Prioritas: {actions[0].copy_.langkah}")
    paragraph = " ".join(sentences) or "Data periode ini belum cukup untuk vonis yang tegas."

    # Chip 1 — brand: rank / SOV movement; shop: the bottleneck stage.
    if cls == "shop" and leak:
        chip1 = VerdictChip(label="Hambatan", value=f"{STAGE[str(leak.evidence['stage'])]} → {STAGE[str(leak.evidence['next_stage'])]}", status="critical", finding_id=leak.id)
    elif sov:
        chip1 = VerdictChip(label="Pangsa kategori", value=f"{pct(sov.evidence['share_prior'])} → {pct(sov.evidence['share_now'])}", status="good" if sov.claim_frame == CF.SOV_GAINING.value else "watch", finding_id=sov.id)
    else:
        chip1 = VerdictChip(label="Hambatan", value="Tidak terdeteksi", status="unknown")

    spend = next((by_claim[c] for c in (CF.SPEND_RESPONSE_DIMINISHING.value, CF.SPEND_RESPONSE_LINEAR.value, CF.SPEND_RESPONSE_UNRELATED.value) if c in by_claim), None)
    if spend is None:
        chip2 = VerdictChip(label="Efisiensi belanja", value="Data belum cukup", status="unknown")
    elif spend.claim_frame == CF.SPEND_RESPONSE_DIMINISHING.value:
        chip2 = VerdictChip(label="Efisiensi belanja", value="Melewati titik jenuh", status="watch", finding_id=spend.id)
    elif spend.claim_frame == CF.SPEND_RESPONSE_LINEAR.value:
        chip2 = VerdictChip(label="Efisiensi belanja", value="Masih naik", status="good", finding_id=spend.id)
    else:
        chip2 = VerdictChip(label="Efisiensi belanja", value=f"Belum terbaca (R² {dec(spend.evidence['r2'])})", status="unknown", finding_id=spend.id)

    goal = next((f for f in routed.get(T.T5_PACE, []) if f.generator == "T03"), None)
    if goal and goal.claim_frame in (CF.GOAL_ON_TRACK.value, CF.GOAL_OFF_TRACK.value, CF.GOAL_UNREACHABLE.value):
        st = {"on_track": "on_track", "off_track": "off_track", "unreachable": "critical"}[str(goal.evidence["status"])]
        val = f"#{num(goal.evidence['current'])} → target #{num(goal.evidence['target'])}" if goal.evidence["goal_kind"] == "rank" else str(goal.evidence["status"]).replace("_", " ")
        chip3 = VerdictChip(label="Laju target", value=val, status=st, finding_id=goal.id)  # type: ignore[arg-type]
    else:
        chip3 = VerdictChip(label="Laju target", value="Belum ada target", status="unknown", finding_id=goal.id if goal else None)
    return VerdictDraft(headline=headline[:120], paragraph=paragraph[:900], chips=[chip1, chip2, chip3])


# ─── T8 signals and per-finding card copy ────────────────────────────────────


def signal_for(f: Finding, brand: str) -> Signal:
    c = f.claim_frame
    if c == CF.DATA_COVERAGE_GAP.value and f.evidence.get("locked_reason"):
        status = "locked"
    elif c in (CF.COMPETITOR_CLIMBING.value, CF.BRAND_OVERTAKEN.value, CF.SENTIMENT_SPIKE_NEGATIVE.value, CF.SEARCH_SHARE_DROP.value):
        status = "investigate"
    elif c in (CF.SOV_GAINING.value, CF.GROWING_FASTER_THAN_CATEGORY.value, CF.COMPETITOR_FALLING.value) or (
        c == CF.RANK_MOVED.value and float(f.evidence.get("rank_change", 0)) > 0
    ):
        status = "good"
    else:
        status = "watch"
    return Signal(finding_id=f.id, kind=c, status=status, title=finding_headline(f), detail=finding_sentence(f, brand))  # type: ignore[arg-type]


def strategy_card_copy(f: Finding, brand: str) -> dict[str, str]:
    return {"headline": finding_headline(f), "mechanism": finding_sentence(f, brand), "action": ""}
