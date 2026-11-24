"""Monthly reviewer edit distance (Strategy Report PRD §11.4, P6).

The rollout's review signal: how much of what the engine wrote did reviewers
change before approving? Per brief type and month — mean edit distance over
edited fields, how many approved briefs had any edit, and the share of the
edits that landed on model copy versus deterministic copy. PRD target:
mean < 15% by the second month.

    uv run python scripts/edit_distance_report.py            # all brief types
    uv run python scripts/edit_distance_report.py strategy   # one
"""

import asyncio
import os
import sys

sys.path.insert(0, "src")
from dotenv import load_dotenv  # noqa: E402

from engine.ports.tempo_read import connect  # noqa: E402

TARGET = 0.15

SQL = """
WITH approved AS (
    SELECT brief_type, date_trunc('month', updated_at) AS month, count(*) AS briefs
    FROM insight.brief WHERE status = 'approved' AND ($1::text IS NULL OR brief_type = $1)
    GROUP BY 1, 2
), edits AS (
    SELECT brief_type, date_trunc('month', created_at) AS month,
           count(*) AS edits, count(DISTINCT run_id) AS edited_briefs,
           avg(edit_distance) AS mean_distance,
           avg(edit_distance) FILTER (WHERE narration_source = 'llm') AS mean_llm,
           avg(edit_distance) FILTER (WHERE narration_source IS DISTINCT FROM 'llm') AS mean_other
    FROM insight.brief_edits WHERE ($1::text IS NULL OR brief_type = $1)
    GROUP BY 1, 2
)
SELECT a.brief_type, a.month, a.briefs, coalesce(e.edits, 0) AS edits, coalesce(e.edited_briefs, 0) AS edited_briefs,
       e.mean_distance, e.mean_llm, e.mean_other
FROM approved a LEFT JOIN edits e USING (brief_type, month)
ORDER BY a.brief_type, a.month
"""


def pct(v: float | None) -> str:
    return "—" if v is None else f"{v * 100:.1f}%"


async def main(brief_type: str | None) -> None:
    load_dotenv(os.path.join(os.getcwd(), ".env"))
    conn = await connect(os.environ["TEMPO_ENGINE_DATABASE_URL"])
    try:
        exists = await conn.fetchval("SELECT to_regclass('insight.brief_edits') IS NOT NULL")
        if not exists:
            raise SystemExit("insight.brief_edits does not exist yet — start the API once (it creates the table).")
        rows = await conn.fetch(SQL, brief_type)
    finally:
        await conn.close()
    if not rows:
        print("No approved briefs yet.")
        return
    print(f"{'type':<10} {'month':<8} {'briefs':>6} {'edited':>6} {'edits':>5} {'mean':>7} {'model':>7} {'other':>7}  vs target {pct(TARGET)}")
    for r in rows:
        flag = "" if r["mean_distance"] is None or r["mean_distance"] < TARGET else "  ← above target"
        print(
            f"{r['brief_type']:<10} {r['month']:%Y-%m}  {r['briefs']:>6} {r['edited_briefs']:>6} {r['edits']:>5} "
            f"{pct(r['mean_distance']):>7} {pct(r['mean_llm']):>7} {pct(r['mean_other']):>7}{flag}"
        )


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else None))
