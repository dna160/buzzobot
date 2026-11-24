# Strategy report — definitions sheet

**Status:** Phase 0 draft, 21 Oct 2026. **Needs AM sign-off before Phase 1 starts.**
**Plan:** `../../docs/architecture/PLAN_tempo_strategy_report.md`
**Reference account:** BARDI Smart Home, TTMS `7522417104012722196` (Lite), advertiser `6926791720868839425`, as of **2026-10-10**.

This sheet is the contract the `strategy` generators implement (plan, Phase 1). Every number on the report is defined here. Anything not defined here may not appear. Each row has an ID, which the generator, its test and the rendered element all cite. The BARDI column holds values computed from the stored rows, read-only, on 21 Oct 2026. They become the Phase 1 fixture's expected values.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| **As-of day** | `as_of` = a settled TTMS day ≤ `ttms_accounts.last_data_date`. TTMS days after that return zeros and are never read. TTMS settles about 2 days late. |
| **Window** | `W` = the 30 TTMS days ending at `as_of`, inclusive: `as_of − 29 … as_of`. `W_prev` = the 30 days before it (`ttmsPreviousRange`). |
| **Day boundaries** | TTMS days are **UTC**. Ad days (`tiktok_ads_analytics.date`) are the **ad account's local day** (WIB). They are joined by date string, as the Portal's Ads impact does, and the report says so once in its footer. Compare at window level, never one day against one day. |
| **Nulls** | "Not provided" is `null`, never `0`. A Lite audience benchmark of `0` is stored as NULL. A null renders as "—" with its reason, never as a number. |
| **Ratios** | Always recomputed as Σ numerator ÷ Σ denominator over the window. Ratios are never averaged (PRD §3.1). |
| **Rollups** | Weekly bucket = the ISO week's Monday; monthly = the 1st (`ttmsBucket`). Insight counts are summed, and share = Σ brand ÷ Σ (brand ÷ daily share). Audience totals and rank = last day of the bucket; new and outflow are summed (`ttmsRollupInsight`, `ttmsRollupAudience`). |
| **Parity** | Every rule marked ⇄ mirrors the Portal's `utils/ttms.ts` (sha256 `91f076f6…c391384`, commit `74684b9`, 12 Oct 2026). Phase 1 pins that hash in a drift test. The report must not disagree with the Portal's `/ttms` page about the same number. |
| **Formatting** | Counts: compact `1.9M` / `129.6K` / whole below 1,000 (⇄ `ttmsFmtCompact`). Rupiah: `Rp` + compact above 1M (`Rp46.6M`), else thousands-grouped (`Rp192.4K` allowed as compact). Percentages: 1 dp; vertical share 2 dp. Signed changes always carry a sign (⇄ `ttmsFmtSignedPct`). Ranks: `#38`, ties `=38` (⇄ `ttmsRankLabel`). |
| **Numeral gate** | Every numeral rendered must equal a value in this sheet's evidence for that report, within the engine's existing tolerance (`gates/numeral_gate.py`). |
| **Language** | Open decision (plan §4.1). Definitions are language-independent; only labels change. |
| **DB driver gotcha** | node-pg parses DATE into a local-midnight `Date`, so 2026-10-18 prints as `2026-10-17T17:00:00Z` on a WIB machine. asyncpg returns `datetime.date`, so the engine is unaffected. Any TypeScript check must set the OID 1082 parser to a string. |

## 2. Sources

All read-only, from the warehouse DB (the same database as the Portal's, filled by `npm run ttms:sync` daily at 09:00 WIB).

| Table | Used for |
|---|---|
| `ttms_accounts` | identity, plan, `is_lite`, `unavailable_metrics`, `advertiser_ids`, `last_data_date` |
| `ttms_audience_daily` | stage `brand_total` / `brand_new` / `brand_outflow`, `bench_total_top{5,10,25,50}` |
| `ttms_ranking_daily` | ranks: own brand and competitors (names + rank only) |
| `ttms_insight_daily` | metric × content type: `brand_value`, `brand_share`, `bench_top*` |
| `tiktok_ads_analytics` | spend: `cost_cash`, `gmv_max_cost`, `currency` |
| `tiktok_ads_campaign` | per-campaign `new_consideration_size`, objective, flight dates |
| `brands` | portal brand names for advertiser ownership |

**Advertiser set** `A` = `ttmsAdvertiserOwnership(account, links, portalNames)` ⇄. If the result is `sharedWith ≠ ∅`, every cost-per-audience figure is suppressed and the report states that spend covers several brands. BARDI: `A = {6926791720868839425}`, not shared.

---

## 3. Definitions

### H — Header

| ID | Figure | Definition | BARDI |
|---|---|---|---|
| H1 | Account name | `ttms_accounts.brand_name` (TikTok's name, not the portal brand name) | BARDI Smart Home |
| H2 | Plan badge | `Lite` when `is_lite`, else `Full` | Lite |
| H3 | Industry · region | `industry` · `region_code` | Consumer Electronics · ID |
| H4 | Data as of | `as_of` (UTC) | 2026-10-10 |

### F — Funnel and leak

| ID | Figure | Definition | BARDI |
|---|---|---|---|
| F1 | Stage size | `brand_total` on `as_of`, stage ∈ {AWARENESS, CONSIDERATION, CONVERSION} | 1,852,491 / 129,635 / 5,801 |
| F2 | Stage rank | Own row's `ranking` in `ttms_ranking_daily` on `as_of` for that stage. **Not** `ttms_audience_daily.brand_ranking`, which differs by ±1 (BARDI: 37/39/39). Ties shown `=n`. | #36 / #38 / #38 |
| F2a | Rank denominator | Number of rows in that day's ranking list for the stage. **Not** `total_brand_count`, which reports 64 while the list holds 56. Render "of N" only where the layout has room. | 56 |
| F3 | Benchmark size | `bench_total_top10` on `as_of` (benchmark level set per report; default Top 10). Null on Lite past the settled day, see §1. | 24,319,075 / 2,136,754 / 335,068 |
| F4 | **Stage size ratio** (was "move-on rate") | `F1[next] ÷ F1[this]` on `as_of`. **Label:** "Consideration is 7.0% the size of Awareness". It is a ratio of stocks, **not** a flow. The words "moves on", "converts" and "each period" are banned for this figure; the API has no transition data. | A→C 7.0%; C→Conv 4.5% |
| F4b | Benchmark stage ratio | The same ratio computed on `F3` | 8.8%; 15.7% |
| F5 | Ratio gap | `F4 − F4b` in percentage points | −1.8 pt; −11.2 pt |
| F6 | New (window) | Σ `brand_new` over `W` for the stage | Consideration 242,039 |
| F7 | Outflow (window) | Σ `brand_outflow` over `W` | Consideration 193,917 |
| F8 | Offset ratio | `F7 ÷ F6`. **Label:** "For every 100 people who joined Consideration, 80 left." Never call it "spend refilling a leaking bucket" unless S2 also holds (spend present). | 80.1% |
| F9 | Net change | `F6 − F7` = `brand_total[as_of] − brand_total[as_of − 30]` (identity; Phase 1 asserts it) | +48,122 |

### S — Spend and efficiency

| ID | Figure | Definition | BARDI |
|---|---|---|---|
| S1 | Spend (window) | Σ over `A`, `W` of `cost_cash + gmv_max_cost`, **IDR rows only** ⇄ (Portal "Cost"). USD rows are excluded and their total is stated in the footer when > 0 (plan §4.3). **Not** `tiktok_ads_campaign.spend`, which is a subset (BARDI Rp12.45M). | Rp46,574,627 |
| S1a | Daily spend range | min / max of daily S1 | Rp908K – Rp2.70M |
| S1b | GMV Max share | Σ `gmv_max_cost` ÷ S1 | **85.6%** |
| S2 | Cost per 1k new Consideration | `S1 ÷ F6(Consideration) × 1000` ⇄ `ttmsCostPerThousand`. Suppressed when `A` is shared. **Caveat, always shown:** TTMS "new" counts everyone who entered the stage, paid or organic; the cost is attributed to all of them. | Rp192,426 |
| S3 | Response fit | OLS of daily new Consideration on `ln(daily S1)`, with new Consideration taken **L days later**. **L is fixed at 2** (proposed; AM to confirm). It is chosen in advance and never tuned per account or per run, because picking the best lag per report is overfitting. Sample: pairs `(d, d+L)` where `d+L` falls in the last 56 days (8 weeks) up to `as_of`, `S1(d) > 0` and `brand_new(d+L)` is not null. Report R² and n. | R² 0.21, n 48 |
| S3a | Fit gate | A curve, a "diminishing returns" verdict or S4 may render **only if** R² ≥ 0.40 **and** n ≥ 42 (75% of 56 days). Otherwise the section shows the scatter plus S2 and the line "Spend and new Consideration don't track closely enough yet to draw a curve." | **gate fails** on R²: no curve, no cap |
| S4 | Suggested daily cap | Only when S3a passes: the spend level where the fitted marginal new Consideration per Rp1M falls below the window's average (S2⁻¹). Reported with below-cap and above-cap cost per 1k (S2 computed on days either side). | not shown |
| S5 | Objective mix | Spend share by `tiktok_ads_campaign` objective over `W`. It lets a decision say which stage spend targets. **Ban:** "none of the live campaigns targets purchase" while S1b > 0; GMV Max is purchase-optimised. | GMV Max 85.6% of spend |

For reference only: R² at lags 0–7 over 30 days was 0.17, 0.30, 0.23, 0.09, 0.06, 0.00, 0.00, 0.00. Over 8 weeks it was 0.10, 0.18, 0.21, 0.16, 0.15, 0.07, 0.06, 0.05. No lag reaches 0.40, so the mock-up's R² 0.61 and its Rp1.6M cap are not supported by the data.

### R — Goal pacing

| ID | Figure | Definition | BARDI |
|---|---|---|---|
| R1 | Weekly rank series | F2 on the last day of each ISO week (⇄ audience rollup: rank = last day of bucket), from the ranking list. History starts 2026-07-12 for BARDI, the start of ranking backfill. | see §6 |
| R2 | Projected rank | Theil–Sen slope (robust to outlier weeks) over the last 8 weekly ranks, extrapolated to the target date, clamped to [1, F2a]. Shown as a **range**: the projection from the slope's 25th–75th percentile pairwise slopes. Not shown with < 6 weekly points. | Phase 1 |
| R3 | Target | AM-entered `{stage, top_n, by_date}` (plan Phase 3 `strategy_goals`). Without a stored target, this section does not render; there is no default target. | none stored |
| R4 | Gap to target | `F2 − top_n` ranks. **Banned:** "needs N× the net gain" or any people-per-day figure. TTMS gives competitors' ranks but not their sizes, so the audience size at rank `top_n` is unknown. Allowed estimate, labelled "≈": `bench_total_top{n}` when `n` ∈ {5, 10, 25, 50}, described as "the Top n *average*", never as the size needed for rank n. | Phase 3 |

### C — Content mix and earned halo

| ID | Figure | Definition | BARDI |
|---|---|---|---|
| C1 | Impressions on brand videos | Σ `brand_value`, metric IMPRESSIONS, content `ALL`, over `W` | 4,006,317 |
| C2 | Paid / non-paid split | `PAID_CONTENT ÷ ALL` and `NON_PAID_CONTENT ÷ ALL`. This is the **only** split that sums to 100%, and the only one drawn as a stacked bar. | 95% / 5% |
| C3 | Sub-type reach | Each of the 7 sub-types as `type ÷ ALL`, drawn as **separate** bars labelled "x% of all". **Never stacked or summed.** They overlap: a boosted creator video is also an ad. ADS may exceed 100% because TTMS counts differently; display caps at 100% with a note (⇄ `ttmsReachShare` rule). | Ads 101%, BGC boosted 73%, Creator organic 16%, Creator boosted 5%, BGC organic 4%, UGC organic 1%, UGC boosted 0% |
| C4 | Earned halo | `NON_PAID_CONTENT ÷ PAID_CONTENT` impressions over `W`. Benchmark = the same on `bench_top10`. | **0.06** vs Top 10 0.63 |
| C5 | Lite availability | UGC content types **are** available on Lite (stored for BARDI). Only `unavailable_metrics` (SEARCH_VOLUME, NSR) lock. A lock card is rendered only from `unavailable_metrics`, never from plan name. | locked: SEARCH_VOLUME, NSR |
| C6 | Creator cost per 1k impressions | AM-entered monthly creator fees ÷ (CREATOR_CONTENT_ORGANIC + CREATOR_CONTENT_BOOSTED impressions in that month) × 1000. The section appears only when fees are stored. **Caveat:** boosted creator impressions are also paid as ads, so this understates the true cost of boosted content. | no input stored |
| C7 | Ad cost per 1k impressions | `S1 ÷ ADS impressions × 1000` (TTMS `ADS` content type, metric IMPRESSIONS, window `W`) | Rp11,490 (4,053,477 ADS impressions) |

### W — Early warnings (checked daily against `as_of`)

Thresholds are **proposed**, for AM confirmation. A warning renders only when its condition holds. The mock-up's three example warnings did not occur in BARDI's data; Phase 1 computes the real ones.

| ID | Warning | Fires when | BARDI on 10 Oct |
|---|---|---|---|
| W1 | Competitor rank jump | A brand in the same stage's list improves ≥ 4 places in 10 days **and** now ranks within 10 places of the account (or in the top 10). The text names the brand from the list and states "TTMS gives their rank only, not their numbers". | Consideration: **fires twice**, for #42→#35 (within ±10 of #38) and #13→#9 (now in the top 10) |
| W2 | Outflow spike | A stage's `brand_outflow[as_of]` ≥ 1.5 × its mean over the 14 days before. The text links the spike to a campaign end date (S5 source) only if one falls within 3 days before. | Awareness 0.97× → no |
| W3 | Share shift | Vertical share (⇄ `ttmsAggregateInsight`) of ENGAGEMENTS or IMPRESSIONS changes ≥ 25% relative between `W_prev` and `W`. The text also gives the brand's growth against the Top 10 average's growth (the Portal's highlight rule). | **Fires.** Engagements: share 0.12% → 0.29%; brand +188% vs Top 10 avg +15%. Impressions: share 0.09% → 0.24%; brand +243% vs Top 10 avg +32% |
| W4 | Locked signal | One informational row per `unavailable_metrics` entry. It never carries a value. | SEARCH_VOLUME, NSR |
| W5 | Stale data | `today_utc − last_data_date` > 4 days (⇄ `TTMS_STALE_DAYS`): a banner, and every decision is held. | no |

### D — Decisions

A decision is a ranked `Finding` with these extra fields (contract in Phase 2):

| Field | Rule |
|---|---|
| `action` | One sentence from the claim-frame template; executable without asking a question (PRD §5.4 rubric). |
| `stake` | Either a **measured** figure from this sheet (e.g. "saves Rp X a month at the same new Consideration", allowed only when S3a passes), or a **scenario** that states its assumption verbatim: "If Conversion reached the Top 10 ratio (15.7%) of today's Consideration, that is 20,328 people; today it is 5,801." Free-standing forecasts ("+2.1K to 3.4K buyers") are banned until the action log (L) holds ≥ 3 measured outcomes for the same claim frame. |
| `confidence` | The PRD §8 ladder applied to the inputs the decision rests on: **High** = ≥ 4 comparable periods, coverage ≥ 95% and (for spend claims) S3a passes. **Medium** = 2–3 periods or coverage ≥ 80%. **Low** = otherwise; descriptive only. Plus: no causal wording at any tier ("caused", "drove", "because of spend"). "Lines up with" and "follows" are the strongest allowed. |
| `falsifier` | The observable result that would prove the decision wrong: metric ID + direction + **check-by date ≥ as_of + 14 days** (TTMS stages are 15-day rolling windows, so anything sooner is noise). |
| `sources` | The sheet IDs used, e.g. `F4, F5, S1b`. Rendered as plain names. |
| Count | Top 3 by materiality, at most one per claim frame. Fewer is fine; none is fine. |

### L — Action log ("Did it work?")

| ID | Figure | Definition |
|---|---|---|
| L1 | Measured result | Change in the decision's falsifier metric from the 14 days before acceptance to the 14 days ending at check-by. |
| L2 | Category, same period | The same change computed on the benchmark (`bench_top10`, or the metric's category estimate via `ttmsCategorySize` ⇄ for insight metrics). |
| L3 | Verdict | **Too early** before check-by. **Worked** = L1 moved in the intended direction and beat L2 by ≥ 5 pt. **Weak** = moved the intended way, but within 5 pt of L2. **Didn't work** = flat or the wrong way. Fixed rules, never model-judged. |
| L4 | Disclaimer | Always shown: "Compared with the category over the same days; this does not prove the action caused the change." |

---

## 4. Banned claims (each one has a test)

1. "Moves on", "converts", "each period" applied to F4.
2. Any category total for an audience stage. TTMS gives only Top-N averages. (The mock-up's "Category Consideration grew 3%".)
3. Any competitor value (size, impressions or spend). Ranks only.
4. Stacked or summed content sub-types (C3).
5. A response curve, cap or "diminishing returns" without S3a.
6. "No campaign targets purchase" while GMV Max spend > 0 (S5).
7. People-per-day or "N× net gain" needed to reach a rank (R4).
8. Causal language at any confidence tier (D).
9. A Lite lock on anything not in `unavailable_metrics` (C5).
10. Any number that is not in this report's evidence (numeral gate).

## 5. What the mock-up showed vs this sheet

| Mock-up | This sheet | Change |
|---|---|---|
| Consideration rank #38 | F2 = #38 (ranking list) | none; source pinned |
| 4.5% "moves on to Conversion" vs 15.7% | F4 4.5% vs F4b 15.7% | relabelled as a size ratio |
| Awareness→Consideration 7.0% vs 8.7% | 7.0% vs 8.8% | benchmark 8.8% |
| "97% offset" (outflow ≈ 236K, simulated) | F8 80.1% (outflow 193,917) | corrected |
| Rp192.4K per 1k new | S2 Rp192,426 | none |
| R² 0.61, cap Rp1.6M/day | S3 R² 0.21 at L2; gate fails | curve and cap removed |
| "None of the live campaigns targets purchase" | S1b: GMV Max is 85.6% of spend | claim removed |
| Path to #25 needs "4× net gain, +2.3K/day" | R4 bans it | removed |
| Content mix stacked 71/10/9/6/4 | C2 95/5 + C3 overlapping bars | redrawn |
| Earned halo 0.19 vs 0.62 | C4 0.06 vs 0.63 | corrected |
| UGC split "needs full plan" | C5: available on Lite | lock removed |
| Competitor C #9→#4 | W1: real movers #13→#9 and #42→#35 | replaced by real movers |
| Awareness outflow 2.1× average | W2 0.97× | does not fire |
| Engagement share 0.9%→1.6%, engagements +188% vs category +27.6% | W3: share 0.12%→0.29%, +188% vs Top 10 avg +15% | share and benchmark corrected; the +188% was real |
| Ads Rp16,408 per 1k impressions | C7 Rp11,490 | corrected |

## 6. BARDI reference series (fixture seeds)

**R1, weekly Consideration rank** (ranking list, last stored day of each ISO week; the final week ends at `as_of`):
12 Jul 42 · 19 Jul 41 · 26 Jul 41 · 02 Aug 40 · 09 Aug 42 · 16 Aug 43 · 23 Aug 44 · 30 Aug 41 · 06 Sep 42 · 13 Sep 43 · 20 Sep 42 · 27 Sep 36 · 04 Oct 35 · 10 Oct 38.

The series moves sideways in the low 40s until a step to #35–38 in late September. It is not the steady climb the mock-up drew. Phase 1 freezes this series, and every other reference value in §3, into `eval/fixtures/bardi_ttms_week.py`.

## 7. For sign-off

The AM confirms or changes each of these:

- [ ] S3 lag fixed at 2 days; fit gate R² ≥ 0.40 with n ≥ 42 of the last 56 days
- [ ] F2a denominator = ranking-list length (56), not `total_brand_count` (64)
- [ ] Default benchmark level = Top 10
- [ ] W1 threshold ≥ 4 places in 10 days, within ±10 ranks of the account or in the top 10
- [ ] W2 threshold ≥ 1.5× the 14-day mean
- [ ] W3 threshold ≥ 25% relative change in vertical share
- [ ] L3 verdict margin = 5 pt over category
- [ ] Falsifier check-by ≥ 14 days
- [ ] Spend = Portal Cost including GMV Max (S1), with S1b always shown next to S2
