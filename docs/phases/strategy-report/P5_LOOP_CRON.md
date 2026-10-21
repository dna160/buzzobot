# P5 — Action loop and cron — HANDOVER

**Status:** ✅ Complete. · **Verified 2026-10-21:** Ran on live BARDI through the real route handler and the :8002 engine:
- **Run 1:** a proposal was accepted with `started_at` 21 days back. The run measured it (T11) and wrote it back: `running` → `failed`, with `measured_value`, `category_delta` and `measured_run_id` set.
- **Run 2:** T9's log showed it with the stored verdict and 24 days running, and did not re-measure it.
- **Restore:** the row was returned to `proposed` afterwards.
- **Tests:** loop, repository and cron pass; web, db and ingestion typecheck and lint clean.

## 1. Scope

PRD §12 P5 includes:
- accept/snooze UI;
- T11 re-measurement written back;
- the T9 table;
- cron pre-generation with a warm-cache serve;
- the degraded flag;
- the health card listing strategy runs (§9.5).

Accept and snooze UI shipped in P3. The degraded flag shipped in P4 (`meta.degraded`), and the renderer already prints it.

## 2. What shipped

| Area | Files |
|---|---|
| **Closing the loop** (§5.6) | **Engine:** `contracts/strategy.ClosedAction` and `StrategyFrame.closed_actions`. `ports/strategy_read.py` reads the last 6 judged actions (`worked`, `weak`, `failed`) beside the running ones. `graphs/strategy.action_log` merges T11's measurements of running actions with the stored verdicts, newest first, capped at 6.<br>**db:** `recordActionMeasurement` moves an action from `running` to its verdict once, guarded in SQL. A `running` verdict only refreshes `measured_value`, `category_delta`, `measured_run_id` and `measured_at`.<br>**web:** `lib/strategy-actions.recordStrategyRun` writes the measurements back, then records the proposals. It is called by the strategy route (non-preview) and by the `/full` poll. |
| **Cron** (§9.5) | `apps/ingestion/src/pregenerate-decks.ts`:<br>• `objectivesFor(client, {marketScope})` adds `strategy` for any client with a `market_scope_accounts` row (`listMarketScopeClientIds`), whatever its north star<br>• `reportUrl` asks for `strategy-report?tier=full&format=pdf&days=28&fresh=1`<br>• `orderByTimezone` runs clients east to west (WIT, WITA, WIB)<br>• the per-request timeout is ≥ 11 min, to cover the route's 660 s ceiling |
| **Warm cache in the panel** (§9.3) | tRPC `strategySpec.warm({slug, days})` checks for a stored full-tier PDF for the exact window the download would ask for. The panel shows "Dibuat 21 Okt 03:12 · tier penuh" and a **Jalankan tier penuh** button, which regenerates without downloading. |
| **Health card** (§9.5) | Engine `/healthz` adds `strategy_runs`, the last 8 runs, each with tier, status, `duration_s`, `fallbacks`, `degraded` and `pass_at_1` (`graphs/persistence.recent_strategy_runs`). `EngineHealthCard` lists them, plus the local model, its token budget and its concurrency. |
| **Tests** | `tempo-engine/tests/test_strategy_loop.py`: an accepted action is measured and logged; a judged action shows its stored verdict; the log caps at 6. `packages/db/.../strategy.test.ts`: write-back transitions and Market Scope client listing. `apps/ingestion/.../pregenerate-decks.test.ts`: the strategy objective, URL and timezone order. |

## 3. Entry contract for P6

| Contract | Guarantee |
|---|---|
| `strategy_actions` lifecycle | `proposed` → (accept) `running` → (a later run's T11) `worked`, `weak` or `failed`, exactly once. `snoozed` can still be accepted. |
| T9 | It shows the running actions this run measured and up to 6 judged actions, newest first. An action is never re-measured after its verdict. |
| Cron | Every Market Scope client gets `strategy` on Monday 03:00 (`DECK_CRON_SCHEDULE`), through the public route. Its stored PDF is what `?tier=full&format=pdf&days=28` serves warm. |

## 4. How to run / verify

```bash
pnpm --filter @tempo/db exec vitest run src/repositories/strategy.test.ts
pnpm --filter @tempo/ingestion exec vitest run
cd tempo-engine && uv run pytest -q tests/test_strategy_loop.py
# once, immediately, for real (needs DECK_CRON_API_KEY and the app running):
pnpm --filter @tempo/ingestion decks:cron --once
```

**Live check (2026-10-21):**
- The back-dated accept made the start value equal today's value, since the proposal was computed today. The kill signal (no rise in the BGC share after 14 days) therefore fired and the verdict was `failed`. That is the correct rule, applied to an artificial start.
- The check found a gap, now fixed. With nothing running and a judged action in the table, T9's text still said "Belum ada tindakan yang diterima". `instant_section_draft` now tallies the judged actions instead.
- The T9 table also printed shares as raw fractions ("0,0389"). It now shows percentages, or Rupiah for cost metrics.

## 5. Deferred

- **"Accept by default when the cron run is approved"** (PRD §5.6, the alternative to Q3). The P3 default stands: only an explicit accept starts the loop. Switching would mean calling `acceptStrategyAction` for rank 1 in `recordStrategyRun` when the caller is the cron.
- **Meeting the 06:00 WIB deadline** depends on the full-tier time per client. At about 1 minute per strategy report (P4 exit gate), it is dominated by the decks' own budget.

## 6. Decisions taken here

1. **Write-back lives in the web app, not the engine.** The engine's role stays SELECT-only on `public` (PRD hard rule). The web app already owns `strategy_actions`.
2. **A class preview writes nothing back.** That covers both proposals and measurements: a preview is not the client's report.
3. **Judged actions are read, not re-measured.** T9 shows the verdict the measuring run wrote. That keeps a verdict stable after the fact, and keeps T11's work bounded by the number of running actions.
