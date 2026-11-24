"""Per-call token budget (Strategy Report PRD §8.1): system ≤ 900, payload
≤ 3,000, exemplar ≤ 600, output ≤ 1,200 tokens, planned against a 12K
context.

The PRD names `tiktoken` cl100k ×1.15 as the estimator. tiktoken fetches its
BPE file from the internet on first use, which the full tier's "0 cloud calls"
gate forbids, so this uses a character estimate calibrated against Gemma's
own reported `prompt_tokens` for mixed Indonesian/English table payloads
(≈ 3.6 characters per token) with the same ×1.15 safety factor. The estimate
only has to be conservative, never exact: an over-budget payload is trimmed,
not rejected.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import TypeVar

SYSTEM_BUDGET = 900
PAYLOAD_BUDGET = 3000
EXEMPLAR_BUDGET = 600
OUTPUT_BUDGET = 1200
CONTEXT_PLAN = 12_000

CHARS_PER_TOKEN = 3.6
SAFETY = 1.15

T = TypeVar("T")


def estimate_tokens(text: str) -> int:
    return math.ceil(len(text) / CHARS_PER_TOKEN * SAFETY)


@dataclass(frozen=True)
class TrimResult:
    kept: list
    dropped_ids: list[str]
    tokens: int


def trim_to_budget(
    items: Sequence[T],
    render: Callable[[Sequence[T]], str],
    *,
    materiality: Callable[[T], float],
    item_id: Callable[[T], str],
    budget: int = PAYLOAD_BUDGET,
    keep_at_least: int = 1,
) -> TrimResult:
    """Drop the lowest-materiality item until `render(kept)` fits `budget`
    (PRD §8.1). Order of the kept items is preserved. Never drops below
    `keep_at_least` — a section with one enormous finding is sent as is and
    the overrun is reported, rather than narrating nothing."""
    kept = list(items)
    dropped: list[str] = []
    tokens = estimate_tokens(render(kept))
    while tokens > budget and len(kept) > keep_at_least:
        worst = min(kept, key=materiality)
        kept.remove(worst)
        dropped.append(item_id(worst))
        tokens = estimate_tokens(render(kept))
    return TrimResult(kept=kept, dropped_ids=dropped, tokens=tokens)
