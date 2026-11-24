# P2 — Engine, instant tier — HANDOVER

**Status:** ✅ Complete. · **Verified:**
- 276 engine tests pass (13 skipped without a live DB or LM Studio), including 37 new strategy tests.
- The exported content schema matches, checked by the Python export test and the TypeScript drift test (38 passing, 17 definitions mirrored).
- **Live run, 2026-10-21:** `run_brief_sync(brief_type="strategy", tier="instant")` against the real Tempo DB:
  - `bardi-tiktok` and `purbasari-id` each returned a complete, approved report.
  - `chocomory` was refused with "no Market Scope account with at least 14 days", as P0 §3 predicted.
- The instant tier constructs no LLM client; a test fails if it does.
- Every sentence it writes passes the numeral gate against its own evidence; a test checks this.

## 1. Scope

PRD §12 P2:
- `strategy_read.py`, the classifier, T01–T11, the claim frames and presets
- templates, the content fields and the schema export, plus the Zod mirror

Exit criterion: `POST /v1/briefs/sync {brief_type: strategy, tier: instant}` returns a complete content object for BARDI and for one brand-class client. The brand class is exercised through the `report_class` override, because every real client infers to `shop` (P0 §6.1).

## 2. What shipped (tempo-engine unless noted)

| Area | Files |
|---|---|
| Contracts | `contracts/strategy.py` (new), `contracts/finding.py`, `contracts/metric_frame.py`, `contracts/content.py`. See the contracts note below. |
| Read port | `ports/strategy_read.py` (`build_strategy_frame`), `ports/strategy_classify.py` (PRD §5.2 formula) |
| Generators | `generators/strategy/`: T01 funnel size ratios and inflow offset, T02 spend response, T03 goal pacing, T04 content mix and halo, T05 SOV and rank, T06 competitors, T07 search and sentiment, T08 outflow and flight end, **T09 Target Solver**, T10 coverage, T11 re-measurement. Shared `_util.py` (`metric_value` is the one evaluator for sizing and measuring) and `base.py` |
| Stats | `stats.py` adds `theil_sen_slope`, `fit_saturating` (+ `SaturatingFit.knee = b·ln2`), `spearman_rho`, `pearson_r` |
| Materiality | `materiality/strategy.py`: PRD §5.3 class weights, T-section routing in class order, no finding narrated twice, T6 eligibility per class, per-class card caps, below-the-cut kept |
| Copy | `copy/strategy.py`: Bahasa templates for every strategy claim frame, `deterministic_action_copy` (Appendix D), `deterministic_verdict` (T1 + 3 chips), T8 signals, card copy |
| Graph | `graphs/strategy.py`: fan-out, route, instant copy, and the export blocks (charts, signals, goal pace, action log, meta). `graphs/brief.py`: conditional edges on `brief_type` and tier. `graphs/strategy_agents.py` is the full-tier hook, filled in P4 |
| API | `api/app.py`: `brief_type: strategy`, `end_date`, `report_class`; window default 28 for strategy. `api/dispatcher.py`: `_start_strategy_run`, with eligibility = a mirrored TTMS account with ≥ 14 audience days |
| Schema | `contracts/brief_content_v2.schema.json` re-exported |
| Fixtures | `eval/fixtures/bardi_strategy_frame.json` (**frozen real rows**, BARDI as of 2026-10-10), `eval/fixtures/strategy_synthetic.py` (`brand_full`, `lite_minimal_14d`, with planted signals labelled synthetic). Scripts `dump_strategy_frame.py`, `dump_strategy_content.py` |
| Tests | `tests/test_strategy_generators.py`, `tests/test_strategy_solver_and_graph.py` |
| packages/reports | `strategy-report/engine-content.ts` (Zod mirrors); `deck/engine-content.ts` gains optional strategy fields and three finding levels; the drift test mirrors 7 more definitions; fixtures `strategy-report/fixtures/engine-content.strategy.{shop,brand}.json` |

**Contracts note.** `contracts/strategy.py` holds the `StrategyFrame`, `StrategySectionId` (T1 = 101 … Lampiran A = 110), `ActionItem` (PRD §5.4), `Classification`, the export blocks and the drafts.
- `contracts/finding.py` gains 31 claim frames, `FindingLevel` brand/benchmark/competitor, and affinity 102–110.
- `contracts/metric_frame.py`: `BriefType` gains `"strategy"`.
- `contracts/content.py` gains `report_class`, `action_plan`, `signals`, `goal_pace`, `action_log`, `charts` and `meta`, all optional.

## 3. Entry contract for P3 / P4

| Contract | Guarantee | Held up by |
|---|---|---|
| `content.sections["101".."110"]` | 101 is a `VerdictDraft` (headline, paragraph, exactly 3 chips). 103–110 are `StrategySectionDraft` (headline, 1–3 paragraphs each with `evidence_refs`). 102 (actions) has no draft: the Action List is `action_plan`. Every section renders on every run, with an honest empty state when data is missing. | `test_instant_report_is_complete`, `test_lite_minimal_renders_honest_empty_states` |
| `content.action_plan` | ≤ 3 `ActionItem`s ranked by the solver, each with `copy`. Every number is the solver's. One per lever. Investigate has no target. | `test_bardi_actions`, `test_solver_bounds_on_every_fixture` |
| `content.meta.section_order` | The class's section order (PRD §5.3). The renderer must render in this order. | `test_class_changes_order_and_t6` |
| `content.charts` | Funnel, spend-response points and fit, weekly ranks, content mix (shares + benchmark, never stacked except paid/non-paid), ranking list (top 10 + ±5), stage table. Computed with the generators' own helpers. | `graphs/strategy.build_charts` |
| `content.report_class` | Class, score, inferred class, override flag, inputs. Shown to the AM only (PRD Q5 default). | classifier tests |
| Numerals | Every numeral in template prose is in the cited findings' evidence. | `test_every_instant_numeral_is_in_evidence` |

## 4. How to run / verify

```bash
cd tempo-engine
.venv/Scripts/python.exe -m pytest -q tests/test_strategy_generators.py tests/test_strategy_solver_and_graph.py
.venv/Scripts/python.exe scripts/export_content_schema.py --check
.venv/Scripts/python.exe scripts/dump_strategy_content.py eval/fixtures/bardi_strategy_frame.json shop out.json
cd .. && pnpm --filter @tempo/reports exec vitest run src/deck/engine-content
```

The live check above needs `TEMPO_ENGINE_DATABASE_URL`; the pure tests do not.

## 5. Deferred

- **Full tier:** narrators, critics, Action Phraser, synthesist and the gates are P4. Until then a full-tier strategy run returns the instant copy with `meta.degraded = ["full_tier_not_built"]`.
- **Insight series in the frame are trimmed** to what the generators read: impressions by content type, plus engagements, 6-second views, search, product-card clicks, comments and NSR. Every checkpoint stores the frame.
- **`ports/benchmark.py` (PRD §7.4)** is not a separate provider. The benchmark set is the frame's `bench_*` columns at `frame.benchmark` (default Top 10). The interface becomes worth it when B14's cohort layer exists.
- **`persist_rankings` in production (§13 #6)** is P4, with the other §13 fixes.

## 6. Decisions taken here

1. **The strategy input is a typed `StrategyFrame`, not `MetricFrame.records`.** It carries the same groups PRD §7.2 lists (brand, benchmark, account spend, day series, competitors, goal, open actions). Every strategy generator reads series, so typed series keep them pure and short.
2. **T02's lag is fixed at 2 days** rather than the best Spearman lag of {2,3,4} picked per run, which would inflate the reported fit. The response stage is Consideration for both classes (Conversion has no flow), and a cap needs R² ≥ 0.5. On BARDI the fit is R² ≈ 0, so the report says "belum terbaca" and proposes no cap.
3. **T04 judges "paid-heavy" on the paid share**, not `ads`, because sub-types overlap and `ads` is 101% of all. The content-mix lever picks only between brand content and creator content: UGC is reported but is not something a brand can commission.
4. **T05 uses the exact vertical total for category growth** (P0 §6.5). `RANK_MOVED` uses audience-stage ranks, because per-metric rank is not stored. `SOV_STABLE` was added so flat product-card clicks are not called "gaining".
5. **Target Solver:**
   - Sized actions rank before Investigate, then by confidence, then by trigger materiality (stakes are in different units).
   - `creator_boost` steps vertical share +30% relative, because "+3 points" on a 0.24% share is absurd.
   - The shop `stage_targeting` kill signal is product-card clicks, since Conversion-stage new audience is always 0.
6. **No finding is narrated in two sections.** Sections fill in the class's order, so the shop class's Conversion leak leads T3 and is not repeated in T6.
7. **Prose says "per seribu", not "per 1.000"**, because the 1.000 is a unit, not evidence. P4 also teaches the numeral gate the unit phrase.
8. **`as_of` defaults to the account's settled day** (`last_data_date`, T-3 today, P0 §3) rather than a fixed T-4. TTMS writes nothing unsettled into the mirror.
