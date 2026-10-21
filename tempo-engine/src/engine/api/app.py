"""The review API (PRD §1.1, B6's minimal review surface — living inside
tempo-engine, not apps/web, since touching Tempo's repo is out of scope).

    POST /v1/briefs                {client_slug, brief_type, window_days, tier, auto_approve}  -> run_id, status "running" (returns at once)
    GET  /v1/briefs/{run_id}                                               -> running | pending_review | approved | rejected | failed, content
    POST /v1/briefs/{run_id}/review {decision, notes}                      -> resumes the graph
    POST /v1/briefs/sync           {client_slug, brief_type, window_days, tier}  -> finished, auto-approved brief
    GET  /healthz                                                          -> liveness + last-run stats
    GET  /ui/briefs/{run_id}                                               -> human-readable review page

`tenant_id` is bound the moment a run starts (from the resolved client) and
carried through every downstream call — Hard Rule 6, enforced at this
boundary since it's the first place an external caller's input is trusted.

`/v1/briefs/sync` exists for callers with no review UI of their own (Tempo
LM's brief buttons) — it runs the same graph, including the real
`interrupt()`, and supplies an "approved" decision automatically rather
than skipping the review step. `/v1/briefs` + `/v1/briefs/{run_id}/review`
remain the two-step interface for a real human reviewer.

`POST /v1/briefs` is asynchronous (Strategy Report PRD §13 #1): the row is
written as `running` before the graph starts and the graph runs in a
background task, so a ten-minute full-tier run never holds a request open.
The database handle is a small pool for the same reason — a poll must not
wait behind a background run's query on one shared connection.

`tier` (Brief Deck PRD §5) defaults to `full` here, not to the portal's own
default of `instant`: an existing caller that never heard of tiers keeps
getting exactly the brief it got before, and the surface states its choice
explicitly rather than inheriting one from this file.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import date
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from pydantic import BaseModel

from engine.api.edits import Edit, EditError, ensure_edits_schema
from engine.api.dispatcher import (
    BriefNotFoundError,
    ClientNotEligibleError,
    get_brief_status,
    resume_brief_review,
    run_brief_sync,
    start_brief_run_async,
)
from engine.contracts.content import Tier
from engine.graphs.brief import build_brief_graph
from engine.graphs.persistence import brief_stats, ensure_schema, insight_checkpointer_conninfo, recent_strategy_runs
from engine.llm.client import LmStudioConfig
from engine.materiality.persistence import ensure_schema as ensure_rankings_schema
from engine.ports.tempo_read import create_pool
from engine.version import ENGINE_VERSION

# Windows' event loop (psycopg's async mode needs a selector-based loop;
# uvicorn's own default hard-codes ProactorEventLoop on win32) is NOT fixed
# here — see engine/api/win_loop.py for why a module-level policy change
# doesn't work against uvicorn's loop-factory mechanism, and
# scripts/run_api.py (the actual entry point) for the real fix.

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db_url = os.environ.get("TEMPO_ENGINE_DATABASE_URL")
    if not db_url:
        raise RuntimeError("TEMPO_ENGINE_DATABASE_URL is required (see scripts/bootstrap_engine_role.py)")

    async with AsyncPostgresSaver.from_conn_string(insight_checkpointer_conninfo(db_url)) as checkpointer:
        await checkpointer.setup()
        app.state.graph = build_brief_graph(checkpointer)
        app.state.read_conn = await create_pool(db_url)
        await ensure_schema(app.state.read_conn)
        await ensure_rankings_schema(app.state.read_conn)
        await ensure_edits_schema(app.state.read_conn)
        try:
            yield
        finally:
            await app.state.read_conn.close()


app = FastAPI(title="Tempo Intelligence Engine — Review API", lifespan=lifespan)


class CreateBriefRequest(BaseModel):
    client_slug: str
    brief_type: Literal["gmv", "awareness", "install", "strategy"] = "gmv"
    #: Default 7 days for the deck's briefs, 28 for the Strategy Report (PRD §7.1).
    window_days: int | None = None
    tier: Tier = "full"
    #: Last day of the window. Absent = latest ingested (briefs) / latest settled TTMS day (strategy).
    end_date: date | None = None
    #: Strategy Report only: preview a class without saving an override (PRD §9.4 `class=`).
    report_class: Literal["brand", "shop"] | None = None
    #: Async runs only: supply the review gate's "approved" decision when the
    #: run reaches it, as `/sync` does, so a poller sees `approved` directly.
    auto_approve: bool = False

    def window(self) -> int:
        return self.window_days or (28 if self.brief_type == "strategy" else 7)


class ReviewRequest(BaseModel):
    decision: Literal["approved", "rejected"]
    notes: str = ""
    #: Reviewer text changes applied on approve and recorded in insight.brief_edits.
    edits: list[Edit] = []
    editor: str | None = None


@app.post("/v1/briefs")
async def create_brief(req: CreateBriefRequest, request: Request) -> dict:
    try:
        return await start_brief_run_async(
            graph=request.app.state.graph, read_conn=request.app.state.read_conn,
            client_slug=req.client_slug, brief_type=req.brief_type, window_days=req.window(),
            end_date=req.end_date, tier=req.tier, report_class=req.report_class, auto_approve=req.auto_approve,
        )
    except ClientNotEligibleError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/v1/briefs/sync")
async def create_brief_sync(req: CreateBriefRequest, request: Request) -> dict:
    try:
        return await run_brief_sync(
            graph=request.app.state.graph, read_conn=request.app.state.read_conn,
            client_slug=req.client_slug, brief_type=req.brief_type, window_days=req.window(),
            end_date=req.end_date, tier=req.tier, report_class=req.report_class,
        )
    except ClientNotEligibleError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/healthz")
async def healthz(request: Request) -> dict:
    """Liveness plus the two facts the surface's engine health card needs
    (Brief Deck PRD §7, K6): can the engine still read its own database, and
    what happened on the last run. Never raises — an unreachable database is
    reported as `db: false` with a 200, because a health endpoint that 500s
    tells the card nothing it can render."""
    db_ok = True
    stats: dict = {"briefs_total": 0, "last_run": None}
    strategy: list[dict] = []
    try:
        stats = await brief_stats(request.app.state.read_conn)
        strategy = await recent_strategy_runs(request.app.state.read_conn)
    except Exception as exc:  # noqa: BLE001 - reported, never raised
        db_ok = False
        stats = {"briefs_total": 0, "last_run": None, "error": str(exc)[:200]}
    llm = LmStudioConfig.from_env()
    return {
        "status": "ok" if db_ok else "degraded",
        "engine_version": ENGINE_VERSION,
        "content_version": 2,
        "tiers": ["instant", "full"],
        "probe_loop_enabled": os.environ.get("PROBE_LOOP_ENABLED", "true").strip().lower()
        not in ("false", "0", ""),
        "db": db_ok,
        "brief_types": ["gmv", "awareness", "install", "strategy"],
        "llm": {"base_url": llm.base_url, "model": llm.model, "max_tokens": llm.max_tokens, "concurrency": llm.concurrency},
        "last_strategy_run": strategy[0] if strategy else None,
        "strategy_runs": strategy,
        **stats,
    }


@app.get("/v1/briefs/{run_id}")
async def get_brief(run_id: str, request: Request) -> dict:
    try:
        return await get_brief_status(request.app.state.read_conn, run_id)
    except BriefNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"no brief with run_id {run_id!r}") from exc


@app.post("/v1/briefs/{run_id}/review")
async def review_brief(run_id: str, req: ReviewRequest, request: Request) -> dict:
    try:
        return await resume_brief_review(
            graph=request.app.state.graph, read_conn=request.app.state.read_conn,
            run_id=run_id, decision=req.decision, notes=req.notes, edits=req.edits, editor=req.editor,
        )
    except BriefNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"no brief with run_id {run_id!r}") from exc
    except EditError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/ui/briefs/{run_id}", response_class=HTMLResponse)
async def review_page(run_id: str, request: Request) -> str:
    try:
        brief = await get_brief_status(request.app.state.read_conn, run_id)
    except BriefNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"no brief with run_id {run_id!r}") from exc
    return _render_review_page(brief)


_STRATEGY_TITLES = {
    "101": "T1 — Vonis", "103": "T3 — Funnel", "104": "T4 — Respons belanja", "105": "T5 — Laju target",
    "106": "T6 — Sorotan kelas", "107": "T7 — Komposisi konten", "108": "T8 — Sinyal", "109": "T9 — Log tindakan",
    "110": "Lampiran A",
}


def _render_strategy_review(brief: dict) -> str:
    """Strategy Report review (PRD §11.4): every narrated text is an editable
    field; Approve sends only the fields the reviewer changed, which the engine
    records in insight.brief_edits. Numbers outside the text are not editable."""
    from html import escape

    content = brief["content"] or {}
    meta = content.get("meta") or {}
    sections = content.get("sections") or {}
    pending = brief["status"] == "pending_review"
    ro = "" if pending else "readonly"

    def field(path: str, text: str, rows: int = 3) -> str:
        return f'<textarea data-path="{escape(path)}" data-orig="{escape(text)}" rows="{rows}" {ro}>{escape(text)}</textarea>'

    blocks = []
    for sid in [str(s) for s in meta.get("section_order", [])]:
        entry = sections.get(sid)
        if not entry:
            continue
        d = entry.get("draft") or {}
        parts = [f"<h3>{escape(_STRATEGY_TITLES.get(sid, sid))}</h3>", field(f"sections.{sid}.draft.headline", d.get("headline", ""), 2)]
        if "paragraph" in d:
            parts.append(field(f"sections.{sid}.draft.paragraph", d.get("paragraph", ""), 4))
            parts.append("<p class='meta'>" + " · ".join(escape(f"{c['label']}: {c['value']}") for c in d.get("chips", [])) + "</p>")
        for i, para in enumerate(d.get("paragraphs", [])):
            parts.append(field(f"sections.{sid}.draft.paragraphs.{i}.text", para.get("text", ""), 4))
        if d.get("implication"):
            parts.append(field(f"sections.{sid}.draft.implication", d["implication"], 2))
        parts.append(f"<p class='meta'>source: {escape(str(entry.get('narration_source')))} · attempts: {entry.get('narration_attempts', 0)}</p>")
        blocks.append("<section>" + "".join(parts) + "</section>")
        if sid == "101":
            for j, a in enumerate(content.get("action_plan") or []):
                c = a.get("copy") or {}
                blocks.append(
                    f"<section><h3>T2 — Tindakan {j + 1} ({escape(a.get('lever', ''))})</h3>"
                    + "".join(field(f"action_plan.{j}.copy.{k}", c.get(k, ""), 2) for k in ("langkah", "dasar", "cara", "gagal_jika"))
                    + "</section>"
                )

    ev = meta.get("eval") or {}
    status_note = "" if pending else f"<p><strong>Status: {escape(brief['status'])}</strong> — already reviewed.</p>"
    disabled = "" if pending else "disabled"
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Strategy review — {escape(brief['run_id'])}</title>
<style>body{{font-family:system-ui,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;line-height:1.5}}
section{{border:1px solid #ddd;border-radius:8px;padding:1rem;margin:1rem 0}}
textarea{{width:100%;font:inherit;border:1px solid #ccc;border-radius:6px;padding:.4rem;margin:.25rem 0}}
textarea.changed{{border-color:#c80;background:#fffaf0}}
.meta{{color:#888;font-size:.85em}}
button{{padding:.5rem 1.2rem;margin-right:.5rem;border-radius:6px;border:1px solid #ccc;cursor:pointer}}
</style></head>
<body>
<h1>{escape(meta.get('brand_name', brief['run_id']))} — Strategy Report</h1>
<p class="meta">tier: {escape(str(content.get('tier')))} · class: {escape(str((content.get('report_class') or {}).get('report_class')))} · window: {escape(str(meta.get('window_start')))} → {escape(str(meta.get('window_end')))} · run_id: {escape(brief['run_id'])}
· degraded: {escape(', '.join(meta.get('degraded') or []) or '—')} · {escape(str(ev.get('duration_s', '—')))} s</p>
{status_note}
<p class="meta">Edit any text before approving; changed fields are highlighted and recorded. Numbers come from the engine — change wording, not findings.</p>
{''.join(blocks)}
<button type="button" onclick="review('approved')" {disabled}>Approve</button>
<button type="button" onclick="review('rejected')" {disabled}>Reject</button>
<script>
document.querySelectorAll('textarea[data-path]').forEach(t => t.addEventListener('input', () => t.classList.toggle('changed', t.value !== t.dataset.orig)));
async function review(decision) {{
  const edits = [...document.querySelectorAll('textarea[data-path]')]
    .filter(t => t.value.trim() !== t.dataset.orig)
    .map(t => ({{path: t.dataset.path, text: t.value}}));
  const res = await fetch('/v1/briefs/{brief["run_id"]}/review', {{
    method: 'POST', headers: {{'Content-Type': 'application/json'}},
    body: JSON.stringify({{decision: decision, notes: '', edits: decision === 'approved' ? edits : []}})
  }});
  if (res.ok) location.reload();
  else alert('Review failed: ' + await res.text());
}}
</script>
</body></html>"""


def _render_review_page(brief: dict) -> str:
    from html import escape

    if brief.get("brief_type") == "strategy":
        return _render_strategy_review(brief)

    content = brief["content"]
    s1 = content.get("s1", {}).get("draft", {}) if content.get("s1") else {}
    sections = content.get("sections") or {}
    s6 = content.get("s6", {}).get("draft", {}) if content.get("s6") else {}

    section_html = ""
    for sid in ("2", "3", "4", "5"):
        entry = sections.get(sid)
        if not entry:
            continue
        d = entry["draft"]
        implication = f"<p><em>{escape(d.get('implication', ''))}</em></p>" if d.get("implication") else ""
        section_html += f"""
        <section>
          <h3>S{sid} — {escape(d.get('headline', ''))}</h3>
          <p>{escape(d.get('mechanism', ''))}</p>
          {implication}
          <p><strong>Action:</strong> {escape(d.get('action', ''))}</p>
          <p class="meta">source: {entry.get('narration_source')} · critic approved: {entry.get('critic_approved')}</p>
        </section>"""

    risks_html = "".join(
        f"<li><strong>[{escape(r['severity'])}]</strong> {escape(r['risk'])} — <em>{escape(r['action'])}</em> ({escape(r['owner'])})</li>"
        for r in s6.get("risks", [])
    )

    disabled = "" if brief["status"] == "pending_review" else "disabled"
    status_note = "" if brief["status"] == "pending_review" else f"<p><strong>Status: {escape(brief['status'])}</strong> — already reviewed.</p>"

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Brief review — {escape(brief['run_id'])}</title>
<style>body{{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.5}}
section{{border:1px solid #ddd;border-radius:8px;padding:1rem;margin:1rem 0}}
.meta{{color:#888;font-size:.85em}}
button{{padding:.5rem 1.2rem;margin-right:.5rem;border-radius:6px;border:1px solid #ccc;cursor:pointer}}
</style></head>
<body>
<h1>{escape(s1.get('headline', brief['run_id']))}</h1>
<p>{escape(s1.get('summary', ''))}</p>
<p class="meta">tenant: {escape(brief['tenant_id'])} · brief_type: {escape(brief['brief_type'])} · run_id: {escape(brief['run_id'])}</p>
{status_note}
{section_html}
<section><h3>S6 — Risks & Actions</h3><ul>{risks_html}</ul>
<p><strong>Outlook:</strong> {escape(' '.join(s6.get('outlook', [])))}</p></section>

<form method="post" action="/v1/briefs/{brief['run_id']}/review" onsubmit="return submitReview(event)">
  <button type="button" onclick="review('approved')" {disabled}>Approve</button>
  <button type="button" onclick="review('rejected')" {disabled}>Reject</button>
</form>
<script>
async function review(decision) {{
  const res = await fetch('/v1/briefs/{brief["run_id"]}/review', {{
    method: 'POST', headers: {{'Content-Type': 'application/json'}},
    body: JSON.stringify({{decision: decision, notes: ''}})
  }});
  if (res.ok) location.reload();
  else alert('Review failed: ' + await res.text());
}}
</script>
</body></html>"""
