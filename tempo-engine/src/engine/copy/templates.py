"""Instant-tier copy: one closed template table keyed by `claim_frame`.

Brief Deck PRD §5 makes the LLM a *tier*, not a prerequisite: the instant tier
runs steward → generators → materiality with **zero model calls** and writes its
prose from this table. PRD §11 R4 names the risk honestly — closed-enum
templates are safe but flat — and the mitigation this module implements:

- **2–3 phrasing variants per `claim_frame`**, chosen deterministically by a
  hash of the finding id, so the same finding always reads the same way (a
  golden deck stays golden) while a deck of six cards does not repeat one
  sentence six times.
- **Templates carry mechanism, evidence carries specificity.** Every number in
  the output is a value from the finding's own `evidence` dict, formatted but
  never recomputed — numeral-gate-safe by construction, exactly like the
  deterministic fallback writer this extends (`gates/fallback.py`, PRD §8).

An unknown `claim_frame` is not an error: it falls back to the generic frame
copy below. A missing template must never be the reason a brief fails to
render — that is the same doctrine `fallback.py` is built on.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Sequence

from engine.contracts import Confidence, Finding
from engine.gates.fallback import (
    deterministic_s1_draft,
    deterministic_section_draft,
    format_evidence_value,
    label_for,
)
from engine.llm.schemas import RiskItem, S1Draft, S6Draft, SectionDraft, SectionDraftFull, SectionDraftLow


@dataclass(frozen=True)
class FrameCopy:
    """`{entity}` is the only interpolation a headline or action may carry —
    never a number. Figures belong in the mechanism sentence, sourced from
    `evidence`, so the deck's evidence chips and the prose cannot disagree."""

    headlines: tuple[str, ...]
    actions: tuple[str, ...]


_GENERIC = FrameCopy(
    headlines=(
        "Temuan pada {entity} perlu diperhatikan periode ini.",
        "{entity} menonjol dalam data periode ini.",
    ),
    actions=(
        "Tinjau {entity} bersama tim terkait dan tentukan tindak lanjutnya.",
        "Bahas {entity} pada evaluasi mingguan berikutnya.",
    ),
)

FRAME_COPY: dict[str, FrameCopy] = {
    # --- shared battery G01-G08 -------------------------------------------
    "identity_decomposition": FrameCopy(
        headlines=(
            "Perubahan pada {entity} berasal dari komponen yang berbeda bobotnya.",
            "Pergerakan {entity} terurai menjadi dua pendorong utama.",
        ),
        actions=(
            "Fokuskan pengungkit pada komponen dengan kontribusi terbesar di {entity}.",
            "Tetapkan target terpisah untuk tiap komponen pendorong {entity}.",
        ),
    ),
    "efficiency_outlier_positive": FrameCopy(
        headlines=(
            "{entity} bekerja lebih efisien dibanding rata-rata akun.",
            "Efisiensi {entity} berada di atas pembanding periode ini.",
        ),
        actions=(
            "Tambah anggaran pada {entity} selama efisiensinya bertahan.",
            "Perluas struktur yang dipakai {entity} ke kampanye sejenis.",
        ),
    ),
    "efficiency_outlier_negative": FrameCopy(
        headlines=(
            "{entity} bekerja kurang efisien dibanding rata-rata akun.",
            "Efisiensi {entity} tertinggal dari pembanding periode ini.",
        ),
        actions=(
            "Evaluasi {entity}: turunkan anggaran atau perbaiki materi iklannya.",
            "Bandingkan setelan {entity} dengan kampanye yang lebih efisien sebelum menambah anggaran.",
        ),
    ),
    "concentration_dependency": FrameCopy(
        headlines=(
            "Hasil periode ini bertumpu pada {entity}.",
            "Ketergantungan pada {entity} tinggi periode ini.",
        ),
        actions=(
            "Siapkan cadangan di luar {entity} agar hasil tidak bergantung pada satu sumber.",
            "Uji satu kampanye pendamping agar beban tidak seluruhnya di {entity}.",
        ),
    ),
    "zero_yield_spend": FrameCopy(
        headlines=(
            "{entity} menyerap anggaran tanpa hasil terukur.",
            "Belanja pada {entity} belum menghasilkan keluaran yang tercatat.",
        ),
        actions=(
            "Matikan {entity} dan alihkan anggarannya ke kampanye yang menghasilkan.",
            "Hentikan {entity} sementara sampai penyebab nol hasil ditemukan.",
        ),
    ),
    "marginal_return_scaling": FrameCopy(
        headlines=(
            "{entity} masih memberi hasil tambahan saat anggarannya naik.",
            "Ruang penambahan anggaran masih terbuka di {entity}.",
        ),
        actions=(
            "Tambah anggaran {entity} bertahap dan pantau efisiensinya tiap minggu.",
            "Naikkan anggaran harian {entity} dan tinjau ulang setelah tiga hari.",
        ),
    ),
    "marginal_return_declining": FrameCopy(
        headlines=(
            "Tambahan anggaran di {entity} tidak lagi diikuti tambahan hasil.",
            "{entity} menunjukkan tanda kejenuhan anggaran.",
        ),
        actions=(
            "Tahan anggaran {entity} pada level saat ini dan alihkan kelebihannya.",
            "Kurangi anggaran {entity} dan uji audiens atau materi baru.",
        ),
    ),
    "attribute_performance_correlation": FrameCopy(
        headlines=(
            "Atribut tertentu pada {entity} bergerak searah dengan performa.",
            "Pola atribut {entity} berkaitan dengan hasil periode ini.",
        ),
        actions=(
            "Perbanyak materi dengan atribut yang sama seperti {entity}.",
            "Jadikan atribut {entity} acuan pada produksi materi berikutnya.",
        ),
    ),
    "comparability_artifact": FrameCopy(
        headlines=(
            "Perbandingan periode pada {entity} perlu dibaca dengan konteks.",
            "Panjang periode aktif {entity} tidak sama antar periode.",
        ),
        actions=(
            "Baca perubahan {entity} pada basis harian sebelum mengambil keputusan anggaran.",
            "Samakan rentang hari aktif sebelum membandingkan {entity} antar periode.",
        ),
    ),
    "data_coverage_gap": FrameCopy(
        headlines=(
            "Cakupan data periode ini membatasi sebagian analisis {entity}.",
            "Sebagian sinyal untuk {entity} belum tersedia periode ini.",
        ),
        actions=(
            "Pastikan sinkronisasi data berjalan penuh sebelum periode berikutnya.",
            "Lengkapi metrik yang belum tersedia agar analisis berikutnya utuh.",
        ),
    ),
    # --- GMV (M01-M04) ------------------------------------------------------
    "session_efficiency_leader": FrameCopy(
        headlines=(
            "Sesi live {entity} paling efisien periode ini.",
            "{entity} memimpin efisiensi sesi live.",
        ),
        actions=(
            "Tambah jam tayang pada pola sesi seperti {entity}.",
            "Jadikan {entity} acuan jadwal dan susunan sesi berikutnya.",
        ),
    ),
    "session_efficiency_laggard": FrameCopy(
        headlines=(
            "Sesi live {entity} paling lemah efisiensinya periode ini.",
            "{entity} tertinggal di antara sesi live lainnya.",
        ),
        actions=(
            "Evaluasi jadwal dan susunan sesi {entity} sebelum ditayangkan ulang.",
            "Kurangi jam tayang {entity} dan alihkan ke sesi yang lebih efisien.",
        ),
    ),
    "aov_mix_shift": FrameCopy(
        headlines=(
            "Nilai pesanan rata-rata pada {entity} bergeser periode ini.",
            "Komposisi pesanan {entity} berubah dibanding periode sebelumnya.",
        ),
        actions=(
            "Sesuaikan bundling atau harga pada {entity} mengikuti pergeseran ini.",
            "Tinjau produk pendorong nilai pesanan di {entity}.",
        ),
    ),
    "creator_ladder_leader": FrameCopy(
        headlines=(
            "{entity} adalah kreator dengan kontribusi terkuat periode ini.",
            "Kontribusi {entity} memimpin di antara kreator.",
        ),
        actions=(
            "Perpanjang kerja sama dengan {entity} dan tambah slot kontennya.",
            "Replikasi format konten {entity} pada kreator lain.",
        ),
    ),
    "creator_ladder_laggard": FrameCopy(
        headlines=(
            "{entity} tertinggal di antara kreator periode ini.",
            "Kontribusi {entity} paling lemah dibanding kreator lain.",
        ),
        actions=(
            "Perbaiki brief konten {entity} atau alihkan slotnya ke kreator lain.",
            "Evaluasi kelanjutan kerja sama dengan {entity} pada siklus berikutnya.",
        ),
    ),
    "sku_lifecycle_contribution": FrameCopy(
        headlines=(
            "Kontribusi produk {entity} menonjol periode ini.",
            "{entity} menempati porsi penting dalam hasil penjualan.",
        ),
        actions=(
            "Jaga ketersediaan stok {entity} sebelum menambah anggaran.",
            "Dorong {entity} pada materi iklan periode berikutnya.",
        ),
    ),
    "cohort_slice_summary": FrameCopy(
        headlines=(
            "Irisan data pada {entity} menunjukkan pola tersendiri.",
            "{entity} terpisah dari pola umum akun periode ini.",
        ),
        actions=(
            "Tinjau {entity} secara terpisah sebelum menyamakan perlakuannya.",
            "Pantau {entity} satu periode lagi sebelum mengubah anggaran.",
        ),
    ),
    # --- Awareness (A01-A04) ------------------------------------------------
    "frequency_over_exposed": FrameCopy(
        headlines=(
            "Audiens {entity} melihat iklan terlalu sering.",
            "Frekuensi tayang {entity} melewati batas wajar.",
        ),
        actions=(
            "Perluas audiens {entity} atau batasi frekuensi tayangnya.",
            "Turunkan frekuensi {entity} dan alihkan tayangan ke audiens baru.",
        ),
    ),
    "frequency_under_saturated": FrameCopy(
        headlines=(
            "Audiens {entity} belum cukup sering melihat iklan.",
            "Frekuensi tayang {entity} masih di bawah ambang efektif.",
        ),
        actions=(
            "Tambah tayangan pada {entity} sebelum memperluas audiens.",
            "Naikkan anggaran {entity} agar frekuensi mencapai ambang efektif.",
        ),
    ),
    "retention_hook_without_hold": FrameCopy(
        headlines=(
            "Materi {entity} menarik perhatian awal tetapi tidak menahan penonton.",
            "Penonton {entity} berhenti setelah detik-detik pertama.",
        ),
        actions=(
            "Perbaiki bagian tengah video {entity}, bukan pembukanya.",
            "Uji versi {entity} dengan alur cerita yang lebih padat setelah tiga detik pertama.",
        ),
    ),
    "retention_strong_hold": FrameCopy(
        headlines=(
            "Materi {entity} berhasil menahan penonton sampai akhir.",
            "Daya tahan tonton {entity} paling kuat periode ini.",
        ),
        actions=(
            "Perbanyak penayangan {entity} dan jadikan acuan materi berikutnya.",
            "Gunakan struktur {entity} sebagai template produksi konten.",
        ),
    ),
    "incremental_reach_efficient": FrameCopy(
        headlines=(
            "Tambahan belanja pada {entity} masih menambah jangkauan baru.",
            "{entity} masih membuka audiens yang belum terjangkau.",
        ),
        actions=(
            "Tambah anggaran {entity} selama jangkauan baru masih tumbuh.",
            "Pertahankan {entity} sebagai sumber jangkauan tambahan.",
        ),
    ),
    "incremental_reach_saturating": FrameCopy(
        headlines=(
            "Tambahan belanja pada {entity} tidak lagi menambah jangkauan baru.",
            "Jangkauan {entity} mendekati titik jenuh.",
        ),
        actions=(
            "Alihkan sebagian anggaran {entity} ke audiens atau format baru.",
            "Tahan anggaran {entity} dan uji penargetan yang berbeda.",
        ),
    ),
    "adgroup_reach_overlap": FrameCopy(
        headlines=(
            "Audiens {entity} beririsan dengan grup iklan lain.",
            "Jangkauan {entity} tumpang tindih di dalam kampanye yang sama.",
        ),
        actions=(
            "Pisahkan penargetan {entity} agar tidak berebut audiens yang sama.",
            "Gabungkan grup iklan yang beririsan dengan {entity}.",
        ),
    ),
    # --- Install (N01-N04) --------------------------------------------------
    "funnel_leak_click_to_install": FrameCopy(
        headlines=(
            "Kebocoran funnel {entity} terjadi antara klik dan instal.",
            "Klik pada {entity} tidak berlanjut menjadi instal.",
        ),
        actions=(
            "Periksa halaman toko aplikasi dan kecepatan muat untuk {entity}.",
            "Selaraskan janji materi iklan {entity} dengan tampilan halaman instal.",
        ),
    ),
    "cohort_quality_risk": FrameCopy(
        headlines=(
            "Biaya instal {entity} murah tetapi kualitasnya berisiko.",
            "{entity} menghasilkan instal murah dengan tingkat konversi rendah.",
        ),
        actions=(
            "Jangan tambah anggaran {entity} sebelum kualitas instalnya terbukti.",
            "Pantau {entity} satu periode lagi sebelum diperbesar.",
        ),
    ),
    "cohort_quality_strong": FrameCopy(
        headlines=(
            "{entity} menghasilkan instal dengan kualitas terbaik periode ini.",
            "Tingkat konversi {entity} sepadan dengan biayanya.",
        ),
        actions=(
            "Tambah anggaran {entity} sebagai sumber instal utama.",
            "Perluas penargetan sejenis {entity}.",
        ),
    ),
    "cpi_efficiency_scaling": FrameCopy(
        headlines=(
            "Biaya per instal {entity} bertahan saat anggarannya naik.",
            "{entity} masih dapat diperbesar tanpa memperburuk biaya instal.",
        ),
        actions=(
            "Naikkan anggaran {entity} bertahap dengan pemantauan CPI harian.",
            "Perbesar {entity} lebih dulu sebelum kampanye lain.",
        ),
    ),
    "cpi_efficiency_saturating": FrameCopy(
        headlines=(
            "Biaya per instal {entity} memburuk saat anggarannya naik.",
            "{entity} mendekati batas efisiensi biaya instal.",
        ),
        actions=(
            "Tahan anggaran {entity} pada level saat ini.",
            "Alihkan tambahan anggaran dari {entity} ke kampanye dengan CPI stabil.",
        ),
    ),
    "install_rate_anomaly": FrameCopy(
        headlines=(
            "Tingkat instal {entity} menyimpang dari pola biasanya.",
            "Ada lonjakan atau penurunan tidak wajar pada instal {entity}.",
        ),
        actions=(
            "Verifikasi pelacakan instal {entity} sebelum menafsirkan angkanya.",
            "Cek integrasi SDK dan atribusi untuk {entity}.",
        ),
    ),
}

_MECHANISM_SCAFFOLDS = (
    "{entity} — {evidence}.",
    "Angka periode ini untuk {entity}: {evidence}.",
    "Pada {entity} tercatat {evidence}.",
)

_IMPLICATION_SCAFFOLDS = (
    "Angka di atas berasal langsung dari data periode ini; tindak lanjutnya "
    "menentukan arah alokasi anggaran berikutnya.",
    "Selama pola ini bertahan, keputusan anggaran berikutnya sebaiknya mengikuti "
    "temuan ini, bukan rata-rata akun.",
    "Temuan ini menjelaskan sebagian pergerakan periode ini dan layak dipantau "
    "pada periode berikutnya.",
)

_OUTLOOK_SCAFFOLDS = (
    "Jika pola periode ini bertahan, prioritas berikutnya mengikuti urutan aksi di atas.",
    "Proyeksi disusun dari temuan periode ini saja, tanpa asumsi tambahan di luar data.",
)

MAX_MECHANISM_FINDINGS = 3
MAX_S6_RISKS = 6
_SEVERITY_BY_MAGNITUDE = ((0.5, "high"), (0.2, "medium"))


def _variant(options: Sequence[str], key: str) -> str:
    """Deterministic per finding id — PRD §11 R4. A hash, not a counter, so
    variant choice does not depend on how many findings preceded this one:
    the same finding reads identically in every re-render of the same run."""
    if not options:
        return ""
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    return options[int.from_bytes(digest[:4], "big") % len(options)]


def _frame_copy(claim_frame: str) -> FrameCopy:
    return FRAME_COPY.get(claim_frame, _GENERIC)


# Evidence keys a client should never read: internal switches and labels that
# repeat what the claim frame already says. Their *values* are still available
# to the deck's evidence chips (M3) — this only governs the prose sentence.
_PROSE_SKIP_KEYS = frozenset({"rule", "count_metric", "cohort_level", "basis", "method"})


def _humanize_key(key: str) -> str:
    """`total_cost` -> `total cost`. The key is a variable name, not copy; the
    numbers are what carry the claim, so the label around them should not read
    like a debug dump."""
    return key.replace("_", " ")


def _evidence_phrase(finding: Finding, limit: int = 3) -> str:
    """Evidence rendered verbatim from the finding's own dict — the reason this
    module needs no numeral-gate pass of its own.

    Numeric evidence comes first: a sentence that leads with `rule:
    dormant_entity` reads like a stack trace, while the same finding leading
    with its figures reads like an analyst. Nothing is reworded or recomputed —
    only ordered and filtered.
    """
    items = [(k, v) for k, v in finding.evidence.items() if k not in _PROSE_SKIP_KEYS]
    numeric = [(k, v) for k, v in items if isinstance(v, (int, float))]
    chosen = (numeric or items)[:limit]
    if not chosen:
        return "tidak ada rincian angka tambahan"
    return "; ".join(f"{_humanize_key(k)} {format_evidence_value(v)}" for k, v in chosen)


def headline_for(finding: Finding) -> str:
    return _variant(_frame_copy(finding.claim_frame).headlines, finding.id).format(
        entity=finding.entity.display_name
    )[:200]


def action_for(finding: Finding) -> str:
    return _variant(_frame_copy(finding.claim_frame).actions, finding.id).format(
        entity=finding.entity.display_name
    )[:400]


def mechanism_for(finding: Finding) -> str:
    return _variant(_MECHANISM_SCAFFOLDS, finding.id).format(
        entity=finding.entity.display_name, evidence=_evidence_phrase(finding)
    )


def instant_section_draft(findings: list[Finding], confidence_tier: Confidence) -> SectionDraft:
    """The instant tier's section prose. Delegates the no-findings case to the
    fallback writer so "Tidak ada temuan" is worded identically no matter which
    path produced it — one honest empty state, not two."""
    if not findings:
        return deterministic_section_draft(findings, confidence_tier)

    top = findings[0]
    headline = headline_for(top)
    mechanism = " ".join(mechanism_for(f) for f in findings[:MAX_MECHANISM_FINDINGS])[:900]
    action = action_for(top)
    evidence_refs = [f.id for f in findings[:5]]

    if confidence_tier == Confidence.LOW:
        return SectionDraftLow(
            headline=headline,
            mechanism=mechanism,
            evidence_refs=evidence_refs,
            action=action,
            confidence="low",
        )
    return SectionDraftFull(
        headline=headline,
        mechanism=mechanism,
        evidence_refs=evidence_refs,
        implication=_variant(_IMPLICATION_SCAFFOLDS, top.id)[:500],
        action=action,
        confidence="high" if confidence_tier == Confidence.HIGH else "medium",
    )


def _severity_for(finding: Finding) -> str:
    for threshold, severity in _SEVERITY_BY_MAGNITUDE:
        if finding.magnitude_pct >= threshold:
            return severity
    return "low"


def instant_s6_draft(findings: list[Finding], confidence_tier: Confidence) -> S6Draft:
    """Risk register from the same table. `S6Draft` requires at least two
    risks, so a single-finding period is padded with the coverage statement the
    fallback writer uses — never with an invented second risk."""
    if not findings:
        from engine.gates.fallback import deterministic_s6_draft

        return deterministic_s6_draft(findings)

    risks = [
        RiskItem(
            risk=f"{label_for(f.claim_frame)}: {headline_for(f)}"[:400],
            severity=_severity_for(f),
            action=action_for(f)[:300],
            owner="Media Buying",
            evidence_refs=[f.id],
        )
        for f in findings[:MAX_S6_RISKS]
    ]
    if len(risks) < 2:
        risks.append(
            RiskItem(
                risk="Cakupan temuan periode ini terbatas pada satu sinyal material.",
                severity="low",
                action="Perluas cakupan data pada periode pelaporan berikutnya.",
                owner="Data / Ops",
                evidence_refs=[findings[0].id],
            )
        )
    return S6Draft(
        risks=risks,
        outlook=[_variant(_OUTLOOK_SCAFFOLDS, findings[0].id)],
        confidence=confidence_tier.value,
    )


def instant_s1_draft(accepted_headlines: list[str]) -> S1Draft:
    """S1 introduces no claim and no number of its own — it concatenates
    headlines that already passed a gate. Identical rule to the agent path
    (PRD §5.6), so the deck cover cannot say more than the deck proves.

    Duplicates are dropped first. One finding can be the top-ranked material
    for more than one section (`section_affinity` is a list), and the summary
    repeating the same sentence three times reads as a bug to a client even
    though every sentence in it is true.
    """
    seen: set[str] = set()
    deduped = [h for h in accepted_headlines if not (h in seen or seen.add(h))]
    return deterministic_s1_draft(deduped)
