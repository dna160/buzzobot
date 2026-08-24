"""One place that answers "which engine wrote this brief?".

The deck's provenance footer prints it and `GET /healthz` reports it, so a
thin deck can be traced to the code that produced it in one step (Brief Deck
PRD §6). Read from installed package metadata when available, falling back to
the pyproject version string so a source checkout still reports something
truthful rather than "unknown".
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

_FALLBACK = "0.1.0"

try:
    ENGINE_VERSION = version("tempo-engine")
except PackageNotFoundError:  # pragma: no cover - source checkout without install
    ENGINE_VERSION = _FALLBACK
