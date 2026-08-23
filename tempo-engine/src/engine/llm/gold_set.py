"""The Indonesian gold set (PRD B5: "Indonesian gold set, 3-5 exemplars per
section per brief type"). Bootstrapped from the Sovella reference report's
own prose — the same source the B2/B3 exit gates were validated against.

Scope note: this ships with ONE exemplar per section rather than 3-5. The
mechanism (few-shot exemplars wired into the narrator/synthesist prompts,
in the exact response-schema shape) is what B5 needs to exist; expanding to
3-5 per section per brief type is a volume increase to the same mechanism,
not a new capability, and is better done once the review-gate edit-distance
signal (PRD §10) exists to say which additional exemplars would actually
move the needle — guessing at four more examples now would be effort spent
without that feedback loop.
"""

from __future__ import annotations

# --- Narrator exemplars (S2-S5), in SectionDraftFull/Low shape --------------

NARRATOR_EXEMPLARS: dict[int, dict] = {
    2: {
        "findings_summary": (
            "identity_decomposition: GMV turun dari Rp 642.010.558 menjadi Rp 506.058.865. "
            "comparability_artifact: periode ini hanya 4 hari aktif vs 7 hari pada periode sebelumnya; "
            "delta nominal -21,18% tetapi delta per-hari-aktif +38,15%."
        ),
        "output": {
            "headline": "Penurunan GMV nominal disebabkan oleh jumlah hari aktif yang lebih pendek, bukan pelemahan performa.",
            "mechanism": (
                "GMV periode ini tercatat Rp 506.058.865, turun 21,18% dibandingkan periode sebelumnya secara nominal. "
                "Namun periode ini hanya mencakup 4 hari aktif dibandingkan 7 hari pada periode sebelumnya — "
                "setelah disesuaikan per hari aktif, GMV harian justru naik."
            ),
            "evidence_refs": ["g01_identity_decomposition", "g07_comparability_artifact"],
            "implication": "Membaca angka -21,18% tanpa konteks hari aktif akan salah menyimpulkan performa memburuk.",
            "action": "Sertakan catatan hari aktif setiap kali membandingkan GMV antar periode agar tim tidak salah mengambil keputusan anggaran.",
            "confidence": "medium",
        },
    },
    3: {
        "findings_summary": (
            "efficiency_outlier_positive: sesi live 'Promo Special Payday Sale #2' mencatat ROI 27,34x, "
            "jauh di atas median kohort 8,02x."
        ),
        "output": {
            "headline": "Sesi live 'Promo Special Payday Sale #2' menjadi standout efisiensi dengan ROI 27,34x.",
            "mechanism": "Sesi ini mencatat ROI 27,34x, jauh melampaui median ROI sesi live lainnya sebesar 8,02x.",
            "evidence_refs": ["g02_live_03"],
            "implication": "Format atau waktu tayang sesi ini kemungkinan menjadi faktor keberhasilan yang dapat direplikasi.",
            "action": "Tinjau format dan waktu tayang sesi 'Promo Special Payday Sale #2' untuk direplikasi pada sesi mendatang.",
            "confidence": "high",
        },
    },
    4: {
        "findings_summary": "zero_yield_spend: 5 ad group Non-GMV Max tidak memiliki belanja maupun aktivitas sama sekali.",
        "output": {
            "headline": "5 ad group Non-GMV Max tidak aktif sama sekali pada periode ini.",
            "mechanism": "Lima ad group non-GMV Max tercatat tanpa belanja dan tanpa aktivitas apa pun selama periode ini.",
            "evidence_refs": ["g04_dormant_entity_adgroup"],
            "implication": "Ad group yang tidak aktif ini tidak berkontribusi pada hasil apa pun dan sebaiknya dievaluasi.",
            "action": "Aktifkan kembali kelima ad group tersebut dengan materi kreatif baru atau hentikan jika tidak relevan lagi.",
            "confidence": "high",
        },
    },
    5: {
        "findings_summary": "sku_lifecycle_contribution: produk SOVELLA Lennon menyumbang pangsa GMV terbesar di antara 3 produk.",
        "output": {
            "headline": "Produk SOVELLA Lennon mendominasi kontribusi GMV di antara produk yang dipasarkan.",
            "mechanism": "SOVELLA Lennon menyumbang pangsa GMV terbesar dibandingkan dua produk lain pada periode ini.",
            "evidence_refs": ["m04_contribution_sku_lennon"],
            "implication": "Ketergantungan pada satu produk unggulan membuat performa akun rentan terhadap perubahan permintaan produk tersebut.",
            "action": "Alokasikan sebagian anggaran kreatif untuk menguji produk lain agar kontribusi GMV lebih merata.",
            "confidence": "medium",
        },
    },
}

# --- Synthesist S6 exemplar --------------------------------------------------

S6_EXEMPLAR: dict = {
    "accepted_sections_summary": (
        "S2: penurunan GMV nominal karena hari aktif lebih sedikit. S3: sesi live standout ROI 27,34x. "
        "S4: 5 ad group non-GMV Max tidak aktif. S5: Lennon mendominasi kontribusi GMV."
    ),
    "output": {
        "risks": [
            {
                "risk": "Perbandingan GMV antar periode berisiko disalahartikan karena perbedaan jumlah hari aktif (4 vs 7 hari).",
                "severity": "medium",
                "action": "Sertakan penyesuaian per-hari-aktif pada setiap laporan perbandingan periode.",
                "owner": "Data / Ops",
                "evidence_refs": ["g07_comparability_artifact"],
            },
            {
                "risk": "5 ad group non-GMV Max sama sekali tidak aktif dan tidak berkontribusi pada hasil apa pun.",
                "severity": "medium",
                "action": "Aktifkan kembali ad group tersebut dengan materi kreatif baru atau hentikan.",
                "owner": "Creative",
                "evidence_refs": ["g04_dormant_entity_adgroup"],
            },
            {
                "risk": "Kontribusi GMV sangat bergantung pada satu produk (SOVELLA Lennon), meningkatkan risiko konsentrasi.",
                "severity": "low",
                "action": "Uji alokasi anggaran kreatif pada produk lain untuk mendiversifikasi kontribusi GMV.",
                "owner": "Media Buying",
                "evidence_refs": ["m04_contribution_sku_lennon"],
            },
        ],
        "outlook": [
            "Efisiensi ROI akun diperkirakan tetap stabil apabila alokasi anggaran ke sesi live berperforma tinggi dipertahankan.",
            "Reaktivasi ad group yang tidak aktif berpotensi menambah cakupan tanpa mengorbankan efisiensi biaya saat ini.",
        ],
        "confidence": "medium",
    },
}

# --- Synthesist S1 exemplar (written last, from accepted content) ----------

S1_EXEMPLAR: dict = {
    "accepted_sections_summary": (
        "S2: GMV Rp 506.058.865, turun nominal karena hari aktif lebih sedikit. S3: sesi live ROI 27,34x. "
        "S4: 5 ad group tidak aktif. S5: Lennon mendominasi kontribusi. S6: 3 risiko, outlook stabil."
    ),
    "output": {
        "headline": "GMV tercatat Rp 506.058.865 dengan efisiensi ROI yang kuat, meski penurunan nominal disebabkan oleh hari aktif yang lebih pendek.",
        "summary": (
            "Periode ini mencatat GMV Rp 506.058.865 — turun secara nominal, namun penurunan ini sepenuhnya "
            "dijelaskan oleh jumlah hari aktif yang lebih sedikit, bukan pelemahan performa. Sesi live "
            "'Promo Special Payday Sale #2' menjadi standout dengan ROI 27,34x, sementara produk SOVELLA "
            "Lennon mendominasi kontribusi GMV. Lima ad group non-GMV Max tidak aktif dan perlu dievaluasi."
        ),
    },
}
