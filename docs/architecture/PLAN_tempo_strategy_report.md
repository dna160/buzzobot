# Build plan — Tempo Strategy report

**Status:** draft, 21 Oct 2026
**Reference:** the four-page "Tempo Strategy Simulation" mock-up for BARDI Smart Home, dated 10 Oct 2026 (the PDF lives outside this repo)
**Goal:** generate that report from live data for every TTMS account that has linked ad spend. The mock-up's own banner says that only some of its figures are real. The built version must have no illustrative numbers in it.

---

## 1. Where it lives

| Layer | Home | Why |
|---|---|---|
| **Data** | Warehouse Postgres, the Portal's DB. Already there. | `ttms:sync` fills `ttms_*` daily at 09:00 WIB. Ad spend is in `tiktok_ads_analytics`, and `tiktok_ads_campaign` has per-campaign `new_consideration_size`. This is the same database Tempo calls the Robot Pintar warehouse (`DB_*` is identical in both `.env` files). |
| **Computation** (every number, decision, confidence level and falsifier) | **tempo-engine** (`tempo-engine/`), as a new `strategy` graph | The report is the engine's doctrine applied to TTMS. Code computes every figure, each decision states its confidence and what would prove it wrong, and low-confidence claims are blocked structurally. The engine already has the `Finding` contract, materiality, the numeral gate, the fallback path and LangGraph review. PRD §12 B11 ("Market Scope as cold-start baseline") is the milestone this work starts. |
| **Rendering + delivery** | **Tempo** `packages/reports/src/strategy/` plus a route, served through the existing `/r/:token` share link | It matches what the Portal already does with Template Reports: the "See Report" modal calls `POST /api/report-links` and opens `/r/:token` (`AdsTempoReportModal.vue`, migration `0145_tempo_report_history`). Tempo already has HTML→PDF, artifact caching and the run ledgers. |
| **Interactive inputs** (goal target, creator fees, accepting a decision) | **Portal** UI, posting through Portal server → Tempo API (API key) | These are writes, so they need a logged-in user with TTMS access. `/r/:token` is login-free and must stay read-only. The Portal already enforces per-user TTMS access (`user_ttms_access`, `requireTtmsAccount`). |

**Rejected: building it all in the Portal.** It would be quicker to start, but it would re-implement in TypeScript the gates and confidence rules the engine already enforces. Narration would also go to GPT-4o/Gemini, which runs against GOV-2. That is the "agents disagree about a number" failure PRD §2 exists to prevent.

**Boundary rules carried over from PRD §1:**
- The engine gets a **second read-only role**, on the warehouse DB: `SELECT` on `ttms_accounts`, `ttms_audience_daily`, `ttms_insight_daily`, `ttms_ranking_daily`, `tiktok_ads_analytics`, `tiktok_ads_campaign` and `brands`. It never writes there.
- The engine writes only `insight.*` in the `tempo` DB.
- The engine never calls the TTMS API; the Portal's sync stays the only caller.

---

## 2. Fix the figures first

These checks were run read-only against the stored BARDI data for 11 Sep–10 Oct 2026, the same window the mock-up uses. They decide what the generators must compute and what the report may claim.

### 2a. Already correct. Lock these definitions in.

| Figure | Mock-up | Stored data | Definition to pin |
|---|---|---|---|
| Funnel sizes, 10 Oct | 1.9M / 129.6K / 5.8K | 1,852,491 / 129,635 / 5,801 | `ttms_audience_daily.brand_total` for the stage |
| Top 10 averages | 24.5M / 2.1M / 335.1K | 24.3M / 2,136,754 / 335,068 | `bench_total_top10` |
| Consideration rank | #38 | #38 from `ttms_ranking_daily`, but **#39** from `ttms_audience_daily.brand_ranking` | **Use `ttms_ranking_daily`.** It is what the TTMS website shows. Record that the two sources disagree. |
| New Consideration, 30 days | 242K | 242,039 | Σ `brand_new` |
| Spend, 30 days | (implied) | Rp46,574,627, Rp908K–2.70M/day | **The Portal's Cost**: `tiktok_ads_analytics.cost_cash + gmv_max_cost`, IDR rows only, advertisers resolved with `ttmsAdvertiserOwnership()`. Do **not** use `tiktok_ads_campaign.spend`, which is a subset (Rp12.45M). |
| Cost per 1k new Consideration | Rp192.4K | Rp192,426 | spend ÷ Σ `brand_new` × 1000 (`ttmsCostPerThousand`) |
| Impressions on videos mentioning the brand, 30 days | 4.0M | 4,006,317 | Σ `ttms_insight_daily` IMPRESSIONS, content type `ALL` |
| Stage ratios | 7.0% / 4.5% vs 8.7% / 15.7% | 7.0% / 4.5% vs 8.8% / 15.7% | See the label fix below. |

### 2b. Wrong or overstated. Fix before building.

1. **"Moves on to Conversion each period" is mislabeled.** 4.5% is the **size of the Conversion stage divided by the size of the Consideration stage** on one day. It is a ratio of stocks, not a flow. The TTMS API has no transition paths; those exist only on the website's Audience Transition screen. Rename it to "Conversion audience is 4.5% the size of Consideration" and never describe it as people moving.
2. **Leak headline.** Real outflow is **193,917, not about 236K**, so new people are offset by **80%, not 97%**. The headline still holds; the number changes.
3. **Response curve.** A log fit of daily spend against new Consideration gives **R² 0.21** at a 2-day lag over 8 weeks, not 0.61. No lag from 0 to 7 days reaches 0.40 (`tempo-engine/docs/strategy_definitions.md` S3). The cap (Rp1.6M), the below/above-cap costs and the "past the knee" verdict are not supported today. **Rule:** don't show a cap or a "diminishing returns" verdict unless R² ≥ 0.4 over at least 8 weeks. Until then the section shows the scatter and the blended cost only. On today's data, Decision 2 would not fire for BARDI.
4. **Goal pacing.** The real weekly Consideration rank is noisy, not a smooth climb: 39, 42, 41, 41, 40, 42, 42, 44, 42, 42, 44, 44, 37, 36, 39 (Fridays, Jul–Oct). The line "needs about 4× the current net gain" **can't be computed**, because TTMS gives competitors' ranks but not their audience sizes. The path to #25 can only be estimated from the `bench_total_top25` average, and must be labeled as an estimate. Project rank with a robust trend and show the range, not a single point.
5. **Content mix.** The mock-up stacks five sub-types to 100%. TTMS sub-types **overlap** (Portal spec §2): for BARDI, Ads alone is 101% of all impressions and brand content boosted is 73%. The only real split is **Paid 95% / Non-paid 5%**. Show that split as one bar and each sub-type as its own "% of all" bar, never stacked. This is the Portal's existing rule.
6. **Earned halo.** Real non-paid ÷ paid is **0.06** for BARDI against **0.63** for the Top 10; the mock-up shows 0.19. The real gap is about 3× worse than shown.
7. **UGC lock is wrong.** BARDI (Lite) has `USER_GENERATED_CONTENT_*` rows stored, matching the Portal spec's live finding. Only SEARCH_VOLUME and NSR are Lite-locked, and those two lock cards are correct.
8. **Illustrative early warnings.**
   - No brand went from #9 to #4 in the 10 days to 10 Oct. The real biggest movers were 42→35 and 13→9.
   - Awareness outflow on 10 Oct was **0.97×** its 14-day average, not 2.1×.
   - Engagement vertical share over 30 days is **0.29%**, not 0.9→1.6%.
   - The generators compute all three for real, so the mock-up's text simply gets replaced.
9. **"Category Consideration grew 3%" can't be computed.** TTMS gives no category totals for audience stages, only Top-N averages. Use "Top 10 average grew x%" instead. (Insight metrics *do* allow a category estimate through `brand_value / brand_share`.)
10. **Decision stakes.** "+2.1K to 3.4K buyers" needs a model linking Consideration spend to conversions, and no such model exists. Until the action log (Phase 3) holds measured outcomes, a stake must be stated as a scenario with its assumption shown ("if the Consideration→Conversion ratio reached the Top 10's 15.7%…"). It must never read as a forecast.
11. **"None of the live campaigns targets purchase" is false.** GMV Max is **85.6%** of BARDI's spend, and GMV Max is purchase-optimised. Decision 1's "fund it from the Consideration budget" rests on this claim and has to be rebuilt.

The full definitions, BARDI reference values and sign-off checklist are in `tempo-engine/docs/strategy_definitions.md` (Phase 0).

---

## 3. Phases

### Phase 0 — Definitions sheet (½ day, no code)
Write the table in §2a and the rules in §2b into `tempo-engine/docs/strategy_definitions.md`. That file becomes the contract the generators implement and the review checklist.
**Exit:** an AM signs off on the definitions.

### Phase 1 — Data port + deterministic core (engine)
- `scripts/bootstrap_warehouse_role.py`: a read-only role on the warehouse DB. Write `TEMPO_WAREHOUSE_DATABASE_URL` to `.env`.
- `ports/ttms_read.py`: the only module that reads the warehouse. It builds a `StrategyFrame` with:
  - daily audience per stage (brand + 4 benchmarks)
  - daily insights per metric × content type
  - ranking lists
  - daily Portal-defined spend
  - per-campaign `new_consideration_size`
  - the TTMS ↔ advertiser ↔ Tempo client link
- **Parity port.** Mirror the Portal's `utils/ttms.ts` rules: weekly/monthly rollups, vertical share, advertiser ownership, cost per 1k. Add a drift test pinned to that file's sha256, like `tempo_metrics.py` does for `@tempo/core`.
- **Generators**, each emitting `Finding`s with new closed `ClaimFrame`s:
  - `T01` funnel stage ratios vs benchmark
  - `T02` new vs outflow (the leak)
  - `T03` spend efficiency: cost per 1k, with a response fit gated by R²
  - `T04` rank pacing against a target
  - `T05` content mix + earned halo
  - `T06` early warnings: rank movers, outflow spikes, share shifts
  - `T07` coverage, covering Lite-locked metrics and data lag
- `eval/fixtures/bardi_ttms_week.py`: a frozen 10 Oct snapshot.
**Exit:** every §2a number reproduces exactly from the fixture, and every §2b rule has a test.

### Phase 2 — Decisions + rendered report (instant tier, zero model calls)
- **Decision builder.** Deterministic, one template per claim frame. Each decision carries: action, stake (or a scenario plus its stated assumption), confidence from the PRD §8 ladder, a **falsifier** (new field: the observable result that would prove it wrong, plus a check-by date) and sources. The top 3 by materiality are kept.
- **Engine API:** `POST /v1/strategy {client_slug, as_of}` → `StrategyContentV1`, with a JSON Schema checked into `tempo-engine/contracts/` and a Zod mirror plus drift test in Tempo, the same as the brief content contract.
- **Tempo rendering:**
  - `packages/reports/src/strategy/` builds an A4 HTML model.
  - Route: `GET /api/reports/:slug/strategy?as_of=`.
  - Share link: `report-links` gains `kind: 'strategy'`.
  - The Portal adds a "Strategy" button in `/ttms`, next to "See Report".
- Numeral gate on all rendered text; there is no illustrative banner.
**Exit:** BARDI's report renders end to end from live data, and an AM prefers it to the mock-up on side-by-side review.

### Phase 3 — Inputs, action log, schedule
- **Portal forms → Tempo API:**
  - Goal target per stage, stored in Tempo's `strategy_goals`
  - Monthly creator fees, stored in `strategy_inputs`
  - These are AM-entered config, like `report_specs` / `report_benchmarks`.
- **Accept decision → engine.** A Portal form posts the acceptance through Tempo to the engine's `POST /v1/strategy/decisions/{id}/accept`, stored in `insight.strategy_decisions`. On each later run the engine measures the accepted decisions:
  - **result** = change in the falsifier metric
  - **category** = change in the Top-N benchmark over the same period
  - **verdict** comes from fixed rules: Worked / Weak / Didn't work / Too early
- **Schedule:** a weekly pre-generation cron, plus a daily early-warning check that runs against the settled day (the TTMS lag is about 2 days).
**Exit:** a decision accepted in week N shows up measured in week N+2.

### Phase 4 — Optional: narration and probing (full tier)
- Narrator and critic over the decision cards.
- The probe loop answers "why did competitor C jump?" from stored ranks and our own campaign data.
- Only after Phase 2's deterministic report has been shown to be good. That is the same rule PRD §12 applies to B7.

---

## 4. Open decisions

1. **Language.** The mock-up is in English; the engine writes Bahasa Indonesia (PRD §7). Choose English, Bahasa, or a toggle.
2. **Coverage.**
   - All 13 accessible TTMS accounts.
   - Or only the 7 with linked ad spend. Without spend, T03 and the spend-based decisions drop out.
3. **USD spend.** It is excluded from Rupiah figures today (Portal rule). Choose whether to convert it at a fixed rate or keep excluding it.
4. **Who can accept a decision:** only AMs, or brand clients too.
5. **Where the Lite upsell sits.** The locked Search/NSR cards are a sales surface. Choose whether they stay in client-facing reports.

## 5. Risks

- **TTMS rank sources disagree** (#38 vs #39). This is pinned to the ranking list, but the disagreement means two pages could show different ranks unless the Portal's `/ttms` page adopts the same source.
- **Correlation is not causation.** The response fit and the action-log verdicts compare against the category over the same period. Neither proves what caused a change. Every card says so, and confidence never rises above medium without at least 8 weeks of history.
- **The audience stages are 15-day rolling windows** (TTMS definition), so the series react slowly. Falsifier check-by dates must be ≥ 14 days.
- **`/ttms/account/list/` is undocumented.** If it disappears, discovery falls back to known IDs (Portal spec §4). The report inherits that fragility.
