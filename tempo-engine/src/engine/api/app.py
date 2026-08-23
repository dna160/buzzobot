"""The review API (PRD §1.1, B6's minimal review surface — living inside
tempo-engine, not apps/web, since touching Tempo's repo is out of scope).

    POST /v1/briefs                {client_slug, brief_type, window_days}  -> run_id, status
    GET  /v1/briefs/{run_id}                                               -> status | brief content
    POST /v1/briefs/{run_id}/review {decision, notes}                      -> resumes the graph
    POST /v1/briefs/sync           {client_slug, brief_type, window_days}  -> finished, auto-approved brief
    GET  /ui/briefs/{run_id}                                               -> human-readable review page

`tenant_id` is bound the moment a run starts (from the resolved client) and
carried through every downstream call — Hard Rule 6, enforced at this
boundary since it's the first place an external caller's input is trusted.

`/v1/briefs/sync` exists for callers with no review UI of their own (Tempo
LM's brief buttons) — it runs the same graph, including the real
`interrupt()`, and supplies an "approved" decision automatically rather
than skipping the review step. `/v1/briefs` + `/v1/briefs/{run_id}/review`
remain the two-step interface for a real human reviewer.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from pydantic import BaseModel

from engine.api.dispatcher import BriefNotFoundError, ClientNotEligibleError, get_brief_status, resume_brief_review, run_brief_sync, start_brief_run
from engine.graphs.brief import build_brief_graph
from engine.graphs.persistence import ensure_schema, insight_checkpointer_conninfo
from engine.ports.tempo_read import connect

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
        app.state.read_conn = await connect(db_url)
        await ensure_schema(app.state.read_conn)
        try:
            yield
        finally:
            await app.state.read_conn.close()


app = FastAPI(title="Tempo Intelligence Engine — Review API", lifespan=lifespan)


class CreateBriefRequest(BaseModel):
    client_slug: str
    brief_type: Literal["gmv", "awareness", "install"] = "gmv"
    window_days: int = 7


class ReviewRequest(BaseModel):
    decision: Literal["approved", "rejected"]
    notes: str = ""


@app.post("/v1/briefs")
async def create_brief(req: CreateBriefRequest, request: Request) -> dict:
    try:
        return await start_brief_run(
            graph=request.app.state.graph, read_conn=request.app.state.read_conn,
            client_slug=req.client_slug, brief_type=req.brief_type, window_days=req.window_days,
        )
    except ClientNotEligibleError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/v1/briefs/sync")
async def create_brief_sync(req: CreateBriefRequest, request: Request) -> dict:
    try:
        return await run_brief_sync(
            graph=request.app.state.graph, read_conn=request.app.state.read_conn,
            client_slug=req.client_slug, brief_type=req.brief_type, window_days=req.window_days,
        )
    except ClientNotEligibleError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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
            run_id=run_id, decision=req.decision, notes=req.notes,
        )
    except BriefNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"no brief with run_id {run_id!r}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/ui/briefs/{run_id}", response_class=HTMLResponse)
async def review_page(run_id: str, request: Request) -> str:
    try:
        brief = await get_brief_status(request.app.state.read_conn, run_id)
    except BriefNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"no brief with run_id {run_id!r}") from exc
    return _render_review_page(brief)


def _render_review_page(brief: dict) -> str:
    from html import escape

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
