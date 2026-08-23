"""Pure-function tests for tempo_read.py — no database required."""

from __future__ import annotations

from datetime import date

import pytest

from engine.ports.tempo_read import parse_database_url, resolve_window


def test_parse_database_url_handles_at_sign_in_password() -> None:
    # Tempo's own .env has exactly this shape.
    parsed = parse_database_url("postgres://postgres:Forest@910@localhost:5433/tempo")
    assert parsed == {
        "user": "postgres",
        "password": "Forest@910",
        "host": "localhost",
        "port": 5433,
        "database": "tempo",
    }


def test_parse_database_url_default_port() -> None:
    parsed = parse_database_url("postgres://user:pass@host/db")
    assert parsed["port"] == 5432


def test_parse_database_url_rejects_non_url() -> None:
    with pytest.raises(ValueError):
        parse_database_url("not-a-url")


def test_resolve_window_clamps_to_nearest_available_date() -> None:
    available = [date(2026, 6, 20), date(2026, 6, 21), date(2026, 6, 25)]
    first, last, prior_first, prior_last = resolve_window(available, date(2026, 6, 23), window_days=3)
    # 6/23 requested but not ingested; clamps down to the nearest available date <= it (6/21).
    assert last == date(2026, 6, 21)
    assert first == date(2026, 6, 19)
    assert prior_last == date(2026, 6, 18)
    assert prior_first == date(2026, 6, 16)


def test_resolve_window_defaults_to_latest_available() -> None:
    available = [date(2026, 6, 20), date(2026, 6, 25)]
    first, last, prior_first, prior_last = resolve_window(available, None, window_days=7)
    assert last == date(2026, 6, 25)
