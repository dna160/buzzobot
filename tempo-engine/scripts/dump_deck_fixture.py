"""Dump an instant-tier run of the Sovella GMV fixture as engine content v2.

The TypeScript side builds and renders decks in unit tests against real engine
output rather than a hand-written stub, so `buildDeckModel`'s tests fail when
the engine's actual shape changes — not only when someone remembers to update a
mock. Regenerate after changing the fixture, the generators, or content v2:

    uv run python scripts/dump_deck_fixture.py \
        ../packages/reports/src/deck/fixtures/engine-content.gmv.instant.json

Instant tier deliberately: it needs no LM Studio, so the fixture is
reproducible on any machine and in CI.
"""
import asyncio, json, pathlib, sys
sys.path.insert(0, "src"); sys.path.insert(0, ".")
from langgraph.checkpoint.memory import InMemorySaver
from engine.api.dispatcher import _content_from_state
from engine.graphs.brief import build_brief_graph
from eval.fixtures.sovella_gmv_week import GMV_OBJECTIVE_CONTRACT, TENANT_ID, build_sovella_gmv_metric_frame

async def main() -> None:
    frame = build_sovella_gmv_metric_frame()
    graph = build_brief_graph(InMemorySaver())
    config = {"configurable": {"thread_id": "fixture_gmv_instant"}}
    state = await graph.ainvoke({
        "tenant_id": TENANT_ID, "brief_type": "gmv", "run_id": "run_fixture_gmv_instant",
        "metric_frame": frame.model_dump(mode="json"),
        "objective_contract": GMV_OBJECTIVE_CONTRACT.model_dump(mode="json"),
        "tier": "instant",
    }, config=config)
    content = _content_from_state(state)
    out = pathlib.Path(sys.argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(content, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {out} — {len(content['findings'])} findings, sections {sorted(content['sections'])}")

asyncio.run(main())
