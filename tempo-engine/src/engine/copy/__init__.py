"""Deterministic copy tables (Brief Deck PRD §5). No model calls live here."""

from engine.copy.templates import (
    FRAME_COPY,
    FrameCopy,
    action_for,
    headline_for,
    instant_s1_draft,
    instant_s6_draft,
    instant_section_draft,
    mechanism_for,
)

__all__ = [
    "FRAME_COPY",
    "FrameCopy",
    "action_for",
    "headline_for",
    "instant_s1_draft",
    "instant_s6_draft",
    "instant_section_draft",
    "mechanism_for",
]
