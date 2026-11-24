"""Generic-sentence detector over finished reports (Strategy Report PRD §11.3, P6).

The rule lives in `engine.gates.generic` (the full tier uses it as a soft gate
on every draft). This runs it over stored engine content — exported JSON files
or `insight.brief` rows — and reports every flagged paragraph, so the exit
gate's "0 flagged paragraphs in accepted sections" can be checked on real
runs, not only on the live test's own.

    uv run python eval/generic_detector.py path/to/content.json [...]
    uv run python eval/generic_detector.py --db strategy 20     # newest 20 strategy briefs

Exit code 1 when anything in a model-written (`llm`) section is flagged.
"""

from __future__ import annotations

import asyncio
import json
import os
import pathlib
import sys

sys.path.insert(0, "src")
from engine.gates.generic import generic_problems  # noqa: E402


def paragraphs(content: dict) -> list[tuple[str, str, str]]:
    """(section id, narration source, text) for every narrated paragraph."""
    out = []
    for sid, entry in (content.get("sections") or {}).items():
        d = entry.get("draft") or {}
        src = str(entry.get("narration_source"))
        texts = [p.get("text", "") for p in d.get("paragraphs", [])]
        texts += [d[k] for k in ("paragraph", "mechanism") if isinstance(d.get(k), str)]
        out += [(sid, src, t) for t in texts]
    return out


def scan(content: dict) -> list[dict]:
    names = [n for n in ((content.get("meta") or {}).get("brand_name"),) if n]
    flagged = []
    for sid, src, text in paragraphs(content):
        problems = generic_problems([text], names)
        if problems:
            flagged.append({"section": sid, "source": src, "text": text, "problems": problems})
    return flagged


async def _from_db(brief_type: str, limit: int) -> list[tuple[str, dict]]:
    from dotenv import load_dotenv

    from engine.ports.tempo_read import connect

    load_dotenv(os.path.join(os.getcwd(), ".env"))
    conn = await connect(os.environ["TEMPO_ENGINE_DATABASE_URL"])
    try:
        rows = await conn.fetch(
            "SELECT run_id, content FROM insight.brief WHERE brief_type = $1 AND status IN ('approved', 'pending_review') "
            "ORDER BY updated_at DESC LIMIT $2",
            brief_type, limit,
        )
    finally:
        await conn.close()
    return [(r["run_id"], r["content"] if isinstance(r["content"], dict) else json.loads(r["content"])) for r in rows]


def main(argv: list[str]) -> int:
    if argv and argv[0] == "--db":
        items = asyncio.run(_from_db(argv[1] if len(argv) > 1 else "strategy", int(argv[2]) if len(argv) > 2 else 20))
    else:
        items = [(p, json.loads(pathlib.Path(p).read_text(encoding="utf-8"))) for p in argv]
    bad_llm = 0
    total = 0
    for name, content in items:
        n = len(paragraphs(content))
        total += n
        flagged = scan(content)
        bad_llm += sum(1 for f in flagged if f["source"] == "llm")
        for f in flagged:
            print(f"{name} · {f['section']} ({f['source']}): {'; '.join(f['problems'])}\n    {f['text'][:160]}")
    print(f"{len(items)} reports, {total} paragraphs, {bad_llm} flagged in model-written sections")
    return 1 if bad_llm else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
