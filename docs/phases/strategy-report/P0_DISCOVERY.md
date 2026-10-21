# P0 — TTMS discovery (Strategy Report)

**PRD:** `PRD_TEMPO_STRATEGY_REPORT.md` (draft v1, 2026-10-21), §6.2 and §12 P0
**Run:** 2026-10-21. Read-only queries (`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`) against the portal DB (`DB_*`) and Tempo's DB (`tempo`, through the engine's SELECT-only role). No credentials are recorded here.
**Reference window:** 2026-09-13 … 2026-10-10 (28 days, as PRD §7.1), unless a row says otherwise.

## Verdict

**P0 passes for the data, with four PRD changes required before P1.** Every PRD §7.3 generator is marked below. Six are buildable as written, three are buildable with a changed definition, one is a v1 coverage gap, and one depends on P1 tables. The four blocking changes are:

1. **Spend source (§6.1, T02, T08, classifier).** Tempo's `paid_hourly_metrics` misses GMV Max cost for some clients: BARDI shows Rp11.1M against the portal's Rp43.3M; Kalibre shows Rp0 against Rp152.0M. Fix the sanitizer to read `tiktok_ads_analytics.gmv_max_cost` before T02 depends on it. **→ §5.**
2. **The stage "move-on rate" is not a rate (T01, T09, catalog key `move_on_rate`).** TTMS stage totals are rolling-window stocks. Conversion can be larger than Consideration: BDL 12.5×, Purbasari 1.04×. **→ §6.2.**
3. **New/outflow for the Conversion stage is always 0** for 14 of 15 accounts. Shop-class T6 "Conversion inflow/outflow", "cost per new Conversion", T02's shop variant and goal kind `cost_per_new` (conversion) have no data. **→ §6.3.**
4. **The `bardi_strategy_28d` fixture (PRD §11.1) takes several numbers from the mock-up that the data contradicts** (97% offset, a stacked 71/10/9/6/4 mix, a 0.19 halo, and a #9→#4 competitor). **→ §7.**

Also non-blocking, but each needs a decision: all accessible accounts are **Lite** (Q4), **all 11 mapped clients infer to the `shop` class**, and migration number **0013 is already taken** on the working tree.

---

## 1. Tables (query 1)

`public.ttms_accounts`, `public.ttms_audience_daily`, `public.ttms_insight_daily`, `public.ttms_ranking_daily`, `public.user_ttms_access`, `public.ttms_scans`. There are no `market_scope*`, `audience_trend*` or `brand_insight*` tables. The Portal's `npm run ttms:sync` (scheduler job key **`ttms`**, `0 9 * * *` Asia/Jakarta, enabled) fills them. The Portal's own design doc is `buzzoheroportal/docs/superpowers/specs/2026-10-09-ttms-sync-design.md`.

`ttms_scans` is the Portal's screenshot-AI report store and is not used here. `user_ttms_access` is portal ACL and is not used here.

## 2. Column map (query 2): PRD §6.2 expected → actual

| PRD expected | Actual | Consequence |
|---|---|---|
| audience row per `(account, date, stage, benchmark)` with `benchmark_total_average`… | **One row per `(account, date, stage)`**, with **wide** benchmark columns `bench_total_top{5,10,25,50}`, `bench_new_top*`, `bench_outflow_top*` | All four benchmark levels are stored. **The TOP_25 goal anchor works.** §6.3's `market_scope_audience_daily` should mirror the wide shape (4× fewer rows) or pivot on read. Pick one in P1. |
| stage ∈ {acc, awareness, consideration, conversion} | `stage` ∈ {`ACC`, `AWARENESS`, `CONSIDERATION`, `CONVERSION`} (upper case) | Normalise in the mirror. |
| `brand_ranking`, `total_brand_count` on audience | present | ±1 disagreement with the ranking list; see §6.4 |
| insights row per `(account, date, metric, content_type, benchmark)` with `brand_ranking`, `total_brand_count` | One row per `(account, date, metric, content_type)` with `brand_value`, `brand_share`, `bench_top{5..50}`, `bench_share_top{5..50}`. **No per-metric rank or brand count.** | **Per-metric rank is not stored.** It comes only from the live `data_overview` call, which the Portal makes at page time and never persists. T05 `RANK_MOVED` per insight metric is a v1 gap. |
| `content_type` ∈ all, paid, ads, creator_boosted, creator_organic, bgc_boosted, bgc_organic, ugc_boosted, ugc_organic, non_paid | `ALL`, `PAID_CONTENT`, `NON_PAID_CONTENT`, `ADS`, `CREATOR_CONTENT_{BOOSTED,ORGANIC}`, `BRAND_GENERATED_CONTENT_{BOOSTED,ORGANIC}`, `USER_GENERATED_CONTENT_{BOOSTED,ORGANIC}` | Map in the mirror. **UGC is stored for Lite accounts** (contradicts PRD T04 "UGC rows → coverage gap on Lite" and §5.4 rule 3 "Full plan only"). |
| metric × content_type matrix | IMPRESSIONS, ENGAGEMENTS, LIKES, COMMENTS, SHARES, VIDEO_VIEWS_P100: all 10 types. CLICKS, VIDEO_VIEWS_6S: `ADS`, `ALL`, `PAID_CONTENT`. PRODUCT_CARD_CLICKS: `ALL` only. SEARCH_VOLUME, NSR: `ALL` only, and only for one account. | Product-card clicks have no content split. |
| sentiment: `nsr, comments, positive_rate, negative_rate, neutral_rate` | **Only `NSR` as a daily value** in `ttms_insight_daily`. No positive/negative/neutral rates, no comment count on the NSR row. | §6.3 `market_scope_sentiment_daily` cannot be filled as specified. T07's `SENTIMENT_SPIKE_NEGATIVE` could only use the COMMENTS metric plus NSR. |
| ranking list `(account, date, audience_asset_level, brand, ranking)` | `ttms_ranking_daily (ttms_account_id, date, stage, brand, ranking)` | Matches. Kept **daily**, all 4 stages, no missing days (query 9). The PRD's Appendix E worry about the Rankings tab erroring does not affect stored data. |
| account metadata `vertical, plan ∈ {lite, full}, linked advertiser_ids` | `ttms_accounts`: `brand_name, industry, region_code, plan` (free text, e.g. `TTS Purchase(Lite)`), `is_lite`, `advertiser_ids text[]`, `accessible`, `unavailable_metrics text[]`, `last_data_date`, `last_error` | Use `is_lite` and `unavailable_metrics` for locks, not the plan text. `industry` is empty for 3 accounts. |

## 3. Accounts, plan, history and lag (queries 3–4)

123 accounts are discovered; **15 are accessible**. **All 15 are Lite** (`is_lite = true`). This answers **Q4: T07 has no data for any mapped client**. Only Tsubaki, which no Tempo client maps to, has SEARCH_VOLUME and NSR rows (200 days).

| TTMS account | Industry | Audience/insight days (from) | Ranking days (from) |
|---|---|---|---|
| BARDI Smart Home | Consumer Electronics | 837 (2024-07-04) | 99 (2026-07-12) |
| BDL, Darlie Indonesia, Evedaily, Jasper, Purbasari, Selma, Senka | various | 837 (2024-07-04) | 99 |
| Flacenta | Beauty & Personal Care | 570 | 99 |
| Fino | (blank) | 467 (2025-07-09) | 99 |
| Astra Foto | Consumer Electronics | 282 (2026-01-10) | 99 |
| Tsubaki | (blank) | 200 (2024-01-01) | 99 |
| Jiera | (blank) | 37 (2026-09-12) | 37 |
| **Kalibre** | Apparel & Accessories | **15** (2026-10-04) | 99 |
| **Chocomory** | Food & Beverage | **6** (2026-10-13) | 91 |

- **Lag:** on 2026-10-21 the newest settled day for every account is 2026-10-18, so the lag is **T-3**. The PRD assumes T-4. Keep T-4 as the safe default for the cron, and read `ttms_accounts.last_data_date` as the true ceiling.
- **Benchmarks:** audience benchmark columns are NULL for 2024-07 … 2024-10, then complete. That covers about 16% of all rows, all in early history. Any window from 2025 on has benchmarks.
- **Eligibility (PRD §7.1, ≥ 14 audience days):** Chocomory (6 days) is **not eligible today**, and Kalibre (15) is only just eligible. T03's 12-week series needs 84 days; Chocomory, Jiera and Kalibre fall short.

## 4. Tempo client ↔ TTMS account mapping

Join: `ttms_accounts.advertiser_ids` ∩ Tempo `tiktok_accounts.external_id` (surface `paid`). Tempo has 328 clients.

| TTMS account | Tempo client (`north_star`, tier) | Note |
|---|---|---|
| BARDI Smart Home | `bardi-tiktok` (shop, standard) | |
| BDL | `bdl-skincare-id` (shop, standard) | |
| Chocomory | `chocomory` (shop, standard) | 6 days of TTMS data |
| Darlie Indonesia | `pt-hawley-hazel-distribution-indonesia0104` (shop, standard) | Slug is the distributor's name |
| Evedaily | `summersun090917` (shop, standard) | Slug is an account handle |
| Flacenta | `flacenta-beauty-id` (shop, standard) | |
| Jasper | `jasper-clinic` (shop, standard) | |
| Kalibre | `kalibre-indonesia` (shop, standard) | No paid rows in Tempo (§5) |
| **Purbasari** | `purbasari-id` (shop, standard) | **Shares advertiser `7367212572623257616` with Senka** |
| **Senka** | `purbasari-id` | Same advertiser as Purbasari |
| Selma | `selma-x-buzzohero` (shop, standard) | |
| Astra Foto | none | Advertiser `7497121045154234385` is not a Tempo client |
| Fino, Jiera, Tsubaki | none | No linked advertiser |

**11 of 15 accounts map; 10 Tempo clients would get a report.**

**PRD change:** §6.3 `market_scope_accounts.client_id` assumes one client per account and one account per client. Purbasari and Senka both resolve to `purbasari-id`. Use the Portal's ownership rule (`buzzoheroportal/utils/ttms.ts` `ttmsAdvertiserOwnership`, which matches TTMS names against the portal brand on the ad account) to pick one owner. Alternatively, allow a client to carry several TTMS accounts and add an account picker to the strategy spec. Decide in P1.

## 5. Spend parity: Tempo `paid_hourly_metrics` vs portal Cost

Portal Cost is `tiktok_ads_analytics.cost_cash + gmv_max_cost`, the IDR rows only: the figure on the Portal's TTMS "Ads impact" tab and the source of the mock's Rp46.6M. Tempo's figure is Σ `paid_hourly_metrics.spend` on campaign-rollup rows (`adgroup_id IS NULL`).

| Client | Portal Cost | Tempo hourly | GMV Max share | Status |
|---|---|---|---|---|
| Purbasari / Senka | Rp712,410,660 | Rp712,658,860 | 0.91 | ✅ matches |
| Evedaily | Rp823,175,028 | Rp823,140,966 | 1.00 | ✅ |
| Chocomory | Rp78,993,751 | Rp78,993,276 | 1.00 | ✅ |
| Selma | Rp26,242,549 | Rp26,264,477 | 0.65 | ✅ |
| **BARDI** | **Rp43,295,359** (cash 5.81M + GMV Max 37.49M) | **Rp11,109,092** | 0.87 | ❌ GMV Max missing |
| **Kalibre** | **Rp151,950,438** (all GMV Max) | **Rp0** (no rows at all) | 1.00 | ❌ GMV Max missing |
| BDL, Darlie, Flacenta, Jasper | Rp0 | Rp0 | — | No spend in window → T02 gap |

**Root cause:** for BARDI and Kalibre, GMV Max cost exists in `tiktok_ads_analytics.gmv_max_cost` but **not** in `tiktok_ads_gmv_max_product_campaign`, neither in the parent table nor in the `_y2026q3`/`_y2026q4` partitions. That table is the only GMV Max source the sanitizer reads (`packages/db/src/ingest/sanitize.ts` `ingestGmvMaxCampaigns`). BARDI's Rp11.1M in Tempo is its `video_views` campaigns only. The table that backs `tiktok_ads_analytics.gmv_max_cost` for these advertisers was not traced; this is a P1 task.

**PRD change:** before T02, T08 or the classifier read spend, either:
- (a) P1 adds a sanitizer step that books `tiktok_ads_analytics` GMV Max cost into `paid_hourly_metrics` as day buckets (`hour 0, span_hours 24`, the existing `dayBucket` pattern), de-duplicated against `ingestGmvMaxCampaigns`; or
- (b) `strategy_read.py` reads spend from `tiktok_ads_analytics` through the source pool.

(a) keeps the engine on the Tempo DB, as engine PRD §1 requires. **Recommended: (a).** An acceptance test asserts parity with portal Cost for every mapped client, within 0.1%.

## 6. Semantics the PRD has to absorb

### 6.1 Classification (§5.2) is degenerate on today's data

| Client | north_star | GMV share | Conv ÷ Cons (10 Oct) | Score | Class |
|---|---|---|---|---|---|
| Purbasari | shop | 0.91 | 1.044 | 5 | shop |
| Evedaily | shop | 1.00 | 0.149 | 5 | shop |
| Kalibre | shop | 1.00 | 0.129 | 5 | shop |
| BARDI | shop | 0.87 | 0.045 | 4 | shop |
| Chocomory | shop | 1.00 | — | 4 | shop |
| Selma | shop | 0.65 | 0.089 | 4 | shop |
| Senka (via purbasari-id) | shop | 0.91 | 0.028 | 4 | shop |
| BDL | shop | — | 12.536 | 3 | shop |
| Darlie | shop | — | 0.150 | 3 | shop |
| Flacenta | shop | — | — | 2 | shop |
| Jasper | shop | — | 0.000 | 2 | shop |

**Every mapped client infers to `shop`.** `north_star = shop` alone gives +2, which meets the threshold, and every one of these clients has `north_star = shop`. The brand class will only appear through the AM override. The live exit gate "brand and shop fixtures produce different T6" can be met only with the synthetic `brand_strategy_28d` fixture. **Decision needed:** keep the formula and rely on the override, or weight `north_star` less so that GMV share and the funnel decide.

### 6.2 "Move-on rate" is a ratio of stage sizes, not a flow

TTMS stage totals are rolling-window audience **stocks**. Awareness and Consideration cover 15 days. Conversion counts purchase-type actions over a longer window (the PRD's Q1 note says 365 days). On 2026-10-10, Conversion ÷ Consideration is **12.5 for BDL** and **1.04 for Purbasari**, so it is not a share of people moving on. The API has no transition data; that exists only on the TTMS website's Audience Transition screen.

**PRD changes:**
- Rename `ttms.audience.{stage}.move_on_rate` → `ttms.audience.{stage}.size_ratio`.
- Bahasa label "Ukuran tahap {next} dibanding {stage}", replacing "Lanjut ke tahap berikutnya".
- T01's `STAGE_LEAK` compares brand ratio against benchmark ratio, and is suppressed when either ratio is > 1.
- The T09 `stage_targeting` lever's target is "size ratio", never "people moving on".
- Copy must not say "pindah", "lanjut" or "berpindah" for this number.

`tempo-engine/docs/strategy_definitions.md` F4 has the same rule.

### 6.3 New and outflow are empty for the Conversion stage

| Stage | Accounts where new = 0 **and** outflow = 0 on every day of the window |
|---|---|
| CONVERSION | 14 of 15 (all except Purbasari) |
| CONSIDERATION | BDL, Flacenta, Jasper |

**PRD changes:**
- T02's shop variant (`new.conversion`) → coverage gap, fall back to `new.consideration`.
- Shop T6 "Conversion stage inflow/outflow" and "cost per new Conversion" → coverage gap.
- T1 chip 3 for shop "cost per new Conversion" → use Conversion rank.
- Goal kind `cost_per_new` with stage `conversion` → not offered in the spec form.
- T01 `STAGE_INFLOW_OFFSET` only for stages with non-zero flow.

### 6.4 Two rank sources disagree by ±1

On 10 Oct, BARDI's Consideration rank is #38 in `ttms_ranking_daily` and #39 in `ttms_audience_daily.brand_ranking`. Awareness and Conversion show the same ±1 gap. The day's ranking list has **56** rows (with ties), while `total_brand_count` is **64**. The mock-up shows #38 and "56 brand", which is the ranking list.

**PRD change:** ranks and "#x dari N" come from `ttms_ranking_daily`. N = that day's list length. Record `total_brand_count` but never display it.

### 6.5 Category growth proxy (T05)

The PRD proxy `category = bench_value × total_brand_count` mixes a Top-N **average** with a brand count from a different source. An exact vertical total exists instead: Σ brand_value ÷ Σ(brand_value ÷ brand_share) (the Portal's `ttmsAggregateInsight` / `ttmsCategorySize`). **Use the exact total.** For BARDI impressions, 12 Aug–10 Sep against 11 Sep–10 Oct: brand +243%, vertical share 0.09% → 0.24%.

### 6.6 Content sub-types overlap

On BARDI's impressions, `ADS` = 101% of `ALL`, and boosted brand content = 73%. Only `PAID_CONTENT` + `NON_PAID_CONTENT` add up to `ALL`.

**PRD change:** §9.4's "stacked content-mix bar" may stack only Paid vs Non-paid. The 7 sub-types are drawn as separate "x% dari semua" bars. T04 `share[ct]` stays valid per type, but no two sub-types are ever summed.

## 7. Fixture corrections (PRD §11.1 `bardi_strategy_28d`)

These are from the stored rows; the mock-up value is in brackets.

- Stage totals are 1,852,491 / 129,635 / 5,801 ✅.
- Size ratios are 7.0% vs 8.8% (8.7%) and 4.5% vs 15.7% ✅.
- New Consideration over 30 days was 242,039 ✅. **Outflow was 193,917 (≈236K), so the offset is 80% (97%).**
- Portal spend over 30 days was Rp46,574,627 ✅, giving Rp192,426 per 1k new ✅.
- **Content mix:** Paid 95% / Non-paid 5%; sub-types are overlapping (stacked 71/10/9/6/4).
- **Halo:** 0.06 vs Top 10 0.63 (0.19 vs 0.62).
- **Competitor movers** in the 10 days to 10 Oct: #13→#9 and #42→#35 (#9→#4).
- **Awareness outflow** on 10 Oct: 0.97× its 14-day mean (2.1×).
- **Spend→new Consideration fit:** R² ≤ 0.30 at every lag from 0 to 7 days. No knee, no cap (the mock showed a knee at Rp1.6M).

**Recommendation:** split the fixture.
- `bardi_strategy_28d.py` is **frozen real rows**: its expected values are §3 of `tempo-engine/docs/strategy_definitions.md`.
- `synthetic_saturating_response.py` carries the planted knee and the planted competitor jump, so the planted signals are labelled synthetic and never cited as BARDI's.

## 8. Generator buildability (PRD §7.3)

| ID | Status | Data | Notes / PRD change |
|---|---|---|---|
| Classifier | ✅ buildable | `clients.north_star`, portal Cost, audience totals | Degenerate today; all shop (§6.1). Needs the §5 spend fix for GMV share via Tempo. |
| **T01** Funnel stage flow | ✅ **buildable, definition changed** | audience totals + `bench_total_top*` | Size ratio, not move-on (§6.2); offset only on stages with flow (§6.3) |
| **T02** Spend → stage response | ⚠️ **buildable after the §5 fix** | spend + daily `brand_new` | Gap for BDL, Darlie, Flacenta, Jasper (no spend). Shop variant → Consideration (§6.3). **Lag:** the PRD picks L ∈ {2,3,4} by max Spearman per run. Picking the best of three per report inflates ρ; prefer a lag fixed in the spec (the definitions sheet proposes 2). BARDI's R² is ≤ 0.30 at all lags 0–7 → `UNRELATED`, no cap. |
| **T03** Goal pacing | ✅ buildable / gap until goal set | ranking list (from 2026-07-12) + audience | Rank goals in **ranks per week** only: competitor sizes are not in TTMS, so "people per day needed for #25" cannot be computed. 12-week series short for Chocomory, Jiera, Kalibre. |
| **T04** Content mix & halo | ✅ **buildable, definition changed** | insights × 10 content types, bench per type | UGC available on Lite (§2). No stacking of sub-types (§6.6). Creator cost per 1k needs `creator_fee_monthly`. |
| **T05** SOV & rank | ⚠️ **partial** | `brand_share`, `bench_share_top*` daily | `SOV_GAINING/LOSING`, `GROWING_FASTER_THAN_CATEGORY` buildable with the exact vertical total (§6.5). `RANK_MOVED` per insight metric → **v1 gap** (rank not stored, §2). Audience-stage rank moves are available via T06's lists. |
| **T06** Competitor movement | ✅ buildable | `ttms_ranking_daily`: daily, 4 stages, 99 days, no gaps | |
| **T07** Search & sentiment | ⛔ **v1 coverage gap** | — | No mapped client has SEARCH_VOLUME or NSR (all Lite). Sentiment rates are never stored. Build only the `locked_reason = plan_lite` path. |
| **T08** Outflow anomaly & flight end | ✅ buildable; flight-end after the §5 fix | `brand_outflow` daily; spend | Conversion stage excluded (§6.3) |
| **T09** Target Solver | ✅ buildable | findings | `stage_targeting` uses the size ratio (§6.2). Content-mix steps are per type, never summed. |
| **T10** Coverage & plan audit | ✅ buildable | `ttms_accounts`, row counts | Uses `is_lite` and `unavailable_metrics` |
| **T11** Action re-measurement | 🔜 depends on P1 | `strategy_actions` | |

## 9. Repo facts that change P1

- **Migration numbering.** The working tree already has an uncommitted Drizzle migration **`0013_gigantic_sugar_man.sql`** (the report-links / share-link work, on the branch where it was started). The PRD's `0013_market_scope.sql` and `0014_strategy_specs_actions.sql` must become **0014** and **0015**, or be renumbered after that work lands.
- **Branch baseline.** The PRD baseline is `main @ 6e49cdc`. The local checkout's working branches are `feat/accomodateallBrand` (with the uncommitted share-link work) and `docs/strategy-report-plan` (the earlier plan and definitions sheet). P1 should start from whichever branch the share-link work merges into.
- **Earlier docs.** `docs/architecture/PLAN_tempo_strategy_report.md` is **superseded by the PRD** wherever they differ: mirroring into Tempo's DB, a Tempo dashboard page, Bahasa only, and the brand/shop classes. `tempo-engine/docs/strategy_definitions.md` remains the source for the figure definitions and BARDI reference values cited in §6–§7 above.

## 10. Open items to close P0

- [ ] **AM agreement on `strategy_specs` fields** (PRD §12 P0). Not done: needs an AM. Suggested input: drop `cost_per_new` (conversion) from goal kinds (§6.3).
- [ ] Product decision on the four blocking PRD changes in the verdict.
- [ ] Decision on classification weighting (§6.1) and on Purbasari/Senka ownership (§4).
- [x] Q4 answered: all accessible accounts are Lite.
- [x] Q1: no mapped client is `app_install`, so the default ("brand class, Conversion suppressed") is untested by real data.

## Appendix — queries

PRD §6.2 queries 1–4, run as written with the real table names (`ttms_accounts`, `ttms_audience_daily`, `ttms_insight_daily`, `ttms_ranking_daily`). The following were added:

- benchmark NULL rates by stage and by quarter
- metric × content-type coverage
- days with fewer than 4 ranking stages
- the Tempo client join on `tiktok_accounts.external_id`
- spend parity: `tiktok_ads_analytics` vs Σ `paid_hourly_metrics.spend WHERE adgroup_id IS NULL`, plus `tiktok_ads_gmv_max_product_campaign` and its `_y2026q3`/`_y2026q4` partitions
- per-stage share of days with zero `brand_new` / `brand_outflow`

All of them ran inside read-only sessions.
