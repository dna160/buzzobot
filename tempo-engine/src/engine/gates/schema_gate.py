"""Schema conformance + evidence-reference validity. PRD §8: "Section must
parse under its response schema." Also checks every `evidence_refs` entry
is actually one of the finding IDs the narrator was given — a model citing
a finding it was never shown is exactly as untrustworthy as an orphan
numeral, just not a numeral.
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import ValidationError

from engine.contracts import Confidence, Finding
from engine.llm.schemas import SectionDraft, parse_section_draft


@dataclass(frozen=True)
class SchemaGateResult:
    ok: bool
    draft: SectionDraft | None
    error: str | None


def run_schema_gate(raw_json: dict, tier: Confidence, findings: list[Finding]) -> SchemaGateResult:
    try:
        draft = parse_section_draft(raw_json, tier)
    except ValidationError as exc:
        issues = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:4])
        return SchemaGateResult(ok=False, draft=None, error=f"schema validation failed — {issues}")

    known_ids = {f.id for f in findings}
    unknown = [r for r in draft.evidence_refs if r not in known_ids]
    if unknown:
        return SchemaGateResult(ok=False, draft=None, error=f"evidence_refs cite unknown finding id(s): {unknown}")

    return SchemaGateResult(ok=True, draft=draft, error=None)
