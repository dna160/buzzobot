# M1 — Contracts: catalog · `DeckModel` · `ReportSpec` · lights · grid — HANDOVER

**Status:** ✅ Complete · **Verified:** `pnpm typecheck` 8/8 tasks, `pnpm test` 5/5 tasks
(66 new deck tests + 89 core catalog tests). `uv run pytest` in `tempo-engine/` — 184
passed, 21 skipped: one *fewer* skip than at M0, because the catalog drift check now
finds the co-located repo and actually runs. Verified it fires by mutating `catalog.ts`
and watching it fail, then reverting.

## 1. Scope

PRD §3.2 (`DeckModel`), §3.3 (`ReportSpec`), §3.4 (catalog extension), §3.5 (lights),
§4 S1 (the grid solver). Every type the renderer needs, with its tests, before the
renderer exists. Nothing here renders anything.

## 2. What shipped

### `@tempo/core`

- `domain/enums.ts` — `BriefObjective`, `OBJECTIVE_NORTH_STAR`, `isBriefObjective` moved
  here from `@tempo/reports` (the catalog's bands and the spec's allowed sets are both
  keyed by objective). `@tempo/reports/brief-objective.ts` is now a re-export shim, so
  no importer changed.
- `metrics/catalog.ts` — `MetricDef` gains `labelId` (the Bahasa string a client reads),
  `category`, `bands`, `pickerVisible`. Eight new paid video/delivery keys the day-grain
  brief rollup already sums but the catalog could not name: `videoViews`,
  `videoWatched6s`, `engagedView15s`, `engagements`, `vtr6s`, `vtr15s`, `frequency`,
  `cpv`. 27 metrics total.
- `metrics/catalog.test.ts` — label coverage, no-key-as-label, unique labels,
  direction-consistent bands, organic-not-pickable.

### `tempo-engine` (the other side of the catalog contract)

- `ports/tempo_metrics.py` — the eight new keys ported field-for-field; `CATALOG_SOURCE_SHA256`
  re-pinned; a note on the four deck-only fields the port deliberately does not mirror.
- `tests/test_tempo_metrics_drift.py` — golden extended, and `_find_tempo_repo()` now
  resolves the co-located repo root, so the live-hash half runs by default instead of
  skipping unless someone had two checkouts side by side.

### `@tempo/reports/deck/`

- `model.ts` — `DeckModel`, `Slide`, the `Block` union (`kpiGrid`, `chart`, `table`,
  `findingCard`, `videoGrid`, `roadmap`, `prose`, `coverageNote`), `DeckMeta` with the
  provenance fields the footer prints.
- `lights.ts` — `light()`, `rowLight()`, `deltaDirection()`. Resolution order: target →
  band → delta heuristic → `none`.
- `grid.ts` — `solveKpiGrid()`: 3→`1x3`, 4→`2x2`, 5→`2x3` with a badged auto-fill,
  6→`2x3`, >6 overflows to Lampiran A.
- `spec.ts` — `ReportSpecSchema`, `OBJECTIVE_METRICS`, `REPORT_SPEC_PRESETS`
  (`views`/`jualan`/`install`), `parseReportSpec` (422 via `ReportSpecObjectiveError`),
  `resolveReportSpec` (falls back to the preset and reports, never fails an export).
- Tests: `lights.test.ts` (14), `grid.test.ts` (9), `spec.test.ts` (17).

### `@tempo/db`

- `report_specs` table + `migrations/0005_youthful_master_chief.sql`, keyed by
  (client, objective).
- `repositories/report-spec.ts` — `getReportSpec` / `listReportSpecs` /
  `upsertReportSpec` / `deleteReportSpec`, exported from the package barrel.

## 3. Entry contract for M2

| Contract | Where | Guarantee | Held up by |
| --- | --- | --- | --- |
| `DeckModel` | `deck/model.ts` | The only thing a renderer reads | M2's renderer takes nothing else |
| `light(metric, {value, delta, target, objective})` | `deck/lights.ts` | Total; returns `none` rather than guessing | `lights.test.ts`, incl. monotonicity |
| `solveKpiGrid(metrics, preset)` | `deck/grid.ts` | Deterministic; same spec → same grid | `grid.test.ts` |
| `resolveReportSpec(stored, objective)` | `deck/spec.ts` | Always returns a renderable spec | `spec.test.ts` |
| `parseReportSpec(raw, objective)` | `deck/spec.ts` | 422 on an objective mismatch | `spec.test.ts` |
| `MetricDef.labelId` | `@tempo/core` | Non-empty for every pickable metric | `catalog.test.ts` |
| `getReportSpec(db, clientId, objective)` | `@tempo/db` | `null` means "use the preset" | typecheck; no live-DB test yet |

## 4. How to run / verify

```bash
pnpm install
pnpm typecheck && pnpm test
pnpm --filter @tempo/reports exec vitest run src/deck    # 66 deck tests
cd tempo-engine && uv run pytest tests/test_tempo_metrics_drift.py   # 29, live hash included
```

`report_specs` has no live-database test: `@tempo/db`'s existing suite runs against
PGlite via the ingestion pipeline, and wiring a spec fixture into it is M6's work, when
something actually writes one.

## 5. Deferred

- **Bands for anything but ROAS.** See §7 — deliberate, not an oversight.
- **Objective-specific metric labels.** An install deck should read "Instal", not
  "Konversi", for `conversions`. Handled at M2 in `deck/copy.ts` as an explicit override
  map, not by forking `labelId`.
- **Organic metrics in the picker.** `pickerVisible: false` until an organic day-grain
  rollup exists behind the brief window (M4).
- **`report_specs` write path.** Only reads are wired; the editor is M6.

## 6. Kill-list state

| Row | Made deletable? | Evidence / what is still missing |
| --- | --- | --- |
| K7 report copy monolith | Partially | `labelId` now covers every metric label; the rest of `i18n.ts` dies with K2–K4 at M7 |
| Others | No | Unchanged from M0 |

## 7. Decisions taken here

- **Only ROAS ships a band.** The PRD asks for objective bands in the catalog; this
  codebase only actually commits to one threshold — `insights.ts` has scaled winners at
  ROAS ≥ 3 and reallocated laggards below 2× since Phase 1.5, so that band is reused
  rather than re-decided. No absolute VTR, CPM, or frequency threshold exists anywhere in
  this repo or the engine (both grade those *relatively*), and inventing one to fill a
  column would be the same class of error as inventing a number. Everything else grades
  from a per-client target, from movement, or not at all. Bands are cheap to add once an
  AM states one.
- **`frequency` is `goodDirection: 'neutral'`.** Up is not good: the engine's A01
  generator flags both over-exposure and under-saturation. Consequently `light()` refuses
  to grade it by delta, and a frequency tile stays grey until someone sets a target.
- **`reach` stays `surface: 'organic'` and is the one documented dual-surface key.**
  TikTok reports reach for paid delivery too and the brief window reads it, but splitting
  one client-facing word into two tiles serves nobody. The exception is listed explicitly
  in `catalog.test.ts` rather than left as a hole in the rule.
- **Install decks exclude `roas` and `conversionValue`.** Tempo has no revenue column an
  install client could stand behind (engine `INSTALL_OBJECTIVE_CONTRACT` confirms it), so
  a revenue tile there would be a fabricated outcome — the same rule §3.3 applies to
  awareness, applied consistently.
- **A stale spec falls back instead of failing.** `resolveReportSpec` reports the
  problem and renders the preset. The deck always renders (PRD §1's surviving doctrine);
  a client whose north star changed should not get a 500 instead of a deck.
- **Incidental fix:** `esbuild` added to `@tempo/db`'s devDependencies. Its `build`
  script has always called `esbuild`, but the package never depended on it, so
  `pnpm typecheck` (which turbo runs after `^build`) failed on a clean install. One line,
  unrelated to the deck, but it blocked the repo's own documented verification command.
