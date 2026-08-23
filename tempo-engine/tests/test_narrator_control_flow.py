"""Narrator retry/fallback control flow, tested against a mock LM Studio
client so it's fast and deterministic — independent of the live model's
actual behavior (covered separately in test_live_narrator_exit_gate.py).
"""

from __future__ import annotations

import json

from engine.agents.narrator import narrate_section
from engine.contracts import Confidence, EntityRef, Finding, FindingLevel, SectionId, SectionPayload
from engine.llm.client import LmStudioError
from eval.fixtures.sovella_gmv_week import GMV_OBJECTIVE_CONTRACT


class _ScriptedClient:
    """Returns each entry in `responses` in order across successive calls.
    A string entry is returned as-is (as if it were the raw model reply); an
    exception instance is raised instead, simulating an unreachable server."""

    def __init__(self, responses: list) -> None:  # noqa: ANN001
        self.responses = list(responses)
        self.calls = 0

    async def complete_json(self, **kwargs) -> str:  # noqa: ANN003
        self.calls += 1
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def _finding() -> Finding:
    return Finding(
        id="f1", generator="G01", tenant_id="sovella", brief_type="gmv", section_affinity=[2],
        entity=EntityRef(id="sovella", display_name="Sovella"), level=FindingLevel.ACCOUNT,
        claim_frame="identity_decomposition",
        evidence={"gmv": 506_058_865, "roi": 9.41, "current_active_days": 4, "prior_active_days": 7},
        comparison=None,
        magnitude_pct=1.0, direction="positive", actionability="high", confidence="high", materiality=0.5,
    )


def _payload(confidence_tier: Confidence = Confidence.HIGH) -> SectionPayload:
    return SectionPayload(
        tenant_id="sovella", brief_type="gmv", section_id=SectionId.S2_PERIOD_COMPARISON,
        objective_contract=GMV_OBJECTIVE_CONTRACT, findings=[_finding()], confidence_tier=confidence_tier,
    )


_GOOD_RESPONSE = json.dumps({
    "headline": "GMV mencapai Rp 506.058.865 pada periode ini",
    "mechanism": "ROI tercatat 9,41x pada periode berjalan berdasarkan data yang tersedia.",
    "evidence_refs": ["f1"],
    "implication": "Efisiensi belanja tetap terjaga pada level yang sehat.",
    "action": "Pertahankan alokasi anggaran saat ini dan pantau tren pada periode berikutnya.",
    "confidence": "high",
})

_ORPHAN_NUMERAL_RESPONSE = json.dumps({
    "headline": "GMV mencapai Rp 999.999.999 pada periode ini",  # not in evidence
    "mechanism": "ROI tercatat 9,41x pada periode berjalan berdasarkan data yang tersedia.",
    "evidence_refs": ["f1"],
    "implication": "Efisiensi belanja tetap terjaga pada level yang sehat.",
    "action": "Pertahankan alokasi anggaran saat ini dan pantau tren pada periode berikutnya.",
    "confidence": "high",
})

_MALFORMED_JSON = "{not valid json"


async def test_narrator_returns_llm_draft_on_first_success() -> None:
    client = _ScriptedClient([_GOOD_RESPONSE])
    result = await narrate_section(_payload(), client)
    assert result.source == "llm"
    assert result.attempts == 1
    assert client.calls == 1


async def test_narrator_retries_once_then_succeeds() -> None:
    client = _ScriptedClient([_ORPHAN_NUMERAL_RESPONSE, _GOOD_RESPONSE])
    result = await narrate_section(_payload(), client)
    assert result.source == "llm"
    assert result.attempts == 2
    assert client.calls == 2


async def test_narrator_falls_back_after_max_attempts_exhausted() -> None:
    client = _ScriptedClient([_ORPHAN_NUMERAL_RESPONSE, _ORPHAN_NUMERAL_RESPONSE])
    result = await narrate_section(_payload(), client)
    assert result.source == "fallback"
    assert result.attempts == 2
    assert result.fallback_reason is not None
    assert "numeral gate" in result.fallback_reason


async def test_narrator_falls_back_on_malformed_json() -> None:
    client = _ScriptedClient([_MALFORMED_JSON, _MALFORMED_JSON])
    result = await narrate_section(_payload(), client)
    assert result.source == "fallback"


async def test_narrator_falls_back_when_lm_studio_unreachable() -> None:
    client = _ScriptedClient([LmStudioError("connection refused"), LmStudioError("connection refused")])
    result = await narrate_section(_payload(), client)
    assert result.source == "fallback"
    assert "connection refused" in (result.fallback_reason or "")


async def test_narrator_never_calls_the_client_when_no_findings_routed() -> None:
    client = _ScriptedClient([])
    payload = SectionPayload(
        tenant_id="sovella", brief_type="gmv", section_id=SectionId.S5_CREATIVE_ENTITY,
        objective_contract=GMV_OBJECTIVE_CONTRACT, findings=[], confidence_tier=Confidence.HIGH,
    )
    result = await narrate_section(payload, client)
    assert result.source == "fallback"
    assert result.attempts == 0
    assert client.calls == 0


async def test_narrator_respects_low_confidence_schema() -> None:
    good_low = json.dumps({
        "headline": "Cakupan data terbatas pada periode ini",
        "mechanism": "Hanya 4 dari 7 hari aktif tersedia untuk periode ini.",
        "evidence_refs": ["f1"],
        "action": "Tunggu cakupan data lengkap sebelum menarik kesimpulan lebih lanjut.",
        "confidence": "low",
    })
    client = _ScriptedClient([good_low])
    result = await narrate_section(_payload(Confidence.LOW), client)
    assert result.source == "llm"
    assert not hasattr(result.draft, "implication")
