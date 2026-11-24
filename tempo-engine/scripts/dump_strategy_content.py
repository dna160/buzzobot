"""Dump a strategy run as engine content (Strategy Report P2/P3/P4).

The TypeScript renderer is tested against real engine output, as the deck is
(`dump_deck_fixture.py`). Instant tier, so it needs no LM Studio:

    uv run python scripts/dump_strategy_content.py eval/fixtures/bardi_strategy_frame.json shop \
        ../packages/reports/src/strategy-report/fixtures/engine-content.strategy.shop.json

A fifth argument `full` runs the full tier against LM Studio (`LM_STUDIO_URL`).
"""

import asyncio
import json
import pathlib
import sys

sys.path.insert(0, "src")
sys.path.insert(0, ".")
from langgraph.checkpoint.memory import InMemorySaver  # noqa: E402

from engine.api.dispatcher import _content_from_state  # noqa: E402
from engine.contracts.strategy import StrategyFrame  # noqa: E402
from engine.graphs.brief import build_brief_graph  # noqa: E402
from engine.ports.strategy_classify import classify  # noqa: E402


async def main(frame_path: str, report_class: str, out: str, tier: str = "instant") -> None:
    frame = StrategyFrame.model_validate_json(pathlib.Path(frame_path).read_text(encoding="utf-8"))
    c = frame.classification
    frame = frame.model_copy(update={"classification": classify(
        north_star=frame.north_star,
        gmv_share=c.inputs.get("gmv_share"),  # type: ignore[arg-type]
        conv_ratio=c.inputs.get("conversion_to_consideration"),  # type: ignore[arg-type]
        override=report_class,  # type: ignore[arg-type]
    )})
    graph = build_brief_graph(InMemorySaver())
    run_id = f"run_fixture_strategy_{report_class}" + ("_full" if tier == "full" else "")
    state = await graph.ainvoke(
        {"tenant_id": frame.tenant_id, "brief_type": "strategy", "run_id": run_id,
         "strategy_frame": frame.model_dump(mode="json"), "tier": tier},
        config={"configurable": {"thread_id": run_id}},
    )
    content = _content_from_state(state)
    path = pathlib.Path(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(content, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {path} — {len(content['findings'])} findings, class {content['report_class']['report_class']}")


if __name__ == "__main__":
    asyncio.run(main(*sys.argv[1:5]))
