"""Strategy Report prompts and response schemas (PRD §8.3, §8.5).

Rules the prompts encode:
1. Job, language (formal Bahasa Indonesia), forbidden moves, and the output
   shape in prose. System prompts stay under the 900-token budget.
2. The payload is a compact table, one line per finding
   (`id | klaim | arah | keyakinan | fakta`), not JSON. The `fakta` column is
   the deterministic sentence the instant tier would print, so every number
   the model sees is already formatted the way the report formats it.
3. One exemplar per call from `strategy_gold_set.py`.
4. The Action Phraser gets the approved phrasing and the hard rule that
   `langkah` carries the current value, the target and the horizon verbatim.
5. The synthesist gets accepted headlines, `langkah` lines and the chips it
   must reproduce, never raw findings.

Response schemas list the routed finding ids as an `enum`, so LM Studio's
grammar-constrained decoding cannot cite a finding the narrator never saw.
"""

from __future__ import annotations

import json

from engine.contracts import Finding
from engine.contracts.strategy import ActionItem, StrategyFrame, StrategySectionId, VerdictChip
from engine.copy.strategy import finding_sentence
from engine.llm.strategy_gold_set import ACTION_EXEMPLAR, SECTION_EXEMPLARS, VERDICT_EXEMPLAR
from engine.llm.tokenize import NameTokenizer

T = StrategySectionId

_COMMON = """You write one part of a weekly TikTok strategy report for a brand manager in Indonesia. Write in formal, plain Bahasa Indonesia (avoid English loanwords where a common Indonesian word exists; keep TikTok stage names Awareness, Consideration, Conversion as they are).

HARD RULES (checked by code; one violation rejects the whole answer):
1. Output ONLY the JSON object for the required schema.
2. Every number you write must appear in the table you are given, written the same way (Indonesian format: "4,47%", "129.600", "Rp1.600.000", "#38"). Rounding to fewer decimals is allowed; computing a new number is not. If you need a number you were not given, use words instead.
3. Write only about the rows in the table. Every paragraph cites the row ids it uses in `evidence_refs`.
4. The brand is written exactly as BRAND. Competitor names are written exactly as given.
5. No filler ("secara signifikan", "perlu diperhatikan", "dapat disimpulkan", "di era digital"), no hedging ("mungkin", "sepertinya") unless the row's keyakinan is rendah.
6. No quotation marks, brackets with remarks, or notes about the text itself.

GLOSSARY: "audiens keluar" = people leaving a stage (never "pengeluaran", which means spending). "bersih" = net change over the window, not the stage total. "ukuran tahap X dari tahap Y" = size ratio between two stage totals, not a conversion rate. "Top 10" = average of the category's top 10 brands."""

SECTION_JOB = {
    T.T3_FUNNEL: "Section: Funnel dibanding kategori. Explain where the funnel leaks against the Top 10 average and whether new audience is being cancelled out by audience leaving. Lead with the biggest gap.",
    T.T4_SPEND: "Section: Respons belanja. Explain what extra daily spend buys in new audience: still rising, saturated past a limit, or not moving with spend at all. Never claim spend caused a change the table does not state.",
    T.T5_PACE: "Section: Laju menuju target. Say where the brand is against its goal, the pace needed versus the current pace, and the projection. If there is no goal, say so plainly.",
    T.T6_CLASS: "Section: Sorotan kelas laporan. For a brand-class report focus on share of category, rank and competitors; for a shop-class report focus on conversion and product-card clicks.",
    T.T7_CONTENT: "Section: Komposisi konten. Explain how much of the brand's reach is paid versus earned, which content types are under the Top 10 average, and what one paid impression earns in free impressions.",
    T.T8_WARNINGS: "Section: Sinyal peringatan. List what moved enough to watch, in one short paragraph per signal.",
}

SECTION_SYSTEM_TAIL = """
This is a narrator section: describe and interpret, do NOT recommend actions (the action list is written elsewhere).
Output shape: `headline` (one concrete sentence, max 200 characters, naming the stage/metric and direction), `paragraphs` (1–3, each 1–3 sentences, each with the ids it uses), `implication` (one sentence on what it means for the business, or null if keyakinan is rendah for every row)."""

CRITIC_SYSTEM = _COMMON + """

You are the critic. You receive a draft section and the table it was written from. Check: (a) every number is in the table; (b) every sentence is supported by the rows it cites; (c) no recommendation or instruction appears; (d) the headline is concrete (stage or metric plus direction), not generic; (e) no filler phrases.
If the draft passes, return approved=true and the draft unchanged. Otherwise return approved=false, a short note, and a corrected draft in `revised_draft`. A correction rewrites or removes only the offending sentence; it never adds a claim, a number, a quotation or a remark about the draft."""

ACTION_SYSTEM = _COMMON + """

You are the Action Phraser. For each action you receive the solver's numbers, the approved opening phrase, a draft and supporting facts. Write four fields per action:
- `langkah`: one sentence that STARTS with the approved phrase and contains the current value, the target value and the time frame exactly as given ("dalam N minggu"). Setiap `langkah` wajib memuat nilai saat ini, nilai target, dan jangka waktu persis seperti di payload. No other number in `langkah`.
- `dasar`: one or two sentences on why, using only the facts given.
- `cara`: one or two concrete steps the team can do this week. No new numbers unless given.
- `gagal_jika`: the failure condition exactly as given, including its number of days.
Keep the action ids and their order."""

ACTION_CRITIC_SYSTEM = _COMMON + """

You are the action critic. Check each action: `langkah` starts with the approved phrase and contains the current value, the target and the time frame and no other number; `dasar` uses only given facts; `cara` is concrete and doable this week; `gagal_jika` keeps its number of days. Return approved=true and the actions unchanged if all pass; otherwise approved=false, a short note and corrected `items`."""

VERDICT_SYSTEM = _COMMON + """

You write the verdict at the top of the report (T1). You receive the accepted section headlines, the action lines and three chips that are computed by code.
- `headline`: one sentence, max 120 characters, the single most important finding for this week.
- `paragraph`: two or three sentences joining the main finding to the first action. Use only numbers present in the headlines and action lines.
- `chips`: exactly the three chips given, in the same order, with the same `label`, `value`, `status` and `finding_id`."""


def table_line(f: Finding, brand: str) -> str:
    conf = {"high": "tinggi", "medium": "sedang", "low": "rendah"}.get(str(f.confidence.value), str(f.confidence.value))
    caveat = f" (catatan: {'; '.join(f.caveats[:2])})" if f.caveats else ""
    return f"{f.id} | {f.claim_frame} | {f.direction.value} | {conf} | {finding_sentence(f, brand)}{caveat}"


def section_table(findings: list[Finding], brand: str) -> str:
    return "\n".join(table_line(f, brand) for f in findings)


def header_line(frame: StrategyFrame) -> str:
    cls = frame.classification.report_class
    plan = "lite" if frame.is_lite else (frame.plan or "full")
    return (
        f"# ringkas: {frame.brand_name} ({cls}) · {frame.current_start.isoformat()}→{frame.as_of.isoformat()} "
        f"vs periode sebelumnya · benchmark {frame.benchmark} · paket {plan}"
    )


def build_section_messages(
    sid: StrategySectionId, findings: list[Finding], frame: StrategyFrame, tok: NameTokenizer, *, violations: list[str] | None = None
) -> tuple[str, str]:
    system = f"{_COMMON}\n\n{SECTION_JOB[sid]}\n{SECTION_SYSTEM_TAIL}"
    ex = SECTION_EXEMPLARS.get(int(sid))
    parts = []
    if ex:
        parts.append(
            "CONTOH (angka contoh, jangan dipakai):\nTabel:\nid | klaim | arah | keyakinan | fakta\n"
            f"{ex['table']}\nJawaban:\n{json.dumps(ex['output'], ensure_ascii=False)}\n"
        )
    parts.append(f"{header_line(frame)}\nid | klaim | arah | keyakinan | fakta\n{section_table(findings, frame.brand_name)}")
    parts.append("Tulis bagian ini dari tabel di atas. Hanya angka dari tabel.")
    if violations:
        parts.append("Jawaban sebelumnya DITOLAK karena: " + "; ".join(violations) + ". Perbaiki tanpa menambah angka baru.")
    return tok.encode(system), tok.encode("\n\n".join(parts))


def build_critic_messages(draft: dict, findings: list[Finding], frame: StrategyFrame, tok: NameTokenizer) -> tuple[str, str]:
    user = (
        f"{header_line(frame)}\nid | klaim | arah | keyakinan | fakta\n{section_table(findings, frame.brand_name)}\n\n"
        f"DRAF:\n{json.dumps(draft, ensure_ascii=False)}"
    )
    return tok.encode(CRITIC_SYSTEM), tok.encode(user)


def action_block(a: ActionItem, phrase: str, current: str, target: str, facts: str) -> str:
    weeks = a.horizon_days / 7
    horizon = "-" if a.lever == "investigate" else f"{weeks:g} minggu" if weeks == int(weeks) else f"{a.horizon_days} hari"
    copy = a.copy_
    head = (
        f"{a.id} | {a.lever} | frasa: \"{phrase}\" | saat ini {current} | target {target} | {horizon} | "
        f"gagal jika: {copy.gagal_jika if copy else '-'}"
    )
    return f"{head}\n  draf langkah: {copy.langkah if copy else '-'}\n  fakta: {facts}"


def build_action_messages(blocks: list[str], frame: StrategyFrame, tok: NameTokenizer, *, violations: list[str] | None = None) -> tuple[str, str]:
    parts = [
        "CONTOH (angka contoh, jangan dipakai):\n" + ACTION_EXEMPLAR["table"] + "\nJawaban:\n" + json.dumps(ACTION_EXEMPLAR["output"], ensure_ascii=False),
        f"{header_line(frame)}\nTINDAKAN:\n" + "\n".join(blocks),
        "Tulis keempat kolom untuk setiap tindakan.",
    ]
    if violations:
        parts.append("Jawaban sebelumnya DITOLAK karena: " + "; ".join(violations) + ". Perbaiki.")
    return tok.encode(ACTION_SYSTEM), tok.encode("\n\n".join(parts))


def build_action_critic_messages(items: list[dict], blocks: list[str], frame: StrategyFrame, tok: NameTokenizer) -> tuple[str, str]:
    user = f"{header_line(frame)}\nTINDAKAN:\n" + "\n".join(blocks) + f"\n\nDRAF:\n{json.dumps({'items': items}, ensure_ascii=False)}"
    return tok.encode(ACTION_CRITIC_SYSTEM), tok.encode(user)


CLASS_LEAD = {
    "brand": "laporan kelas brand — buka dengan pangsa kategori, peringkat, atau pesaing",
    "shop": "laporan kelas shop — buka dengan perpindahan ke Conversion",
}


def chip_line(chips: list[VerdictChip]) -> str:
    return " | ".join(f"{c.label} = {c.value} ({c.status}, {c.finding_id or 'null'})" for c in chips)


def build_verdict_messages(
    headlines: list[str], langkah: list[str], chips: list[VerdictChip], confidence: str, frame: StrategyFrame, tok: NameTokenizer,
    *, violations: list[str] | None = None,
) -> tuple[str, str]:
    parts = [
        "CONTOH (angka contoh, jangan dipakai):\n" + VERDICT_EXEMPLAR["input"] + "\nJawaban:\n" + json.dumps(VERDICT_EXEMPLAR["output"], ensure_ascii=False),
        f"{header_line(frame)}\nKeyakinan data: {confidence}\nFokus: {CLASS_LEAD[frame.classification.report_class]}\nJudul bagian: " + " | ".join(headlines)
        + "\nLangkah: " + (" | ".join(langkah) or "-") + "\nChip wajib: " + chip_line(chips),
        "Tulis vonis minggu ini.",
    ]
    if violations:
        parts.append("Jawaban sebelumnya DITOLAK karena: " + "; ".join(violations) + ". Perbaiki.")
    return tok.encode(VERDICT_SYSTEM), tok.encode("\n\n".join(parts))


# ─── Response schemas (strict json_schema) ───────────────────────────────────


def _ids(ids: list[str]) -> dict:
    return {"type": "string", "enum": ids}


def section_schema(ids: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "headline": {"type": "string", "minLength": 10, "maxLength": 200},
            "paragraphs": {
                "type": "array",
                "minItems": 1,
                "maxItems": 3,
                "items": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "minLength": 10, "maxLength": 900},
                        "evidence_refs": {"type": "array", "minItems": 1, "maxItems": 5, "items": _ids(ids)},
                    },
                    "required": ["text", "evidence_refs"],
                    "additionalProperties": False,
                },
            },
            "implication": {"type": ["string", "null"], "maxLength": 500},
        },
        "required": ["headline", "paragraphs", "implication"],
        "additionalProperties": False,
    }


def critic_schema(inner: dict) -> dict:
    return {
        "type": "object",
        "properties": {
            "approved": {"type": "boolean"},
            "notes": {"type": "string", "maxLength": 300},
            "revised_draft": inner,
        },
        "required": ["approved", "notes", "revised_draft"],
        "additionalProperties": False,
    }


def action_schema(ids: list[str]) -> dict:
    item = {
        "type": "object",
        "properties": {
            "id": _ids(ids),
            "langkah": {"type": "string", "minLength": 10, "maxLength": 300},
            "dasar": {"type": "string", "minLength": 10, "maxLength": 500},
            "cara": {"type": "string", "minLength": 10, "maxLength": 500},
            "gagal_jika": {"type": "string", "minLength": 5, "maxLength": 300},
        },
        "required": ["id", "langkah", "dasar", "cara", "gagal_jika"],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {"items": {"type": "array", "minItems": len(ids), "maxItems": len(ids), "items": item}},
        "required": ["items"],
        "additionalProperties": False,
    }


def action_critic_schema(ids: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "approved": {"type": "boolean"},
            "notes": {"type": "string", "maxLength": 300},
            "items": action_schema(ids)["properties"]["items"],
        },
        "required": ["approved", "notes", "items"],
        "additionalProperties": False,
    }


def verdict_schema(finding_ids: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "headline": {"type": "string", "minLength": 10, "maxLength": 120},
            "paragraph": {"type": "string", "minLength": 20, "maxLength": 900},
            "chips": {
                "type": "array",
                "minItems": 3,
                "maxItems": 3,
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string", "minLength": 1, "maxLength": 40},
                        "value": {"type": "string", "minLength": 1, "maxLength": 80},
                        "status": {"type": "string", "enum": ["critical", "watch", "good", "off_track", "on_track", "unknown"]},
                        "finding_id": {"anyOf": [_ids(finding_ids), {"type": "null"}]} if finding_ids else {"type": "null"},
                    },
                    "required": ["label", "value", "status", "finding_id"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["headline", "paragraph", "chips"],
        "additionalProperties": False,
    }
