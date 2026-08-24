# M5 — Tiers end-to-end · `report_runs` + cron · engine health card — HANDOVER

**Status:** ✅ Complete · **Verified:** `pnpm typecheck` 8/8, `pnpm lint` 8/8, `pnpm test`
6/6 — 25 tests in `@tempo/db` (the run ledger against real migrations on PGlite), 6 in
`@tempo/ingestion`, 175 in `@tempo/reports`. The ledger test caught a real bug before the
code ever ran: an async run has no window yet, and `''` is not a `date` (§7).
**K6 is dead** — `ReportAiSettings.tsx` no longer exists.

## 1. Scope

PRD §5 (generation tiers as a product flow), §7 (`/healthz`), §11 R1, K6. M0 made `tier` a
real parameter; M5 makes it a real experience: the routine Monday download is instant
*and* fully narrated, because it was rendered on Sunday night.

## 2. What shipped

### `@tempo/db`

- `report_runs` (migrations `0007`, `0008`) — one row per generation, keyed by
  (client, objective, window, tier). The window is **nullable**: an async run is recorded
  before the rollup that decides its window has been read.
- `repositories/report-run.ts` — `startReportRun` / `completeReportRun` / `failReportRun`,
  `latestCompletedRun` (the cache lookup, with a freshness cutoff), `recentReportRuns`,
  and the artifact store (`writeArtifact` / `readArtifact`).
- `report-run.test.ts` (8) — the cache key, the freshness rule, the async window fill-in,
  and the guarantee that a failed or in-flight run is never servable.

### `apps/ingestion`

- `pregenerate-decks.ts` — the weekly job. Calls the **public route** rather than
  reassembling the pipeline, so the artifact a client downloads is byte-for-byte the one
  this job produced. Failures are per client.
- `deck-cron.ts` — the daemon (`decks:cron`, `decks:now`), default Mondays 03:00, added to
  `ecosystem.config.cjs`.
- `pregenerate-decks.test.ts` (6) — including a test that the job never asks for a deck
  the route would refuse with a 409.

### `apps/web`

- `lib/deck-pipeline.ts` — `assembleDeck()`: one assembly path, now used by both entry
  points. A "full" deck that differed depending on which endpoint rendered it would make
  the tier badge a lie.
- The brief route serves a **pre-generated artifact** for `tier=full` when one exists for
  the exact window and is fresh (`?fresh=1` forces a regeneration), records every
  generation, and stores full-tier renders. `X-Deck-Artifact: pregenerated | stored | live`
  and `X-Deck-Generated-At` say plainly which one a caller got.
- `…/brief/[objective]/full/route.ts` — `POST` starts an async full run,
  `GET ?runId=` polls and renders when the engine finishes. The review gate is exercised
  with the same automatic approval `/v1/briefs/sync` uses.
- `settings.getEngineHealth` + `EngineHealthCard.tsx` — **K6**. `ReportAiSettings.tsx` is
  deleted; `/settings` now shows engine reachability, version, contract version, tiers,
  probe-loop state, and the recent deck runs.

## 3. Entry contract for M6

| Contract | Where | Guarantee | Held up by |
| --- | --- | --- | --- |
| `assembleDeck(args)` | `apps/web/lib/deck-pipeline.ts` | Both routes build the identical deck | typecheck; both call sites |
| `latestCompletedRun(db, key, maxAgeHours?)` | `@tempo/db` | Exact-window match, freshness-bounded, never a failed run | `report-run.test.ts` |
| `startReportRun` / `completeReportRun` | `@tempo/db` | A run with no window yet is recordable and unservable | `report-run.test.ts` |
| `POST/GET …/brief/:objective/full` | `apps/web` | Async start + poll; renders once, stores, reports a download URL | typecheck; no route test yet |
| `settings.getEngineHealth` | `apps/web` | Never throws — unreachable is a rendered state | typecheck |
| `pregenerateDecks(options)` | `@tempo/ingestion` | Per-client failures; only objectives the route allows | `pregenerate-decks.test.ts` |

M6 (the spec editor) needs none of this. It builds on M1's `ReportSpecSchema`,
`REPORT_SPEC_PRESETS` and the `report_specs` repository, plus `solveKpiGrid` for the
preview.

## 4. How to run / verify

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm db:migrate                                     # applies 0007 + 0008
pnpm --filter @tempo/ingestion decks:now            # pre-generate once, now
pm2 start ecosystem.config.cjs                      # includes tempo-deck-cron
```

`DECK_CRON_API_KEY` must be one of `REPORT_API_KEYS` — the job is an external caller and
the route fails closed. Without it the job refuses to start rather than producing a
directory of 401s.

## 5. Deferred

- **The latency budgets** (instant ≤ 10 s, full ≤ 6 min p95, PRD §9 item 6). They need a
  live stack and a nightly CI job; nothing here measures wall-clock against a real client.
- **A portal UI for the swap.** The endpoints exist and are documented; the button that
  downloads instant, polls, and then swaps the link lives in the Buzzo portal, not this
  repo. `ExportDailyBriefButton.tsx` still downloads a single deck.
- **Route-level tests.** `apps/web` has no test harness; both routes are covered by
  typecheck plus the unit tests underneath them.
- **Artifact retention.** Nothing prunes `TEMPO_ARTIFACT_DIR` yet. At one PDF per client ×
  objective per week that is slow-growing, but it grows.
- **A live engine `/healthz`.** The card renders both states; the reachable one has not
  been exercised against a running engine here.

## 6. Kill-list state

| Row | Made deletable? | Evidence / what is still missing |
| --- | --- | --- |
| **K6** `ReportAiSettings` | **Deleted** | Replaced by the engine health card, which answers the question that actually matters now |
| K1 fact-sheet narrative stack | Closer | Its last UI consumer is gone; the settings *router* procedures (`getReportAi`, `updateReportAi`, `testReportAiConnection`) are part of K1 and die with it at M7 |
| K2 / K3 / K5 / K7 | No | All M7 |

## 7. Decisions taken here

- **An unknown window is null, not `''`.** The ledger test failed on
  `invalid input syntax for type date: ""` — an async run genuinely does not know its
  window when it starts, and a sentinel that the database rejects is not a model of that.
  Nullable also makes the safety property structural: `latestCompletedRun` matches exact
  dates, so an in-flight run can never be mistaken for a servable artifact.
- **Freshness is a time window, not a version check.** The surface has no cheap way to
  know whether the facts moved since an artifact was rendered, and guessing wrong means
  handing a client a number the dashboard no longer shows. 24 hours by default; `?fresh=1`
  to override.
- **The cron calls the public route.** It could import the pipeline directly and skip the
  HTTP hop, but then the artifact it produces would be built by a second code path — and
  the one thing a pre-generated deck must be is *the same deck*.
- **The full tier's engine call starts after the artifact check**, while the instant tier
  keeps its parallel fetch. Starting a run we intend to throw away would burn an LM Studio
  run per download; the instant tier has nothing to gain by waiting.
- **The render happens on the poll that finds the run ready**, not in a background task.
  There is no job queue here, and a promise left running after a response returns is a
  promise that may never finish.
- **The health card answers from two directions.** `/healthz` is the engine's view,
  `report_runs` is the surface's. When the engine is unreachable — exactly when someone
  opens Settings — the run history still says when decks last worked.
