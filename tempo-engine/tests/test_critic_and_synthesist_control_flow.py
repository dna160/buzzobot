"""Critic and synthesist control flow, tested against scripted mock
clients — fast and deterministic, independent of live model behavior
(covered separately in test_brief_graph_live.py).
"""

from __future__ import annotations

import json

from engine.agents.critic import critique_section
from engine.agents.synthesist import synthesize_s1, synthesize_s6
from engine.contracts import EntityRef, Finding, FindingLevel
from engine.llm.schemas import S1_JSON_SCHEMA, S6_JSON_SCHEMA, json_schema_for
from engine.contracts import Confidence


class _ScriptedClient:
    def __init__(self, responses: list) -> None:  # noqa: ANN001
        self.responses = list(responses)
        self.calls = 0

    async def complete_json(self, **kwargs) -> str:  # noqa: ANN003
        self.calls += 1
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def _finding(id: str = "f1") -> Finding:  # noqa: A002
    return Finding(
        id=id, generator="G01", tenant_id="sovella", brief_type="gmv", section_affinity=[2],
        entity=EntityRef(id="sovella", display_name="Sovella"), level=FindingLevel.ACCOUNT,
        claim_frame="identity_decomposition", evidence={"gmv": 506_058_865, "roi": 9.41}, comparison=None,
        magnitude_pct=1.0, direction="positive", actionability="high", confidence="high", materiality=0.5,
    )


_ORIGINAL_DRAFT = {
    "headline": "GMV mencapai Rp 506.058.865 pada periode ini",
    "mechanism": "ROI tercatat 9,41x pada periode berjalan.",
    "evidence_refs": ["f1"],
    "implication": "Efisiensi belanja tetap terjaga.",
    "action": "Pertahankan alokasi anggaran saat ini.",
    "confidence": "high",
}


async def test_critic_approves_a_clean_draft() -> None:
    client = _ScriptedClient([json.dumps({"approved": True, "notes": "looks good", "revised_draft": _ORIGINAL_DRAFT})])
    result = await critique_section(_ORIGINAL_DRAFT, json_schema_for(Confidence.HIGH), [_finding()], client)
    assert result.ok
    assert result.approved
    assert result.revised_draft_json == _ORIGINAL_DRAFT


async def test_critic_adopts_a_valid_revision() -> None:
    revised = {**_ORIGINAL_DRAFT, "action": "Tinjau alokasi anggaran kampanye utama minggu depan."}
    client = _ScriptedClient([json.dumps({"approved": False, "notes": "action too vague", "revised_draft": revised})])
    result = await critique_section(_ORIGINAL_DRAFT, json_schema_for(Confidence.HIGH), [_finding()], client)
    assert result.ok
    assert not result.approved
    assert result.revised_draft_json["action"] == revised["action"]


async def test_critic_rejects_a_revision_that_introduces_an_orphan_number() -> None:
    bad_revision = {**_ORIGINAL_DRAFT, "mechanism": "ROI tercatat 15,00x, meningkat pesat."}
    client = _ScriptedClient([json.dumps({"approved": False, "notes": "...", "revised_draft": bad_revision})])
    result = await critique_section(_ORIGINAL_DRAFT, json_schema_for(Confidence.HIGH), [_finding()], client)
    assert not result.ok  # falls back to keeping the original draft
    assert result.revised_draft_json == _ORIGINAL_DRAFT


async def test_critic_falls_back_gracefully_on_unreachable_server() -> None:
    from engine.llm.client import LmStudioError

    client = _ScriptedClient([LmStudioError("connection refused")])
    result = await critique_section(_ORIGINAL_DRAFT, json_schema_for(Confidence.HIGH), [_finding()], client)
    assert not result.ok
    assert result.revised_draft_json == _ORIGINAL_DRAFT


_S6_GOOD = json.dumps({
    "risks": [
        {"risk": "GMV bergantung pada satu kampanye utama.", "severity": "medium", "action": "Diversifikasi anggaran ke kampanye lain minggu depan.", "owner": "Media Buying", "evidence_refs": ["f1"]},
        {"risk": "ROI berada pada level yang sehat namun perlu dipantau.", "severity": "low", "action": "Tinjau ROI mingguan bersama tim media buying.", "owner": "Media Buying", "evidence_refs": ["f1"]},
    ],
    "outlook": ["Efisiensi diperkirakan tetap stabil pada periode berikutnya."],
    "confidence": "medium",
})


async def test_synthesize_s6_returns_llm_draft_on_success() -> None:
    client = _ScriptedClient([_S6_GOOD])
    result = await synthesize_s6([_finding()], "S2: ringkasan periode.", client)
    assert result.source == "llm"
    assert len(result.draft.risks) == 2


async def test_synthesize_s6_falls_back_on_bad_evidence_ref() -> None:
    bad = json.loads(_S6_GOOD)
    bad["risks"][0]["evidence_refs"] = ["never_given"]
    client = _ScriptedClient([json.dumps(bad), json.dumps(bad)])
    result = await synthesize_s6([_finding()], "S2: ringkasan periode.", client)
    assert result.source == "fallback"
    assert "never_given" in (result.fallback_reason or "")


_S1_GOOD = json.dumps({
    "headline": "GMV mencapai Rp 506.058.865 dengan ROI yang kuat.",
    "summary": "Periode ini mencatat GMV Rp 506.058.865 dengan ROI 9,41x, menunjukkan efisiensi belanja yang sehat secara keseluruhan.",
})


async def test_synthesize_s1_returns_llm_draft_on_success() -> None:
    client = _ScriptedClient([_S1_GOOD])
    result = await synthesize_s1(["S2 headline"], [_finding()], "S2: ringkasan.", client)
    assert result.source == "llm"
    assert result.draft.headline


async def test_synthesize_s1_truncates_an_overlong_headline_instead_of_falling_back() -> None:
    """Found live: a small local model asked for "one sentence" routinely
    writes a headline over S1Draft's 200-char limit — the whole executive
    summary (the first thing a reader sees) was falling back to generic
    boilerplate over this alone, even though the rest of the content was
    real and on-topic. The repair trims at a word boundary and keeps the
    LLM-sourced content rather than discarding it."""
    overlong = json.dumps({
        "headline": ("GMV mencapai Rp 506.058.865 dengan ROI yang sangat kuat pada periode ini " * 3).strip(),
        "summary": "Periode ini mencatat GMV yang kuat dengan ROI yang sehat secara keseluruhan.",
    })
    client = _ScriptedClient([overlong])
    result = await synthesize_s1(["S2 headline"], [_finding()], "S2: ringkasan.", client)
    assert result.source == "llm"
    assert len(result.draft.headline) <= 200
    assert result.draft.headline.startswith("GMV mencapai Rp 506.058.865")


async def test_synthesize_s1_falls_back_when_no_accepted_sections() -> None:
    client = _ScriptedClient([])
    result = await synthesize_s1([], [], "", client)
    assert result.source == "fallback"
    assert result.attempts == 0
    assert client.calls == 0


async def test_synthesize_s1_falls_back_on_orphan_numeral() -> None:
    bad = json.dumps({"headline": "GMV melonjak 999%", "summary": "GMV melonjak 999% dibanding periode lalu yang belum pernah terjadi sebelumnya."})
    client = _ScriptedClient([bad, bad])
    result = await synthesize_s1(["S2 headline"], [_finding()], "S2: ringkasan.", client)
    assert result.source == "fallback"
