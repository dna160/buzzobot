# M0 — Engine boundary: content v2 · tiers · `/healthz` — HANDOVER

**Status:** ✅ Complete · **Verified:** `uv run pytest` in `tempo-engine/` — 175 passed,
22 skipped (the skips are the live LM Studio / Postgres suites, unchanged); the new
instant-tier and content-v2 suites run fully offline. `pnpm --filter @tempo/reports test`
— the boundary drift check passes against the generated schema, and caught one real
mismatch while being written (see §7).

## 1. Scope

PRD §3.1 (content v2), §5 (generation tiers), §7 (`/healthz`), §11 R4 (template variety).
Everything a deck is made of already existed inside a graph run; M0 is the milestone that
stops throwing it away at the server boundary, and makes the LLM a *tier* rather than a
prerequisite. No renderer work — deliberately. A contract that ships after its first
consumer is a contract nobody can review.

## 2. What shipped

### `tempo-engine/`

- `src/engine/contracts/content.py` — `BriefContentV2`: `content_version`, `tier`,
  `engine_version`, `brief_type`, all `findings`, per-section `rankings` (selected **and**
  below-the-cut), the `CoverageAudit`, the probe log, plus every v1 key unchanged.
- `src/engine/graphs/coverage.py` — `build_coverage_audit()`: G08's evidence and the
  battery's `CoverageGap`s reshaped into counted denominators. Computes nothing a
  generator did not already compute.
- `src/engine/copy/templates.py` — the closed `claim_frame` → copy table. 2 headline and
  2 action variants for each of the 30 frames, chosen by `sha256(finding.id)`; mechanism
  sentences built from `evidence` verbatim, so instant copy is numeral-gate-safe by
  construction. Unknown frame → generic copy, never an error.
- `src/engine/graphs/brief.py` — `tier` in state; conditional edges skip the probe loop
  *and* the narrator/critic/synthesist chain on `instant`; new `instant_copy_node`. Both
  tiers pass the same `interrupt()` review gate.
- `src/engine/api/dispatcher.py` — `_content_from_state()` emits v2; `tier` parameter on
  `start_brief_run` / `run_brief_sync`, defaulting to `full`.
- `src/engine/api/app.py` — `tier` on both POST bodies; `GET /healthz`.
- `src/engine/version.py`, `graphs/persistence.py::brief_stats()` — provenance and
  last-run stats.
- `scripts/export_content_schema.py` + `contracts/brief_content_v2.schema.json`,
  `scripts/dump_deck_fixture.py`.
- Tests: `tests/test_instant_tier.py` (8), `tests/test_content_schema_export.py` (2).

### `packages/`

- `packages/reports/src/deck/engine-content.ts` — the TypeScript mirror (zod), plus
  `parseEngineContent()` which normalizes pre-M0 v1 payloads up to the v2 shape, and
  `selectedFindings()`.
- `packages/reports/src/deck/engine-content.drift.test.ts` — 22 assertions against the
  generated JSON Schema.
- `packages/reports/src/deck/fixtures/engine-content.gmv.instant.json` — a real instant
  run of the Sovella GMV fixture (11 findings, coverage gaps, below-the-cut rankings).

## 3. Entry contract for M1/M2

| Contract | Where | Guarantee | Held up by |
| --- | --- | --- | --- |
| `BriefContentV2` | `engine/contracts/content.py` | Additive over v1 — every v1 key keeps its name and shape | `test_instant_tier.py::test_content_v2_exports_*` |
| `brief_content_v2.schema.json` | `tempo-engine/contracts/` | Regenerated from the model, never hand-edited | `test_content_schema_export.py` (Python) + `engine-content.drift.test.ts` (TS) |
| `parseEngineContent(raw)` | `@tempo/reports` `deck/engine-content.ts` | Returns one shape for v1 and v2 input; throws on neither | `engine-content.drift.test.ts` |
| `tier: 'instant' \| 'full'` | `POST /v1/briefs`, `/v1/briefs/sync` | `instant` constructs no LM Studio client at all | `test_instant_tier.py` (fails if the client is instantiated) |
| `GET /healthz` | tempo-engine | Never raises; reports `db: false` with a 200 | manual — no live-Postgres CI job yet |
| `engine-content.gmv.instant.json` | `deck/fixtures/` | Real engine output, regenerable via `scripts/dump_deck_fixture.py` | consumed by M2's build/render tests |

Not stable yet: the `sections['n'].draft` shape stays a loose object on the TS side on
purpose — the confidence ladder (`SectionDraftFull` vs `SectionDraftLow`) is owned by
`llm/schemas.py`, and mirroring it strictly here would fork it.

## 4. How to run / verify

```bash
cd tempo-engine
uv sync
uv run pytest                                        # 175 passed, 22 skipped
uv run python scripts/export_content_schema.py --check
uv run python scripts/dump_deck_fixture.py ../packages/reports/src/deck/fixtures/engine-content.gmv.instant.json

cd ..
pnpm --filter @tempo/reports test                    # includes the drift check
```

Skipped without extras: every `test_live_*`, `test_brief_graph_live`, `test_boundary`
(needs `TEMPO_ENGINE_DATABASE_URL`), `test_probe_loop_live` and the narrator exit gate
(need LM Studio). The instant tier and both halves of the drift check need neither.

## 5. Deferred

- **Latency measurement.** The ≤ 10 s p95 instant budget (PRD §9) is a nightly-CI
  assertion against a real client, not a unit test. M5 owns it.
- **`/healthz` in CI.** Needs a live Postgres; asserted by hand for now.
- **Full-tier content v2 on real data.** The instant path is proven offline; the full
  path shares every node up to `materiality_router`, but its end-to-end proof needs LM
  Studio and belongs to the existing live exit-gate suites.
- **Probe-origin findings in a deck.** Exported (`origin: 'probe'`), rendered at M3.

## 6. Kill-list state

| Row | Made deletable? | Evidence / what is still missing |
| --- | --- | --- |
| K1 fact-sheet narrative stack | No | Needs the deck to be the only narration consumer (M3), then M7 |
| K4 A4 engine-brief renderer | No | Still the only renderer; dies at M3 |
| K6 `ReportAiSettings` | Partially | `/healthz` exists — the card that replaces the UI is M5 |

## 7. Decisions taken here

- **Engine-side `tier` default is `full`, not `instant`.** PRD §5 makes `instant` the
  *portal's* default; a caller that never heard of tiers must keep getting what it got
  before. The surface states its choice explicitly (M2) rather than inheriting one.
- **`comparison` is required-but-nullable in the TS mirror.** The drift check's first run
  failed on it: Python's `Comparison | None` has no default, so the key is always on the
  wire, and `.optional()` would have let a malformed payload through. Fixed the mirror,
  not the check — this is exactly the class of bug the check exists for.
- **Coverage denominators are conservative.** A generator that skipped never produced a
  finding, so its section affinity is unknowable; it is counted against every section.
  That can understate coverage but can never overstate it, and overstating is the failure
  mode that matters when the number is printed to a client.
- **Instant copy delegates its empty state to the fallback writer.** "Tidak ada temuan"
  is worded in exactly one place, so the two paths cannot drift into two different ways
  of saying nothing was found.
- **The fixture is generated, not written.** A hand-mocked payload would drift from the
  engine silently; a generated one fails the TS tests when the engine changes.
