"""Tenant-name tokenization (Strategy Report PRD §8.7, engine PRD §9).

The client's own names — its display name, its Market Scope brand name, its
campaign names — are replaced with stable placeholders (`BRAND`,
`KAMPANYE_1`, …) before a prompt leaves the process, and restored in the
model's reply before any gate runs. Competitor names from the public ranking
list are not tenant data and pass through unchanged.

Placeholders are chosen so the model has no reason to translate or inflect
them, and restoration is a whole-token replace, so a placeholder the model
dropped simply never comes back rather than corrupting a word.
"""

from __future__ import annotations

import re
from typing import Any


class NameTokenizer:
    def __init__(self, brand_names: list[str], campaign_names: list[str] | None = None) -> None:
        mapping: dict[str, str] = {}
        for name in brand_names:
            if name and name.strip() and name.strip() not in mapping:
                mapping[name.strip()] = "BRAND"
        for i, name in enumerate(n for n in (campaign_names or []) if n and n.strip()):
            mapping.setdefault(name.strip(), f"KAMPANYE_{i + 1}")
        # Longest first, so "BARDI Smart Home" is replaced before "BARDI".
        self._forward = sorted(mapping.items(), key=lambda kv: -len(kv[0]))
        # A placeholder restores to the first (canonical) name that produced it.
        self._reverse: dict[str, str] = {}
        for name in [*brand_names, *(campaign_names or [])]:
            if name and name.strip():
                self._reverse.setdefault(mapping[name.strip()], name.strip())

    def encode(self, text: str) -> str:
        for name, token in self._forward:
            text = re.sub(rf"(?<!\w){re.escape(name)}(?!\w)", token, text, flags=re.IGNORECASE)
        return text

    def decode(self, text: str) -> str:
        for token, name in sorted(self._reverse.items(), key=lambda kv: -len(kv[0])):
            text = re.sub(rf"(?<!\w){re.escape(token)}(?!\w)", name, text)
        return text

    def decode_obj(self, obj: Any) -> Any:
        """Restore names everywhere in a parsed JSON reply, leaving keys and
        non-string values alone."""
        if isinstance(obj, str):
            return self.decode(obj)
        if isinstance(obj, list):
            return [self.decode_obj(v) for v in obj]
        if isinstance(obj, dict):
            return {k: self.decode_obj(v) for k, v in obj.items()}
        return obj
