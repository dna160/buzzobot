"""Reviewer edit capture (Strategy Report PRD §11.4): only engine-written text
is editable, edits apply in place, and the distance is 0 untouched → 1 rewritten."""

from __future__ import annotations

import pytest

from engine.api.edits import Edit, EditError, apply_edits, edit_distance

CONTENT = {
    "sections": {
        "103": {"narration_source": "llm", "draft": {"headline": "Funnel bocor di Consideration.", "paragraphs": [{"text": "Ukuran tahap 4,47%.", "evidence_refs": ["f"]}]}},
        "101": {"narration_source": "template", "draft": {"headline": "Vonis.", "paragraph": "Ringkas.", "chips": [{"value": "#38"}]}},
    },
    "action_plan": [{"copy": {"langkah": "Naikkan …", "dasar": "x", "cara": "y", "gagal_jika": "z"}, "current": {"value": 0.0447}}],
    "findings": [{"evidence": {"size_ratio": 0.0447}}],
}


def _content() -> dict:
    import json

    return json.loads(json.dumps(CONTENT))


def test_distance_bounds():
    assert edit_distance("sama", "sama") == 0.0
    assert edit_distance("abc", "xyz") == 1.0
    assert 0 < edit_distance("Funnel bocor di Consideration.", "Funnel bocor besar di Consideration.") < 0.15


def test_applies_and_reports_only_changes():
    c = _content()
    applied = apply_edits(c, [
        Edit(path="sections.103.draft.paragraphs.0.text", text="Ukuran tahap Conversion 4,47%."),
        Edit(path="sections.103.draft.headline", text="Funnel bocor di Consideration."),  # unchanged
        Edit(path="action_plan.0.copy.cara", text="Langkah konkret."),
        Edit(path="sections.101.draft.paragraph", text="Ringkasan baru."),
    ])
    assert [(a.path, a.section_id, a.narration_source) for a in applied] == [
        ("sections.103.draft.paragraphs.0.text", "103", "llm"),
        ("action_plan.0.copy.cara", "T2", None),
        ("sections.101.draft.paragraph", "101", "template"),
    ]
    assert c["sections"]["103"]["draft"]["paragraphs"][0]["text"] == "Ukuran tahap Conversion 4,47%."
    assert c["action_plan"][0]["copy"]["cara"] == "Langkah konkret."


@pytest.mark.parametrize("path", [
    "findings.0.evidence.size_ratio",          # analysis, not copy
    "action_plan.0.current.value",             # solver numbers
    "sections.101.draft.chips.0.value",        # chip values are code's
    "sections.103.draft.paragraphs.0.evidence_refs",
    "sections.999.draft.headline",             # no such section
])
def test_refuses_non_copy_paths(path):
    with pytest.raises(EditError):
        apply_edits(_content(), [Edit(path=path, text="x")])
