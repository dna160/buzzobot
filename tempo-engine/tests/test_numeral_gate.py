"""The numeral gate — PRD §8's hard gate. Tested thoroughly against
Indonesian-locale formatting before any narration exists, per the PRD's own
instruction: "build this first — it is cheap and high-value."
"""

from __future__ import annotations

import pytest

from engine.contracts import EntityRef, Finding, FindingLevel
from engine.gates.numeral_gate import allowed_values, extract_numerals, normalize_id_numeral, run_numeral_gate


def test_normalize_rupiah_thousands() -> None:
    assert normalize_id_numeral("Rp 506.058.865") == pytest.approx(506_058_865)


def test_normalize_multiple_with_decimal() -> None:
    assert normalize_id_numeral("9,41x") == pytest.approx(9.41)


def test_normalize_percent_with_decimal() -> None:
    assert normalize_id_numeral("21,18%") == pytest.approx(21.18)


def test_normalize_plain_integer() -> None:
    assert normalize_id_numeral("5") == 5.0


def test_extract_numerals_finds_every_token_in_a_mixed_sentence() -> None:
    text = "GMV mencapai Rp 506.058.865 dengan ROI rata-rata 9,41x, naik 21,18% dari 5 kampanye."
    tokens = extract_numerals(text)
    assert "506.058.865" in tokens
    assert "9,41x" in tokens
    assert "21,18%" in tokens
    assert "5" in tokens


def _finding(evidence: dict) -> Finding:  # noqa: ANN001
    return Finding(
        id="f1", generator="G01", tenant_id="t1", brief_type="gmv", section_affinity=[2],
        entity=EntityRef(id="e1", display_name="Entity"), level=FindingLevel.ACCOUNT,
        claim_frame="identity_decomposition", evidence=evidence, comparison=None,
        magnitude_pct=1.0, direction="positive", actionability="high", confidence="high", materiality=0.5,
    )


def test_allowed_values_collects_numeric_evidence_only() -> None:
    finding = _finding({"gmv": 506_058_865, "label": "not a number", "roi": 9.41})
    values = allowed_values([finding])
    assert 506_058_865.0 in values
    assert 9.41 in values
    assert len(values) == 2


def test_gate_passes_when_every_numeral_is_in_evidence() -> None:
    finding = _finding({"gmv": 506_058_865, "roi": 9.41})
    text = "GMV mencapai Rp 506.058.865 dengan ROI 9,41x."
    result = run_numeral_gate(text, [finding])
    assert result.ok
    assert result.violations == ()


def test_gate_permits_rounding_derivation() -> None:
    finding = _finding({"roi": 27.343})
    text = "ROI sesi ini mencapai 27,34x."  # rounded from 27.343
    result = run_numeral_gate(text, [finding])
    assert result.ok


def test_gate_permits_percent_conversion_derivation() -> None:
    # evidence stores a fraction (0.4218); narrator writes it as a percent.
    finding = _finding({"top1_share": 0.4218})
    text = "Kampanye ini menyumbang 42,18% dari total."
    result = run_numeral_gate(text, [finding])
    assert result.ok


def test_gate_rejects_an_orphan_numeral() -> None:
    finding = _finding({"gmv": 506_058_865})
    text = "GMV mencapai Rp 999.999.999, jauh di atas target."
    result = run_numeral_gate(text, [finding])
    assert not result.ok
    assert len(result.violations) == 1
    assert result.violations[0].normalized_value == pytest.approx(999_999_999)


def test_gate_rejects_a_fabricated_percentage_even_if_plausible() -> None:
    finding = _finding({"roi": 9.41, "gmv": 506_058_865})
    text = "Efisiensi meningkat sebesar 15,00% dibanding minggu lalu."
    result = run_numeral_gate(text, [finding])
    assert not result.ok


def test_gate_only_checks_findings_actually_passed_not_a_wider_set() -> None:
    """A numeral gate call only receives the findings routed to that
    section's narrator — a value that's real evidence for some OTHER
    finding not in this call is still an orphan here."""
    routed_finding = _finding({"gmv": 100.0})
    text = "Nilai ini mencapai 999."
    result = run_numeral_gate(text, [routed_finding])
    assert not result.ok


def test_gate_ignores_text_with_no_numerals() -> None:
    finding = _finding({"gmv": 100.0})
    result = run_numeral_gate("Kinerja kampanye ini menunjukkan tren yang stabil.", [finding])
    assert result.ok
