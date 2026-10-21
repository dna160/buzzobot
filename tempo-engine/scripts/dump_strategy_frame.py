"""Freeze a client's live StrategyFrame as a test fixture (Strategy Report P2).

P0 asked for the BARDI fixture to be **frozen real rows**, not mock-up numbers
(P0_DISCOVERY.md §7). This reads the live mirror through the engine's own
SELECT-only role and writes the frame exactly as a run would see it:

    uv run python scripts/dump_strategy_frame.py bardi-tiktok 2026-10-10 \
        eval/fixtures/bardi_strategy_frame.json

The fixture is anonymised only where the frame carries tenant ids; brand names
are TikTok's public ones.
"""

import asyncio
import json
import os
import pathlib
import sys
from datetime import date

sys.path.insert(0, "src")
sys.path.insert(0, ".")
from dotenv import load_dotenv  # noqa: E402

from engine.ports.strategy_read import build_strategy_frame  # noqa: E402
from engine.ports.tempo_read import connect  # noqa: E402


async def main(slug: str, as_of: str, out: str) -> None:
    load_dotenv(os.path.join(os.getcwd(), ".env"))
    conn = await connect(os.environ["TEMPO_ENGINE_DATABASE_URL"])
    try:
        frame = await build_strategy_frame(conn, slug, end_date=date.fromisoformat(as_of))
    finally:
        await conn.close()
    if frame is None:
        raise SystemExit(f"{slug} is not eligible for a strategy report")
    data = frame.model_dump(mode="json")
    data["tenant_id"] = "fixture-" + slug
    data["generated_at"] = f"{as_of}T00:00:00Z"
    path = pathlib.Path(out)
    path.write_text(json.dumps(data, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {path} ({path.stat().st_size // 1024} KB) — as_of {frame.as_of}, class {frame.classification.report_class}")


if __name__ == "__main__":
    asyncio.run(main(*sys.argv[1:4]))
