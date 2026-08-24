"""The checked-in JSON Schema must match the live Pydantic model.

Half of the deck boundary's drift check (Brief Deck PRD §3.1): this half
fails when `engine/contracts/content.py` changes without regenerating
`contracts/brief_content_v2.schema.json`; the other half
(`packages/reports/src/deck/engine-content.drift.test.ts`) fails when the
TypeScript mirror stops matching that file. Neither half can be satisfied by
editing the schema by hand, which is the property that makes it a contract.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO / "contracts" / "brief_content_v2.schema.json"


def test_exported_schema_is_up_to_date() -> None:
    result = subprocess.run(
        [sys.executable, str(REPO / "scripts" / "export_content_schema.py"), "--check"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_schema_exposes_the_keys_the_deck_renders() -> None:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    assert set(schema["properties"]) >= {
        "content_version",
        "tier",
        "engine_version",
        "s1",
        "sections",
        "s6",
        "findings",
        "rankings",
        "coverage",
        "probe_loop",
    }
