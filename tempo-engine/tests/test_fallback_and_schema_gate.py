"""The deterministic fallback writer must never fail, and its output must
always clear the numeral gate (every figure comes straight from evidence).
The schema gate must reject both malformed JSON and evidence_refs that cite
a finding the narrator was never shown.
"""

from __future__ import annotations

from engine.contracts import Confidence, EntityRef, Finding, FindingLevel
from engine.gates.fallback import deterministic_section_draft
from engine.gates.numeral_gate import run_numeral_gate
from engine.gates.schema_gate import run_schema_gate
from engine.llm.schemas import SectionDraftFull, SectionDraftLow


def _finding(id: str = "f1", **evidence_overrides) -> Finding:  # noqa: A002, ANN003
    evidence = {"roi": 9.41, "gmv": 506_058_865, "entity_count": 5}
    evidence.update(evidence_overrides)
    return Finding(
        id=id, generator="G01", tenant_id="t1", brief_type="gmv", section_affinity=[2],
        entity=EntityRef(id="e1", display_name="Sovella"), level=FindingLevel.ACCOUNT,
        claim_frame="identity_decomposition", evidence=evidence, comparison=None,
        magnitude_pct=1.0, direction="positive", actionability="high", confidence="high", materiality=0.5,
    )


def test_fallback_with_findings_produces_valid_full_draft_for_high_confidence() -> None:
    draft = deterministic_section_draft([_finding()], Confidence.HIGH)
    assert isinstance(draft, SectionDraftFull)
    assert draft.confidence == "high"
    assert draft.evidence_refs == ["f1"]


def test_fallback_low_confidence_has_no_implication_field() -> None:
    draft = deterministic_section_draft([_finding()], Confidence.LOW)
    assert isinstance(draft, SectionDraftLow)
    assert not hasattr(draft, "implication")


def test_fallback_with_no_findings_still_produces_a_valid_draft() -> None:
    draft = deterministic_section_draft([], Confidence.MEDIUM)
    assert isinstance(draft, SectionDraftFull)
    assert draft.evidence_refs == ["none"]


def test_fallback_output_always_clears_the_numeral_gate() -> None:
    """Every number the fallback writer states came straight from the
    finding's own evidence — this must be true across many finding shapes,
    not just one hand-picked example."""
    findings = [
        _finding(id="f1", roi=27.34, cost=249_609, gmv=6_825_500),
        _finding(id="f2", top1_share=0.4218, hhi=0.31),
        _finding(id="f3", nominal_delta_pct=-21.18, per_active_day_delta_pct=38.02),
    ]
    for tier in (Confidence.HIGH, Confidence.MEDIUM, Confidence.LOW):
        draft = deterministic_section_draft(findings, tier)
        text = draft.headline + " " + draft.mechanism + " " + draft.action
        if isinstance(draft, SectionDraftFull):
            text += " " + draft.implication
        result = run_numeral_gate(text, findings)
        assert result.ok, f"fallback text failed numeral gate at tier={tier}: {result.violations}"


def test_schema_gate_accepts_a_well_formed_response() -> None:
    finding = _finding()
    raw = {
        "headline": "Penurunan aktivitas periode ini",
        "mechanism": "GMV mencapai Rp 506.058.865 dengan ROI 9,41x pada periode ini.",
        "evidence_refs": ["f1"],
        "implication": "Efisiensi tetap terjaga meski volume menurun.",
        "action": "Tinjau alokasi anggaran kampanye utama pada periode berikutnya.",
        "confidence": "high",
    }
    result = run_schema_gate(raw, Confidence.HIGH, [finding])
    assert result.ok
    assert result.draft is not None


def test_schema_gate_rejects_evidence_ref_to_an_unknown_finding() -> None:
    finding = _finding(id="f1")
    raw = {
        "headline": "Penurunan aktivitas periode ini",
        "mechanism": "GMV mencapai Rp 506.058.865 dengan ROI 9,41x pada periode ini.",
        "evidence_refs": ["f1", "f_never_given"],
        "implication": "Efisiensi tetap terjaga meski volume menurun.",
        "action": "Tinjau alokasi anggaran kampanye utama pada periode berikutnya.",
        "confidence": "high",
    }
    result = run_schema_gate(raw, Confidence.HIGH, [finding])
    assert not result.ok
    assert "f_never_given" in (result.error or "")


def test_schema_gate_rejects_malformed_json_structure() -> None:
    result = run_schema_gate({"headline": "too short field set"}, Confidence.HIGH, [_finding()])
    assert not result.ok


def test_schema_gate_rejects_low_tier_response_carrying_implication() -> None:
    """A low-tier response with an `implication` field fails schema
    validation (SectionDraftLow forbids extra fields) — the mechanical
    enforcement PRD §8 asks for."""
    raw = {
        "headline": "Cakupan data terbatas periode ini",
        "mechanism": "Hanya 4 dari 7 hari aktif tersedia pada periode ini.",
        "evidence_refs": ["f1"],
        "implication": "Ini seharusnya tidak diperbolehkan pada tingkat keyakinan rendah.",
        "action": "Tunggu cakupan data lengkap sebelum menarik kesimpulan tren.",
        "confidence": "low",
    }
    result = run_schema_gate(raw, Confidence.LOW, [_finding()])
    assert not result.ok
