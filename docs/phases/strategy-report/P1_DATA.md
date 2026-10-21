# P1 — Data — HANDOVER

**Status:** ✅ Complete. · **Verified:** on 2026-10-21 these ran against the live Tempo DB:
- `db:migrate` applied 0014–0015 (16 migrations recorded).
- `db:market-scope` backfilled 11 TTMS accounts into 10 clients, covering 2025-09-14 … 2026-10-18 (13,416 audience, 224,718 insight and 707,448 ranking rows). Purbasari is primary over Senka. Exactly the 4 accounts P0 predicted are unlinked.
- The verifier found **row counts match the portal for every account, table and day**, 2024-01-01 … 2026-10-21.
- The engine's SELECT-only role reads all six new tables.
- Every package suite passes: core 253, db 68 (1 opt-in live test skipped), reports 234, tiktok 19, engine 239 non-live.

## 1. Scope

Strategy Report PRD §12 P1: the data the report needs, inside Tempo's own DB.
- §6.3: Market Scope mirror tables and sync step.
- §6.4: `strategy_specs` and `strategy_actions`.
- §6.5: catalog keys and `DataSurface.MARKET_SCOPE`, with the engine drift golden.
- §9.5: repositories and tRPC for specs and actions.
- §13 item 9: `.env.example`.

Built with the P0 corrections adopted (product decision, 2026-10-21); see §7.

Also on this branch (`feat/strategy-p1-data`), from before P1 proper:
- `79681f5`: GMV Max spend fix and spend-parity check (P0 blocker #1).
- `0bbaac5`: the share-link work committed as found, so migration 0013 sits under P1's 0014/0015.

## 2. What shipped

**packages/core**
- `src/metrics/catalog.ts`: 52 Market Scope keys generated from `TTMS_STAGES`, `TTMS_INSIGHT_METRICS` and `TTMS_CONTENT_TYPES`; `MarketScopeMetricKey`; `MetricFormat` gains `'rank'`.
- `src/domain/enums.ts`: `DataSurface.MarketScope`, `ReportClass`, `isReportClass`.
- `src/utils/format.ts`: `rank` → `#n`.
- `src/metrics/catalog.test.ts`: family counts, P0 exclusions, neutral content shares, picker exclusion, rank direction.

**packages/db**
- `src/schema.ts`:
  - `market_scope_accounts`, `market_scope_audience_daily`, `market_scope_insights_daily`, `market_scope_rankings_daily`
  - `strategy_specs`, `strategy_actions`
  - every constraint named explicitly to stay under Postgres's 63-character limit
- `migrations/0014_market_scope.sql`, `migrations/0015_strategy_specs_actions.sql` (drizzle-kit generated).
- `src/ingest/market-scope-sync.ts`: `syncMarketScope`, `verifyMarketScopeMirror`, `linkMarketScopeAccounts`, normalisers. Wired into `fetchSanitizeAndSeed` as step 3, after the brand loops. A failure there is logged and never fails the ads sync.
- `src/scripts/market-scope-sync.ts` → `pnpm --filter @tempo/db db:market-scope [--verify-only] [--backfill-days N] [--account ID]`.
- `src/repositories/strategy-spec.ts`: get, upsert, delete; `listMarketScopeAccounts`.
- `src/repositories/strategy-action.ts`: insert proposed, list, accept, snooze. Each transition is guarded inside the UPDATE.
- Tests:
  - `src/ingest/market-scope-sync.test.ts`: link rules, normalisation, PGlite backfill, overwrite on re-sync, verifier.
  - `src/repositories/strategy.test.ts`: spec CRUD, check constraints, account order, action races.

**packages/reports**
- `src/strategy-report/spec.ts`: `StrategySpecSchema`, `parseStrategySpec` (ZodError → 400, `StrategySpecError` → 422), row mapping. Exported from the barrel.
- `src/strategy-report/spec.test.ts`
- `src/deck/metric-values.ts`: Market Scope keys resolve to `null` in the deck, an explicit decision. The brief window has no TTMS read-model.

**apps/web**
- `src/server/routers/strategy-spec.ts`: `get`, `save`, `reset`.
- `src/server/routers/strategy-action.ts`: `list`, `accept`, `snooze`.
- `src/server/root.ts`: registered as `strategySpec` and `strategyAction`.

**tempo-engine**
- `src/engine/ports/tempo_metrics.py`: `DataSurface.MARKET_SCOPE`, `MetricFormat.RANK`, the same 52 keys, pin re-set to `08978404…`.
- `tests/test_tempo_metrics_drift.py`: all 52 keys hand-listed in the golden.

**Root:** `.env.example` gains `SANITIZE_CRON_SCHEDULE`, `AUTO_SYNC_INTERVAL_MS`, `MARKET_SCOPE_BACKFILL_DAYS`, `LM_STUDIO_URL`/`_MODEL`, `PLAYWRIGHT_*`, `TIKTOK_PG_*` and the missing `TIKTOK_CSV_*`: every name the code actually reads.

## 3. Entry contract for P2 (engine, instant tier)

| Contract | Where | Guarantee | Held up by |
| --- | --- | --- | --- |
| `market_scope_accounts` | db | One row per **linked** accessible TTMS account. `client_id` is the Tempo client whose paid ad account the TTMS account lists. `is_primary` is true for at most one account per client. `unavailable_metrics` is the only source for lock rows. | `market-scope-sync.test.ts` |
| `market_scope_audience_daily` | db | Wide shape (one row per account, day and stage; all four benchmark levels as columns). Stage is lower-case. A missing benchmark is NULL, never 0. `brand_total` is a stock. | same |
| `market_scope_insights_daily` | db | One row per account, day, metric and content type. Metric is lower-case. Content type is `all`, `paid`, `non_paid`, `ads`, `creator_*`, `bgc_*` or `ugc_*`; unknown types are never mirrored. **No per-metric rank** (not stored upstream). | same |
| `market_scope_rankings_daily` | db | Daily names and ranks per stage. The canonical source for `#x of N`, where N = rows in that day's list. | same |
| Mirror freshness | sanitizer | Each run re-copies the last 14 days; first run 400 days, capped at the source's settled day. | same |
| `strategy_specs` | db + reports | Only `parseStrategySpec` output is written. Goal kinds are `rank`, `share`, `size_ratio` and `cost_per_new`. `cost_per_new` and `size_ratio` are on Awareness and Consideration only. Database check constraints back this up. | `spec.test.ts`, `strategy.test.ts` |
| `strategy_actions` | db | `action_json` is stored as proposed and never edited. Status moves only `proposed\|snoozed → running` and `proposed → snoozed`; a lost race returns null (409). | `strategy.test.ts` |
| Catalog keys | core + engine | The 52 `ttms.*` / `strategy.*` keys exist on both sides with identical label, format, direction and precision. The engine pin matches `catalog.ts`. | `catalog.test.ts`, `test_tempo_metrics_drift.py` |

**Not stable yet:**
- `strategySpec.get` returns no inferred class; the classifier is P2.
- `strategy_actions` has no measurement writer; that is P5.
- No UI calls the routers yet; that is P3.

## 4. How to run / verify

```bash
pnpm --filter @tempo/core test
pnpm --filter @tempo/db test        # PGlite; the opt-in live parity test is skipped
pnpm --filter @tempo/reports test
pnpm --filter @tempo/db typecheck && pnpm --filter @tempo/reports typecheck && pnpm --filter @tempo/web typecheck
cd tempo-engine && .venv/Scripts/python.exe -m pytest -q --ignore=tests/test_probe_loop_live.py \
  --ignore=tests/test_live_narrator_exit_gate.py --ignore=tests/test_brief_graph_live.py --ignore=tests/test_review_api_live.py
```

**Exit check, passed 2026-10-21 (see Status).** It writes to the live Tempo DB:

```bash
pnpm --filter @tempo/db db:migrate        # applies 0014 and 0015
pnpm --filter @tempo/db db:market-scope   # backfill, then verify counts per account/table/day; exit 0 = pass
```

Expected: 11 TTMS accounts linked to 10 clients (P0 §4), with Purbasari primary over Senka. Fino, Jiera, Tsubaki and Astra Foto are reported unlinked. Verify reports no mismatch.

**Known unrelated failures:**
- `apps/ingestion` typecheck fails on `pregenerate-decks.test.ts` (a `ClientSummary.tier` missing since `47f4e54`). Pre-existing.
- `tempo-engine/tests/test_probe_loop_live.py` is a stochastic live LM Studio yield test and failed once in this session. It doesn't touch any P1 code.

## 5. Deferred

- **`market_scope_sentiment_daily` (PRD §6.3) is not created.** The portal stores only a daily NSR value, which is mirrored as insight metric `nsr`. It has no positive/negative/neutral rates or comment counts (P0 §2), and all linked accounts are Lite.
- **`BriefObjective` + `'strategy'` and the `report_runs` objective value:** P3, with the route that writes them.
- **Router tests:** `apps/web` has no test harness (M7 handover). The rules are covered one layer down.
- **The 9 remaining spend-parity mismatches** are a separate session (`fix/spend-parity-gaps`). None affect a Strategy Report client.

## 6. Kill-list state

No kill-list rows for this PRD.

## 7. Decisions taken here

1. **P0 corrections adopted** (product, 2026-10-21):
   - `size_ratio`, not `move_on_rate`
   - no cost per new Conversion and no `cost_per_new` goal on Conversion
   - no per-metric insight rank key
   - content-type shares are `neutral` and never stacked
   - fixtures will be frozen real rows plus a separate synthetic set (P2)
2. **The mirror keeps the portal's wide shape,** not the PRD's one-row-per-benchmark design. Brand values don't vary by benchmark level, a 1:1 shape is what makes per-day row-count verification possible, and it is 4× fewer rows.
3. **Only linked accounts are mirrored**, and a client may have several. `is_primary` comes from a name match, and `strategy_specs.ttms_account_id` overrides it. The name rule is the portal's plus a 3-character floor, because one- and two-letter slugs matched almost anything in tests.
4. **No catalog `bands` on Market Scope keys.** PRD §6.5's "brand ÷ benchmark" bands grade a ratio to the benchmark, not a value. P3 grades with `light()` using the benchmark as target (D5: no new grading vocabulary).
5. **The mirror runs inside the sanitizer after the brand loops,** with no pm2 process of its own (PRD §6.3). Its failure never fails the ads sync.
