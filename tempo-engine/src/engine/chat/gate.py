"""The reply number check (PRD §9.1) — the Strategy numeral gate, unchanged,
with a conversation-level permitted set.

A numeral in the reply passes if it appears in: this turn's tool outputs, the
user's own messages (so a target the AM states can be repeated), earlier
assistant replies (checked when written), or the benign/label set the strategy
gate already allows (rounding, ×100 for %/poin, ID separators, small integers,
`YYYY-MM-DD`, "per 1.000", "Top N", calendar years 2020–2035). Anything else is
an orphan — a number the model could not have read.
"""

from __future__ import annotations

import re

from engine.gates.strategy_gates import allowed_from, orphan_numerals

_YEARS: tuple[float, ...] = tuple(float(y) for y in range(2020, 2036))

_THINK_PAIR = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_THINK_TAG = re.compile(r"</?think>", re.IGNORECASE)
_INLINE_TOOL = re.compile(r"<tool_call>.*?</tool_call>", re.DOTALL | re.IGNORECASE)


def clean_reply(text: str) -> str:
    """Strip Qwen reasoning before the reply is shown or checked (PRD §8.3):
    `<think>…</think>` blocks, a dangling `</think>` whose opening tag was eaten
    (keep only what follows it), stray think tags, and any leftover inline
    `<tool_call>` block."""
    text = _THINK_PAIR.sub("", text)
    if "</think>" in text.lower() and "<think>" not in text.lower():
        text = re.split(_THINK_TAG, text, maxsplit=1)[-1]
    text = _THINK_TAG.sub("", text)
    text = _INLINE_TOOL.sub("", text)
    return text.strip()


def check_reply(
    reply: str,
    *,
    tool_outputs: list[str],
    user_texts: list[str],
    prior_replies: list[str],
) -> list[str]:
    """Return the orphan numerals in `reply` — empty means it passes. The reply
    itself is not in the permitted set, so an invented number cannot license
    itself."""
    allowed = allowed_from([], *tool_outputs, *user_texts, *prior_replies, extra=_YEARS)
    return orphan_numerals(reply, allowed)
