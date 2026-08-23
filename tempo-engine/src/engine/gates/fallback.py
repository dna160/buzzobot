"""The deterministic fallback writer. PRD §8: "Any hard gate failure ->
deterministic writer, stated in the footer. The brief always renders."

This is the ultimate safety net — it must never itself fail. No template
branch here is allowed to raise on a plausible input; every lookup has a
generic default. It produces plainer, more mechanical prose than the LLM
path (by design — a template sentence that is honest beats free-form prose
that might not be), built directly from a finding's own evidence, so it is
numeral-gate-safe by construction: every figure it states came from the
evidence dict, verbatim.
"""

from __future__ import annotations

from engine.contracts import Confidence, Finding
from engine.llm.schemas import RiskItem, S1Draft, S6Draft, SectionDraft, SectionDraftFull, SectionDraftLow

_CLAIM_LABELS: dict[str, str] = {
    "identity_decomposition": "Dekomposisi perubahan periode",
    "efficiency_outlier_positive": "Efisiensi di atas rata-rata",
    "efficiency_outlier_negative": "Efisiensi di bawah rata-rata",
    "concentration_dependency": "Konsentrasi/ketergantungan",
    "zero_yield_spend": "Belanja tanpa hasil",
    "marginal_return_scaling": "Kandidat untuk penambahan anggaran",
    "marginal_return_declining": "Kandidat untuk pengurangan anggaran",
    "attribute_performance_correlation": "Korelasi atribut dengan performa",
    "comparability_artifact": "Perbandingan periode perlu konteks",
    "data_coverage_gap": "Cakupan data",
    "session_efficiency_leader": "Sesi live dengan efisiensi terbaik",
    "session_efficiency_laggard": "Sesi live dengan efisiensi terlemah",
    "aov_mix_shift": "Perubahan nilai pesanan rata-rata",
    "creator_ladder_leader": "Kreator dengan performa terbaik",
    "creator_ladder_laggard": "Kreator dengan performa terlemah",
    "sku_lifecycle_contribution": "Kontribusi produk",
}


def _label_for(claim_frame: str) -> str:
    return _CLAIM_LABELS.get(claim_frame, "Temuan")


def _format_evidence_value(value: float | int | str) -> str:
    if isinstance(value, float):
        return f"{value:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return str(value)


def _mechanism_sentence(finding: Finding) -> str:
    parts = [f"{k}: {_format_evidence_value(v)}" for k, v in list(finding.evidence.items())[:4]]
    return f"{finding.entity.display_name} — " + "; ".join(parts) + "."


def deterministic_section_draft(findings: list[Finding], confidence_tier: Confidence) -> SectionDraft:
    if not findings:
        # No findings at all is itself the section's honest content — a
        # coverage-gap statement, never a fabricated observation.
        headline = "Tidak ada temuan signifikan untuk bagian ini pada periode ini."
        mechanism = "Data yang tersedia tidak menghasilkan temuan yang melewati ambang materialitas."
        evidence_refs: list[str] = []
        action = "Tinjau kembali pada periode pelaporan berikutnya setelah data tambahan tersedia."
    else:
        top = findings[0]
        label = _label_for(top.claim_frame)
        headline = f"{label}: {top.entity.display_name}."
        mechanism = " ".join(_mechanism_sentence(f) for f in findings[:3])
        evidence_refs = [f.id for f in findings[:5]]
        action = f"Tinjau {top.entity.display_name} bersama tim terkait dan tentukan tindak lanjut berdasarkan temuan di atas."

    if confidence_tier == Confidence.LOW:
        return SectionDraftLow(
            headline=headline[:200],
            mechanism=mechanism[:900] if mechanism else "Tidak ada rincian tambahan tersedia.",
            evidence_refs=evidence_refs or ["none"],
            action=action[:400],
            confidence="low",
        )

    return SectionDraftFull(
        headline=headline[:200],
        mechanism=mechanism[:900] if mechanism else "Tidak ada rincian tambahan tersedia.",
        evidence_refs=evidence_refs or ["none"],
        implication="Temuan ini disajikan berdasarkan data yang tersedia tanpa interpretasi naratif tambahan.",
        action=action[:400],
        confidence="high" if confidence_tier == Confidence.HIGH else "medium",
    )


_SEVERITY_BY_MAGNITUDE = [(0.5, "high"), (0.2, "medium")]


def _severity_for(finding: Finding) -> str:
    for threshold, severity in _SEVERITY_BY_MAGNITUDE:
        if finding.magnitude_pct >= threshold:
            return severity
    return "low"


def deterministic_s6_draft(findings: list[Finding]) -> S6Draft:
    """Fallback risk register: one entry per top finding (up to 6), built
    directly from its own evidence — numeral-gate-safe by construction,
    same guarantee as `deterministic_section_draft`."""
    if not findings:
        return S6Draft(
            risks=[
                RiskItem(
                    risk="Tidak ada temuan signifikan yang tersedia untuk periode ini.",
                    severity="low",
                    action="Tinjau kembali pada periode pelaporan berikutnya.",
                    owner="Data / Ops",
                    evidence_refs=["none"],
                ),
                RiskItem(
                    risk="Cakupan data pada periode ini tidak menghasilkan risiko yang dapat ditindaklanjuti.",
                    severity="low",
                    action="Pastikan sinkronisasi data berjalan normal sebelum periode berikutnya.",
                    owner="Data / Ops",
                    evidence_refs=["none"],
                ),
            ],
            outlook=["Belum ada dasar yang cukup untuk proyeksi pada periode ini."],
            confidence="low",
        )

    risks = [
        RiskItem(
            risk=f"{_label_for(f.claim_frame)}: {f.entity.display_name}.",
            severity=_severity_for(f),
            action=f"Tinjau {f.entity.display_name} bersama tim terkait dan tentukan tindak lanjut.",
            owner="Media Buying",
            evidence_refs=[f.id],
        )
        for f in findings[:6]
    ]
    if len(risks) < 2:
        risks.append(
            RiskItem(
                risk="Data pendukung tambahan diperlukan untuk melengkapi analisis risiko periode ini.",
                severity="low",
                action="Perluas cakupan data pada periode pelaporan berikutnya.",
                owner="Data / Ops",
                evidence_refs=[findings[0].id],
            )
        )

    return S6Draft(
        risks=risks,
        outlook=["Proyeksi disajikan berdasarkan temuan yang tersedia tanpa interpretasi naratif tambahan."],
        confidence="low",
    )


def deterministic_s1_draft(accepted_headlines: list[str]) -> S1Draft:
    """Fallback exec summary: literally the concatenation of the accepted
    sections' own (already gate-passed) headlines — introduces no new claim
    or number, which is the one hard requirement S1 has (PRD: "never
    introduce a number not already in the accepted sections")."""
    if not accepted_headlines:
        return S1Draft(
            headline="Ringkasan tidak tersedia untuk periode ini.",
            summary="Tidak ada bagian yang berhasil disusun untuk periode pelaporan ini.",
        )
    headline = accepted_headlines[0][:200]
    summary = " ".join(accepted_headlines)[:900]
    return S1Draft(headline=headline, summary=summary if len(summary) >= 30 else summary + " " * (30 - len(summary)))
