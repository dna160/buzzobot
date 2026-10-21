"""Strategy Report full tier (PRD §8): narrators, critics, Action Phraser and
synthesist over the instant tier's deterministic base. Placeholder until P4:
runs the instant copy and records why, so a full-tier request still returns a
complete, honest report."""

from __future__ import annotations

from typing import Any

from engine.graphs.strategy import strategy_instant_copy_node


async def strategy_full_node(state: dict) -> dict[str, Any]:
    out = await strategy_instant_copy_node(state)
    meta = dict(out["strategy_meta"])
    meta["degraded"] = [*meta.get("degraded", []), "full_tier_not_built"]
    return {**out, "strategy_meta": meta}
