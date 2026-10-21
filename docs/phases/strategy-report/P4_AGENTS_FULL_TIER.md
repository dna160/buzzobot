# P4 — Agents, full tier — HANDOVER

**Status:** ✅ Complete. · **Verified 2026-10-21** against LM Studio (`google/gemma-4-12b`, localhost:1234), the live Tempo DB and a second engine on :8002 running this branch:
- The live exit gate (`tests/test_live_strategy_exit_gate.py`, PRD §11.3) ran 40 full-tier generations: 20 on the frozen BARDI frame (shop class) and 20 on the synthetic brand-class frame. Results are in §4.
- The async web route (`POST` then `GET …/strategy-report/full`) produced BARDI's stored full-tier PDF. The sibling route then served it warm (`X-Report-Artifact: pregenerated`). See §4.
- The async engine API ran `POST /v1/briefs` → `running` → `approved`. The run wrote `insight.materiality_rankings` rows and showed up in `/healthz`.
- The engine suite passes except one test (`test_probe_loop_live`, §5). The strategy suites pass, and web, reports, db and ingestion typecheck, lint and test clean.

## 1. Scope

PRD §12 P4:
- **§13 fixes:** LLM env config, `finish_reason` handling, the semaphore and shared client, a truly async `POST /v1/briefs`, and `persist_rankings` in the production path. `end_date` was already fixed in P2.
- **The full tier:** strategy prompts, schemas and gold set; the section narrator and critic; the Action Phraser and action critic; the T1 synthesist; the Action, Chip and class-highlight gates; the strategy numeral rules; the token budget and name tokenizer.
- **Exit gates:** the live §11.3 gates, with pass@1 recorded in `meta.eval`.
- **Web:** the async `/full` route.

## 2. What shipped

| Area | Files (`tempo-engine/src/engine/` unless noted) |
|---|---|
| LLM layer (§8.1, §13 #2–#4) | `llm/client.py`:<br>• `LmStudioConfig.from_env()` reads the `LM_STUDIO_*` variables<br>• `max_tokens` 8192; `finish_reason=length` with empty content raises `LmStudioTruncated`<br>• `seed`, plus `reasoning_effort` per agent (off for narrator and phraser, low for critic and synthesist)<br>• one semaphore and one HTTP client per event loop (one per process in the API)<br>• 2 transport retries with backoff, separate from the quality retries<br>• `CallStats`, and `stable_seed(run_id, agent, section)` |
| Budget and privacy (§8.1, §8.7) | `llm/budget.py`: estimate and `trim_to_budget`, which drops the lowest-materiality finding first and records the trim. `llm/tokenize.py`: `NameTokenizer` replaces the client's names with `BRAND` / `KAMPANYE_n` before the prompt and restores them before the gates run; competitor names pass through. |
| Prompts, schemas, gold set (§8.5) | `llm/strategy_prompts.py`:<br>• the compact table payload `id \| klaim \| arah \| keyakinan \| fakta` and a glossary<br>• strict JSON schemas that list routed finding ids as an `enum`, so the model cannot cite an unseen finding<br>`llm/strategy_gold_set.py`: one hand-written exemplar per narrated section, plus the phraser and the verdict, all with deliberately foreign numbers. |
| Agents (§8.3) | `agents/strategy_narrator.py`: `gated_call` (call, de-tokenize, gate, retry once with the violations appended), the narrator, and the critic with `revision_problems`.<br>`agents/action_phraser.py`: one call for ≤ 3 actions, then the action critic, gated per action.<br>`agents/strategy_synthesist.py`: T1 with the Chip Gate. |
| Gates (§8.6) | `gates/strategy_gates.py`:<br>• the numeral rules: permitted values are evidence plus the numerals in the payload; `%`/`poin` count as one family; scale words (juta, ribu, miliar); `Rp48.596.564` written without a space; labels such as `per 1.000`, `Top 50`, `R²` and dates are ignored<br>• `run_action_gate`, `run_chip_gate`<br>`gates/generic.py`: banned filler, the "no entity, no number" check, and quotes or remarks about the text.<br>`gates/consistency.py`: the class-highlight gate, action evidence resolution, chip routing. |
| Full-tier node (§8.4) | `graphs/strategy_agents.py` replaces the P2 placeholder:<br>• the instant report is built first, and each agent only replaces a part with copy that passed its gates<br>• narration follows class order (T3–T7), then actions, then T1, then consistency<br>• `llm_unreachable` and `full_tier_time_cap` (`STRATEGY_FULL_TIER_CAP_S`) degrade the run, not fail it<br>• `meta.eval` carries pass@1, fallback rates, attempts, critic outcomes, trims, calls and tokens |
| API (§13 #1, #6, §10) | `api/dispatcher.py`: `prepare_brief_run` / `execute_brief_run` / `start_brief_run_async`. The row is written as `running` first; a background task runs the graph and moves the row to `pending_review` or `approved` (with `auto_approve`), or to `failed` with `content.error`.<br>`materiality/persistence.py`: `persist_ranking_state`, written after every run.<br>`ports/tempo_read.create_pool`: the API now uses a pool, so a poll never waits behind a background run's query.<br>`/healthz`: `brief_types`, `llm`, `last_strategy_run`, `strategy_runs`. |
| Web | `app/api/reports/[slug]/strategy-report/full/route.ts`: POST to start, GET to poll; it renders and stores the PDF, writes back the actions, and returns `downloadUrl`.<br>`lib/strategy-report-pipeline.ts`: `startStrategyRun`, `fetchStrategyRun`.<br>Panel: a full-tier PDF now starts the async run, polls with progress, then downloads.<br>The deck's `/full` route handles the engine's new `failed` status. |
| Tests | `tests/test_strategy_agents.py` (25 tests):<br>• the client against a mock transport (env, seed, truncation, transport retry, semaphore)<br>• budget, tokenizer, numeral rules, Action Gate, Chip Gate, generic detector, consistency<br>• the full node with a scripted model: accept, per-part fallback, unreachable, time cap<br>`tests/test_strategy_api_live.py`: async lifecycle, rankings rows, `/healthz`.<br>`tests/test_live_strategy_exit_gate.py`: §11.3.<br>`tests/test_review_api_live.py` now polls the async lifecycle. |

## 3. Entry contract for P5

| Contract | Where | Guarantee | Held up by |
|---|---|---|---|
| `POST /v1/briefs` is async | `api/app.py`, `dispatcher.start_brief_run_async` | Returns `{run_id, status: "running"}` immediately; `GET` moves to `pending_review` → `approved` (if `auto_approve`) or to `failed` with `content.error`. An ineligible client is a 404 before any row is written. | `test_strategy_api_live.py`, `test_review_api_live.py` |
| `meta.eval` | full-tier content | `pass_at_1{narrator, action_phraser, synthesist, chip_gate}`, `fallback_rate{sections, actions}`, `duration_s`, `llm_calls`, plus per-part detail. Absent on the instant tier. | `test_full_tier_*` |
| `meta.degraded` | content | Full tier adds `llm_unreachable`, `full_tier_time_cap` and the consistency violations (`class_highlight_missing`, `action_evidence_unresolved:<id>`, `chip_unrouted:<n>`). | same |
| Full tier never fails a report | `graphs/strategy_agents.py` | Every part either passed its gates or is the instant copy. | `test_full_tier_falls_back_per_part`, `…_unreachable…` |
| Chips are code's | synthesist | A T1 chip's label and value are always the deterministic ones; the model only proves it kept them (Chip Gate pass@1). | `test_full_tier_falls_back_per_part` |

## 4. How to run / verify

```bash
cd tempo-engine
uv run pytest -q tests/test_strategy_agents.py tests/test_strategy_solver_and_graph.py tests/test_strategy_generators.py
# live (LM Studio reachable): PRD default is 20 runs per fixture (~35 min); 1 is a smoke run
STRATEGY_EXIT_GATE_RUNS=20 STRATEGY_EXIT_GATE_OUT=exit.json uv run pytest -q -s tests/test_live_strategy_exit_gate.py
# one full-tier report from a fixture, without the API
uv run python scripts/dump_strategy_content.py eval/fixtures/bardi_strategy_frame.json shop out.json full
```

**Exit gate, 2026-10-21** (`STRATEGY_EXIT_GATE_RUNS=20`):

| Gate (PRD §11.3) | Threshold | Shop (BARDI, 20) | Brand (synthetic, 20) | All 40 |
|---|---|---|---|---|
| Numeral fidelity (accepted sections) | 100% | 100% | 100% | **0 orphans** |
| Section fallback rate | < 5% | 0% | 0% | **0%** |
| Action-copy fallback rate | < 10% | 0% | 0% | **0%** |
| Action Gate pass@1 | ≥ 80% | 20/20 | 20/20 | **100%** |
| Chip Gate pass@1 | ≥ 80% | 20/20 | 18/20 | **95%** |
| Class-highlight gate | 100% | 20/20 | 20/20 | **100%**; T6 content and section order differ by class |
| Generic-sentence detector | 0 | 0 | 0 | **0** |
| Wall clock | p95 ≤ 600 s | 42–58 s (median 45) | 47–58 s (median 50) | **p95 56 s** |
| Cloud calls | 0 | — | — | **only `localhost`** |

Also recorded:
- Narrator pass@1 was 1.0 on every run.
- Synthesist pass@1 was 19/20 (shop) and 14/20 (brand). Its retries are mostly the chip status on the brand fixture, and every retry passed.
- Runs averaged 13 calls; none was degraded.

**Async web route** (`/full`, BARDI, :8002): `POST` returned `running` in 115 ms; the poll found it `ready` after 46 s and stored a 5-page, 149 KB A4 PDF. `GET …/strategy-report?tier=full&format=pdf&days=28` then served the same 148,612 bytes with `X-Report-Artifact: pregenerated`.

Skipped without services:
- `test_live_strategy_exit_gate` needs LM Studio.
- `test_strategy_api_live` and `test_review_api_live` need `TEMPO_ENGINE_DATABASE_URL`.

## 5. Deferred / known

- **`test_probe_loop_live` fails stochastically.** This is the deck's analyst probe-yield eval (0.11, 0.24 and 0.36 against a 0.40 target across three runs). It fails at `max_tokens` 4096 as well as 8192, and it failed once in P1 before any client change. It concerns the deck's probe loop, not the strategy report, which runs with the probe loop off (PRD §8.2).
- **T8 is not narrated.** The renderer prints T8's signal rows, not a paragraph (P3 decision), so narrating it would spend two calls on text nobody reads. The full tier narrates T3–T7 and T1, with up to 13 calls plus retries against the PRD's ≤ 19.
- **tiktoken** is not used for the budget estimate. It downloads its BPE file on first use, which the "0 cloud calls" gate forbids. `llm/budget.py` uses a conservative character estimate (3.6 characters per token × 1.15).
- **Health card UI and cron:** P5.

## 6. Decisions taken here

1. **Numeral permission includes the payload's own numerals.** The `fakta` column is deterministic code output, so a number the model copies from it is code's number, even when it is derived (for example a "selisih 11,21 poin" the instant copy computed). A number not in the table is still an orphan.
2. **Chip labels and values are restored from code** after the Chip Gate passes. A misspelt word in a chip ("titik juhur") passes the numeral check but must never print.
3. **Critic revisions must not hollow a draft out.** A revision that drops the implication, cuts the headline below 60% of its length, or ends mid-sentence is rejected and the narrator's draft is kept. All three were seen live.
4. **Action Gate precision.** A value written with decimals matches when it is the solver value rounded to that precision ("4,3%" for 4,35%). A whole number needs a 1% match. `investigate` actions need both ranks and the competitor's name, not a horizon.
5. **Gating is per action.** One action's bad copy never discards the other two.
6. **`auto_approve` on async POST.** The web `/full` route polls straight to `approved`, as `/sync` does; the review gate is still exercised.
