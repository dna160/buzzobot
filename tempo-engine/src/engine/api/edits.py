"""Reviewer edit capture (Strategy Report PRD §11.4).

A reviewer may change narrated text on `/ui/briefs/{run_id}` before approving.
Each edit names a path inside the brief content —
`sections.103.draft.paragraphs.0.text`, `sections.3.draft.headline` — and the
new text. Only text the engine *wrote* is editable: headlines, paragraphs,
implications, the deck's mechanism/action, and the Action List's copy. Numbers
the generators computed (evidence, charts, chips' values) are not addressable,
so an edit can change how a finding is said but never what was found.

Edit distance is `1 − difflib.SequenceMatcher.ratio()` on the two strings:
0 for untouched, 1 for a full rewrite. The monthly mean is the review signal
(`scripts/edit_distance_report.py`).
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass

import asyncpg
from pydantic import BaseModel, Field

# Paths a reviewer may edit. Everything else in the content is analysis.
_EDITABLE = [
    re.compile(r"^sections\.\d+\.draft\.(headline|implication|mechanism|action|paragraph)$"),
    re.compile(r"^sections\.\d+\.draft\.paragraphs\.\d+\.text$"),
    re.compile(r"^(s1|s6)\.draft\.(headline|summary)$"),
    re.compile(r"^action_plan\.\d+\.copy\.(langkah|dasar|cara|gagal_jika)$"),
]


class Edit(BaseModel):
    path: str = Field(min_length=3, max_length=120)
    text: str = Field(max_length=2000)


@dataclass(frozen=True)
class AppliedEdit:
    path: str
    section_id: str
    before: str
    after: str
    distance: float
    narration_source: str | None


class EditError(ValueError):
    pass


def edit_distance(before: str, after: str) -> float:
    if before == after:
        return 0.0
    return round(1.0 - difflib.SequenceMatcher(None, before, after, autojunk=False).ratio(), 4)


def _walk(content: dict, path: str) -> tuple[object, str | int]:
    parts = path.split(".")
    node: object = content
    for p in parts[:-1]:
        key: str | int = int(p) if p.isdigit() and isinstance(node, list) else p
        try:
            node = node[key]  # type: ignore[index]
        except (KeyError, IndexError, TypeError) as exc:
            raise EditError(f"no such field: {path}") from exc
    last = parts[-1]
    return node, (int(last) if last.isdigit() and isinstance(node, list) else last)


def apply_edits(content: dict, edits: list[Edit]) -> list[AppliedEdit]:
    """Apply in place; return what changed. Unchanged text is not an edit."""
    applied: list[AppliedEdit] = []
    for e in edits:
        if not any(p.match(e.path) for p in _EDITABLE):
            raise EditError(f"not an editable field: {e.path}")
        parent, key = _walk(content, e.path)
        try:
            before = parent[key]  # type: ignore[index]
        except (KeyError, IndexError, TypeError) as exc:
            raise EditError(f"no such field: {e.path}") from exc
        if not isinstance(before, str):
            raise EditError(f"not a text field: {e.path}")
        after = e.text.strip()
        if after == before:
            continue
        parent[key] = after  # type: ignore[index]
        parts = e.path.split(".")
        section_id = parts[1] if parts[0] == "sections" else ("T2" if parts[0] == "action_plan" else parts[0])
        source = None
        if parts[0] == "sections":
            source = (content.get("sections") or {}).get(parts[1], {}).get("narration_source")
        applied.append(AppliedEdit(e.path, section_id, before, after, edit_distance(before, after), source))
    return applied


async def ensure_edits_schema(conn: asyncpg.Connection) -> None:
    """Idempotent — the same DDL as migrations/0004_create_brief_edits.sql."""
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS insight.brief_edits (
            id bigserial PRIMARY KEY,
            run_id text NOT NULL,
            tenant_id text NOT NULL,
            brief_type text NOT NULL,
            section_id text NOT NULL,
            path text NOT NULL,
            before_text text NOT NULL,
            after_text text NOT NULL,
            edit_distance double precision NOT NULL,
            narration_source text,
            editor text,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    await conn.execute("CREATE INDEX IF NOT EXISTS brief_edits_run_idx ON insight.brief_edits (run_id)")
    await conn.execute("CREATE INDEX IF NOT EXISTS brief_edits_type_month_idx ON insight.brief_edits (brief_type, created_at)")


async def record_edits(
    conn: asyncpg.Connection, *, run_id: str, tenant_id: str, brief_type: str, edits: list[AppliedEdit], editor: str | None,
) -> None:
    if not edits:
        return
    await conn.executemany(
        """
        INSERT INTO insight.brief_edits
            (run_id, tenant_id, brief_type, section_id, path, before_text, after_text, edit_distance, narration_source, editor)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        """,
        [(run_id, tenant_id, brief_type, e.section_id, e.path, e.before, e.after, e.distance, e.narration_source, editor) for e in edits],
    )
