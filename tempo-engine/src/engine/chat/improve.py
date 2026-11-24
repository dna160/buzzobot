"""Improvement answers grounded in the report scaffolding, not the chat model's
own reasoning.

Two sources, both deterministic on the chat side:

- `format_saved_report`: the client's latest *approved* engine report
  (Strategy Report, GMV / Awareness / Install brief) as stored in
  `insight.brief` — written by the report agents (narrator, critic,
  synthesist, action phraser) and approved by a reviewer, with the reviewer's
  edits already applied. Chat quotes it; it never re-runs those agents.
- `run_diagnostics` + `format_diagnostics`: the brief's own generator battery
  (G01–G08 plus M01–M04 / A01–A04 / N01–N04 by north star), materiality
  scoring and template copy — exactly the instant tier's path
  (`graphs/brief.py`), with no model call. It covers every client with ads
  data, including the ones without TikTok Market Scope.
"""

from __future__ import annotations

from dataclasses import dataclass

from engine.chat.data import SavedReport
from engine.contracts import Finding, MetricFrame
from engine.contracts.presets import OBJECTIVE_CONTRACTS
from engine.copy.templates import action_for, headline_for, mechanism_for
from engine.generators.base import GeneratorContext
from engine.graphs.brief import GENERATORS_BY_BRIEF_TYPE
from engine.graphs.coverage import build_coverage_audit
from engine.materiality import score_findings

BRIEF_FOR_NORTH_STAR = {"shop": "gmv", "vtr": "awareness", "app_install": "install"}
BRIEF_LABEL = {
    "strategy": "Strategy Report",
    "gmv": "GMV Brief",
    "awareness": "Awareness Brief",
    "install": "Install Brief",
}
ACTIONABILITY = {"high": "tinggi", "medium": "sedang", "low": "rendah"}
CONFIDENCE = {"high": "tinggi", "medium": "sedang", "low": "rendah"}
SEVERITY = {"high": "tinggi", "medium": "sedang", "low": "rendah", "critical": "kritis"}
#: A report older than this is flagged as possibly stale in the tool output.
STALE_DAYS = 14


def _s(v: object) -> str:
    return v.strip() if isinstance(v, str) else ""


def _draft(entry: object) -> dict:
    if isinstance(entry, dict) and isinstance(entry.get("draft"), dict):
        return entry["draft"]
    return {}


# ─── Saved reports ───────────────────────────────────────────────────────────


def _strategy_lines(c: dict) -> list[str]:
    out: list[str] = []
    sections = c.get("sections") or {}
    order = [str(s) for s in ((c.get("meta") or {}).get("section_order") or sorted(sections))]
    for sid in order:
        d = _draft(sections.get(sid))
        if not d:
            continue
        head = _s(d.get("headline"))
        if head:
            out.append(f"- {head}")
        para = _s(d.get("paragraph"))
        if para:
            out.append(f"  {para}")
        for p in d.get("paragraphs") or []:
            text = _s(p.get("text")) if isinstance(p, dict) else _s(p)
            if text:
                out.append(f"  {text}")
        imp = _s(d.get("implication"))
        if imp:
            out.append(f"  Implikasi: {imp}")
    actions = c.get("action_plan") or []
    if actions:
        out.append("Rencana tindakan (dari Target Solver, ditulis agen & disetujui reviewer):")
        for a in actions:
            copy = a.get("copy") or {}
            line = f"{a.get('rank', '·')}. {_s(copy.get('langkah'))}"
            for key, label in (("cara", "Cara"), ("dasar", "Dasar"), ("gagal_jika", "Gagal jika")):
                if _s(copy.get(key)):
                    line += f" {label}: {_s(copy.get(key))}"
            out.append(line)
    return out


def _brief_lines(c: dict) -> list[str]:
    out: list[str] = []
    s1 = _draft(c.get("s1"))
    if _s(s1.get("headline")):
        out.append(f"Ringkasan: {_s(s1.get('headline'))}")
    if _s(s1.get("summary")):
        out.append(f"  {_s(s1.get('summary'))}")
    sections = c.get("sections") or {}
    for sid in sorted(sections, key=lambda k: int(k) if str(k).isdigit() else 99):
        d = _draft(sections.get(sid))
        head = _s(d.get("headline"))
        if not head or head.lower().startswith("tidak ada temuan"):
            continue
        out.append(f"- {head}")
        if _s(d.get("mechanism")):
            out.append(f"  Mekanisme: {_s(d.get('mechanism'))}")
        if _s(d.get("action")):
            out.append(f"  Tindakan: {_s(d.get('action'))}")
    s6 = _draft(c.get("s6"))
    risks = s6.get("risks") or []
    if risks:
        out.append("Risiko & tindakan:")
        for r in risks:
            sev = SEVERITY.get(_s(r.get("severity")), _s(r.get("severity")))
            out.append(
                f"- [{sev}] {_s(r.get('risk'))} Tindakan: {_s(r.get('action'))}"
                + (f" (pemilik: {_s(r.get('owner'))})" if _s(r.get("owner")) else "")
            )
    for o in s6.get("outlook") or []:
        if _s(o):
            out.append(f"- Prospek: {_s(o)}")
    return out


def format_saved_report(r: SavedReport, client_name: str, today_iso: str) -> str:
    c = r.content
    meta = c.get("meta") or {}
    when = r.updated_at.date().isoformat() if r.updated_at else "—"
    window = (
        f" · periode {meta['window_start']} s.d. {meta['window_end']}"
        if meta.get("window_start") and meta.get("window_end")
        else ""
    )
    tier = c.get("tier") or r.tier or "—"
    head = (
        f"{BRIEF_LABEL.get(r.brief_type, r.brief_type)} {client_name} yang sudah disetujui · dibuat {when}"
        f"{window} · tier {tier}."
    )
    if r.updated_at:
        from datetime import date

        age = (date.fromisoformat(today_iso) - r.updated_at.date()).days
        if age > STALE_DAYS:
            head += f" Laporan ini berumur {age} hari — sebutkan bahwa datanya mungkin sudah tidak terkini."
    body = _strategy_lines(c) if r.brief_type == "strategy" else _brief_lines(c)
    if not body:
        body = ["(Laporan tidak memuat bagian teks yang bisa dikutip.)"]
    return "\n".join([head, *body])


# ─── Live diagnostics (the brief's generator battery, no LLM) ────────────────


@dataclass(frozen=True)
class Diagnostics:
    brief_type: str
    findings: list[Finding]  # scored, most material first
    assessed_confidence: str
    skipped: list[tuple[str, str]]  # (generator, reason)


def run_diagnostics(frame: MetricFrame, brief_type: str) -> Diagnostics:
    """The instant tier's generator fan-out + materiality scoring, verbatim
    (`graphs/brief.py` `generator_fanout_node` / `materiality_router_node`)."""
    ctx = GeneratorContext(metric_frame=frame, objective_contract=OBJECTIVE_CONTRACTS[brief_type])  # type: ignore[index]
    results = [g.run(ctx) for g in GENERATORS_BY_BRIEF_TYPE[brief_type]]
    findings = [f for r in results for f in r.findings]
    gaps = [r.coverage_gap for r in results if r.coverage_gap is not None]
    scored = score_findings(findings, brief_type)  # type: ignore[arg-type]
    coverage = build_coverage_audit(scored, gaps)
    scored.sort(key=lambda f: f.materiality, reverse=True)
    return Diagnostics(
        brief_type=brief_type,
        findings=scored,
        assessed_confidence=coverage.assessed_confidence or "—",
        skipped=[(g.generator, g.reason) for g in gaps],
    )


def format_diagnostics(d: Diagnostics, client_name: str, frame: MetricFrame, limit: int) -> str:
    cur = frame.current_period
    period = f"{cur.start_date} s.d. {cur.end_date}"
    out = [
        f"Diagnostik perbaikan {client_name} · {BRIEF_LABEL.get(d.brief_type, d.brief_type)} (generator brief, "
        f"tanpa LLM) · {period} · keyakinan cakupan {CONFIDENCE.get(d.assessed_confidence, d.assessed_confidence)}. "
        "Diurutkan menurut materialitas; setiap tindakan berasal dari tabel templat brief."
    ]
    shown = [f for f in d.findings if f.actionability.value != "low"][:limit] or d.findings[:limit]
    if not shown:
        out.append("- Tidak ada temuan yang cukup besar pada periode ini.")
    for i, f in enumerate(shown, start=1):
        out.append(
            f"{i}. {headline_for(f)} (tingkat tindakan {ACTIONABILITY.get(f.actionability.value, f.actionability.value)}, "
            f"keyakinan {CONFIDENCE.get(f.confidence.value, f.confidence.value)})"
        )
        out.append(f"   Bukti: {mechanism_for(f)}")
        out.append(f"   Tindakan: {action_for(f)}")
    if d.skipped:
        names = ", ".join(sorted({g for g, _ in d.skipped}))
        out.append(f"Generator yang dilewati karena data tidak tersedia: {names}.")
    return "\n".join(out)
