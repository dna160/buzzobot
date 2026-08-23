# Tempo Intelligence Engine

Analysis, agentic orchestration, and narrative synthesis behind Tempo Insight
Engine (`dna160/buzzobot`). See `docs/PRD_tempo_intelligence_engine.md` for
the full spec — this file is just setup.

Tempo is the surface (ingestion, storage, dashboard, delivery). This engine
reads Tempo's Postgres read-only and owns its own `insight.*` schema in the
same database. See `src/engine/ports/tempo_read.py` for the boundary and why
it's `public.*`, not a literal `tempo.*` schema.

## Setup

```bash
uv sync
```

### One-time: bootstrap the read-only Postgres role

Requires Tempo's own admin/superuser connection string (never checked into
this repo):

```bash
TEMPO_ADMIN_DATABASE_URL="postgres://postgres:...@localhost:5433/tempo" \
    uv run python scripts/bootstrap_engine_role.py
```

Creates the `insight` schema, creates (or rotates the password of) the
`tempo_engine` role — `SELECT`-only on `public.*`, full rights on
`insight.*` — and writes `TEMPO_ENGINE_DATABASE_URL` to `.env` (gitignored).

### Tests

```bash
uv run pytest
```

`tests/test_boundary.py` requires `TEMPO_ENGINE_DATABASE_URL` (from the
bootstrap step above) and a live Postgres — skipped otherwise.

`tests/test_tempo_metrics_drift.py`'s live-hash check requires the Tempo
repo checked out locally; set `TEMPO_REPO_PATH` if it's not at the default
sibling location (`../Tempo LM`). Skipped otherwise — the golden-snapshot
half of that test always runs regardless.

## Status

**B0 (foundation) complete.** Repo skeleton, read-only Postgres boundary
(verified live), `insight` schema, METRICS catalog port + drift check.

GOV-1 (Tempo repo visibility/git-history audit) and GOV-2 (narrative
provider default) are explicitly out of scope for this repo — they're
changes to `dna160/buzzobot`, being handled separately.

Next: **B1** — contracts (`Finding`, `ObjectiveContract`, `MetricFrame`,
`SectionSpec`).
