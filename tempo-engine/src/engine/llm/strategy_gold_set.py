"""Strategy Report gold set (PRD §8.5 rule 3): one exemplar per narrated
section, plus one for the Action Phraser and one for the T1 verdict, written
by hand in the register of the BARDI mock.

Every number here is deliberately different from any real client's figures,
so an exemplar copied into a live draft is caught by the numeral gate instead
of slipping through as a plausible value. The brand is `BRAND`, the same
placeholder the name tokenizer substitutes for the real client.
"""

from __future__ import annotations

from engine.contracts.strategy import StrategySectionId as T

SECTION_EXEMPLARS: dict[int, dict] = {
    int(T.T3_FUNNEL): {
        "table": (
            "f_leak | STAGE_LEAK | turun | tinggi | Ukuran tahap Conversion hanya 3,10% dari tahap Consideration, sedangkan rata-rata Top 10 11,40% — selisih 8,30 poin. Saat ini 84.200 orang ada di Consideration dan 2.610 di Conversion.\n"
            "f_off | STAGE_INFLOW_OFFSET | turun | sedang | Dalam 28 hari, 51.300 orang masuk tahap Consideration dan 49.800 keluar: 97,1% audiens baru tertutup oleh yang keluar, sehingga bersihnya 1.500 orang."
        ),
        "output": {
            "headline": "Funnel BRAND bocor paling besar antara Consideration dan Conversion.",
            "paragraphs": [
                {
                    "text": "Ukuran tahap Conversion hanya 3,10% dari Consideration, jauh di bawah rata-rata Top 10 sebesar 11,40%. Dari 84.200 orang di Consideration, baru 2.610 yang tercatat di Conversion.",
                    "evidence_refs": ["f_leak"],
                },
                {
                    "text": "Tahap Consideration juga nyaris tidak bertambah: 51.300 orang masuk dalam 28 hari, tetapi 49.800 keluar, sehingga 97,1% audiens baru langsung tergantikan.",
                    "evidence_refs": ["f_off"],
                },
            ],
            "implication": "Menambah jangkauan di atas funnel tidak akan menambah pembeli selama tahap Consideration terus kehilangan audiens secepat ia mendapatkannya.",
        },
    },
    int(T.T4_SPEND): {
        "table": "f_sat | SPEND_RESPONSE_DIMINISHING | turun | sedang | Di atas Rp2.400.000/hari, biaya per seribu audiens baru Consideration naik dari Rp96.000 ke Rp171.000; 9 dari 56 hari belanja berada di atas titik jenuh.",
        "output": {
            "headline": "Belanja harian di atas Rp2.400.000 tidak lagi efisien.",
            "paragraphs": [
                {
                    "text": "Hingga Rp2.400.000 per hari, setiap seribu audiens baru Consideration berbiaya sekitar Rp96.000. Di atas batas itu biayanya naik menjadi Rp171.000, dan 9 dari 56 hari belanja sudah melewatinya.",
                    "evidence_refs": ["f_sat"],
                }
            ],
            "implication": "Anggaran pada hari-hari puncak membeli audiens yang jauh lebih mahal daripada hari biasa.",
        },
    },
    int(T.T5_PACE): {
        "table": "f_goal | GOAL_OFF_TRACK | turun | sedang | Peringkat Consideration saat ini #31 dengan target #20 pada 31 Desember; laju saat ini 0,40 peringkat per minggu, sedangkan yang dibutuhkan 1,10 per minggu.",
        "output": {
            "headline": "Target peringkat #20 belum terkejar dengan laju saat ini.",
            "paragraphs": [
                {
                    "text": "BRAND berada di peringkat #31 di tahap Consideration. Untuk mencapai #20 pada 31 Desember dibutuhkan kenaikan 1,10 peringkat per minggu, sedangkan laju saat ini baru 0,40.",
                    "evidence_refs": ["f_goal"],
                }
            ],
            "implication": "Tanpa perubahan, target akan terlewat dan perlu dijadwalkan ulang atau didukung tindakan tambahan.",
        },
    },
    int(T.T6_CLASS): {
        "table": (
            "f_sov | SOV_LOSING | turun | tinggi | Pangsa impresi BRAND di kategori turun dari 2,40% ke 1,85% dibanding periode sebelumnya.\n"
            "f_rank | RANK_MOVED | turun | tinggi | Peringkat Awareness BRAND turun dari #9 ke #13 dalam 7 hari."
        ),
        "output": {
            "headline": "BRAND kehilangan pangsa impresi di kategorinya.",
            "paragraphs": [
                {
                    "text": "Pangsa impresi BRAND turun dari 2,40% menjadi 1,85% dibanding periode sebelumnya, sementara peringkat Awareness bergeser dari #9 ke #13 hanya dalam 7 hari.",
                    "evidence_refs": ["f_sov", "f_rank"],
                }
            ],
            "implication": "Pesaing sedang mengisi ruang yang ditinggalkan BRAND di bagian atas funnel.",
        },
    },
    int(T.T7_CONTENT): {
        "table": "f_mix | CONTENT_MIX_PAID_HEAVY | turun | tinggi | 78,5% impresi yang menyebut BRAND berasal dari konten berbayar; rata-rata Top 10 52,0%. Setiap impresi berbayar menghasilkan 0,12 impresi gratis, sedangkan Top 10 0,81.",
        "output": {
            "headline": "Jangkauan BRAND hampir seluruhnya dibeli.",
            "paragraphs": [
                {
                    "text": "Sebanyak 78,5% impresi yang menyebut BRAND berasal dari konten berbayar, jauh di atas rata-rata Top 10 sebesar 52,0%. Setiap impresi berbayar hanya menghasilkan 0,12 impresi gratis, sementara Top 10 mendapatkan 0,81.",
                    "evidence_refs": ["f_mix"],
                }
            ],
            "implication": "Begitu belanja berhenti, hampir seluruh jangkauan ikut berhenti karena konten organik belum menopangnya.",
        },
    },
}

ACTION_EXEMPLAR = {
    "table": (
        "act_01 | content_mix | frasa: \"Naikkan porsi impresi\" | saat ini 6,2% | target 14,2% | 8 minggu | gagal jika: Porsi impresi dari konten merek organik tidak naik dalam 14 hari.\n"
        "  draf langkah: Naikkan porsi impresi dari konten merek organik dari 6,2% → 14,2% dalam 8 minggu.\n"
        "  fakta: Rata-rata Top 10 21,0%; BRAND 6,2%. Setiap impresi berbayar menghasilkan 0,12 impresi gratis."
    ),
    "output": {
        "items": [
            {
                "id": "act_01",
                "langkah": "Naikkan porsi impresi dari konten merek organik dari 6,2% → 14,2% dalam 8 minggu.",
                "dasar": "Konten merek organik baru menyumbang 6,2% impresi BRAND, sedangkan rata-rata Top 10 mencapai 21,0%, dan setiap impresi berbayar saat ini hanya menghasilkan 0,12 impresi gratis.",
                "cara": "Terbitkan dua video merek organik per minggu yang memakai format terlaris kategori, lalu ukur porsinya setiap Senin.",
                "gagal_jika": "Porsi impresi dari konten merek organik tidak naik dalam 14 hari.",
            }
        ]
    },
}

VERDICT_EXEMPLAR = {
    "input": (
        "Judul bagian: Funnel BRAND bocor paling besar antara Consideration dan Conversion. | Belanja harian di atas Rp2.400.000 tidak lagi efisien. | Target peringkat #20 belum terkejar dengan laju saat ini.\n"
        "Langkah: Naikkan ukuran tahap Conversion dari 3,10% → 8,10% ukuran tahap Consideration dalam 6 minggu.\n"
        "Chip wajib: Hambatan = Consideration → Conversion (critical, f_leak) | Efisiensi belanja = Melewati titik jenuh (watch, f_sat) | Laju target = #31 → target #20 (off_track, f_goal)"
    ),
    "output": {
        "headline": "BRAND kehilangan calon pembeli di tahap Consideration.",
        "paragraph": "Hambatan terbesar ada di perpindahan Consideration ke Conversion, sementara belanja di atas Rp2.400.000 per hari sudah tidak efisien. Prioritas minggu ini adalah menaikkan ukuran tahap Conversion dari 3,10% ke 8,10% dalam 6 minggu.",
        "chips": [
            {"label": "Hambatan", "value": "Consideration → Conversion", "status": "critical", "finding_id": "f_leak"},
            {"label": "Efisiensi belanja", "value": "Melewati titik jenuh", "status": "watch", "finding_id": "f_sat"},
            {"label": "Laju target", "value": "#31 → target #20", "status": "off_track", "finding_id": "f_goal"},
        ],
    },
}
