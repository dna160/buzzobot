"""Generic-sentence detector (Strategy Report PRD §11.3).

Two tests on a paragraph:
1. **Banned filler.** Phrases that carry no information in an Indonesian
   marketing report, whatever the numbers around them.
2. **No entity, no number.** A paragraph that names no stage, brand,
   competitor or metric and contains no numeral could be pasted into any
   client's report unchanged.

Used as a soft gate by the full-tier agents (a flagged draft is retried) and
by `eval/generic_detector.py` for the exit-gate tally.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

BANNED_PHRASES = (
    "secara signifikan",
    "perlu diperhatikan",
    "dapat disimpulkan",
    "di era digital",
    "tidak dapat dipungkiri",
    "sangat penting untuk",
    "hal ini menunjukkan bahwa",
    "optimalkan lebih lanjut",
    "terus pantau",
    "perlu terus dipantau",
    "memiliki potensi besar",
    "dalam rangka meningkatkan",
    "strategi yang tepat",
    "langkah strategis",
)

ENTITY_TERMS = (
    "awareness", "consideration", "conversion", "acc", "funnel", "tahap",
    "impresi", "interaksi", "tontonan", "pencarian", "klik", "kartu produk", "sentimen",
    "belanja", "anggaran", "peringkat", "pangsa", "kategori", "top 10", "pesaing",
    "konten", "kreator", "iklan", "target", "audiens", "tindakan",
)

_HAS_DIGIT = re.compile(r"\d")
# A critic or narrator commenting on its own text: "(bukan 'jauh di bawah')".
# A single quote only counts after a space, so a name like "Kiehl's" is not a quotation.
_META = re.compile(r"\((?:bukan|catatan|note)\b|[\"“‘][^\"“”‘’]{2,40}[\"”’]|(?:^|\s)'[^']{2,40}'", re.IGNORECASE)


def banned_in(text: str) -> list[str]:
    low = text.lower()
    return [p for p in BANNED_PHRASES if p in low]


def is_generic_paragraph(text: str, names: Iterable[str] = ()) -> bool:
    if _HAS_DIGIT.search(text):
        return False
    low = text.lower()
    terms = [*ENTITY_TERMS, *(n.lower() for n in names if n)]
    return not any(t in low for t in terms)


def generic_problems(paragraphs: Iterable[str], names: Iterable[str] = ()) -> list[str]:
    names = list(names)
    problems: list[str] = []
    for i, text in enumerate(paragraphs, start=1):
        for phrase in banned_in(text):
            problems.append(f"paragraf {i} memakai frasa umum {phrase!r}")
        if _META.search(text):
            problems.append(f"paragraf {i} memuat kutipan atau catatan tentang teks")
        if is_generic_paragraph(text, names):
            problems.append(f"paragraf {i} tidak menyebut tahap, metrik, merek, atau angka apa pun")
    return problems
