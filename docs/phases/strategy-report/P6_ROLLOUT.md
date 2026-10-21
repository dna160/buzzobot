# P6 — Rollout tooling — HANDOVER

**Status:** 🛠 Tooling complete; **the review itself needs people.** · **Verified 2026-10-21:**
- **Edit capture end to end** (`test_review_edits_are_applied_and_recorded`, live DB):
  - A strategy run paused at review, and its review page rendered editable fields.
  - An edit to a non-copy path was refused with a 422, and the run stayed pending.
  - An approved headline edit landed in the stored brief and in `insight.brief_edits` with its distance.
- `eval/generic_detector.py` ran over the live full-tier reports: 0 flagged paragraphs in model-written sections.
- Final verification across all suites is in §4.

## 1. Scope

PRD §12 P6 asks for:
- an AM review of 3 clients × 2 weeks, with edit capture;
- prompt tuning only through the gold set and the gates, never by loosening a gate;
- the edit-distance trend recorded, then a go/no-go for all clients.

What code can do is the tooling that makes that review measurable. The review is a human process, so this document is also its runbook.

## 2. What shipped

| Area | Files |
|---|---|
| Edit capture (§11.4) | `tempo-engine/migrations/0004_create_brief_edits.sql` adds `insight.brief_edits`. It is also created idempotently at API start-up (`api/edits.ensure_edits_schema`).<br>`api/edits.py`: `apply_edits` accepts only engine-written text (headlines, paragraphs, implications, deck mechanism/action, Action List copy); evidence, solver numbers, chips and refs are not addressable. `edit_distance` is `1 − SequenceMatcher.ratio`.<br>`POST /v1/briefs/{id}/review` takes `edits[]` and `editor`. Edits apply on approve and are validated before the graph resumes (an invalid edit is a 422 with nothing changed). |
| Review page | `/ui/briefs/{run_id}` for a strategy brief: every section in class order, T2's four copy fields per action, the source and attempts per section, the degraded flags and the duration. Changed fields are highlighted, and Approve sends only those. |
| Edit-distance report | `tempo-engine/scripts/edit_distance_report.py [brief_type]`: per type and month, it reports approved briefs, edited briefs, edits, and the mean distance overall, on model copy and on deterministic copy, against the 15% target. |
| Generic-sentence detector | `tempo-engine/eval/generic_detector.py` runs over content JSON files or `--db strategy N`. It exits 1 if a model-written paragraph is flagged. The rule itself is `engine/gates/generic.py`, the same one the full tier uses as a soft gate. |

## 3. Runbook — the AM review (3 clients × 2 weeks)

1. **Pick three clients.** Use one shop-class client (BARDI, `bardi-tiktok`), one brand-class client, and one Lite account with short history (for example `purbasari-id`). All need a Market Scope account (Settings → the client's Strategy Report page shows "Akun TTMS").
2. **Each Monday,** the cron produces the full-tier report (`pnpm --filter @tempo/ingestion decks:cron`, schedule `DECK_CRON_SCHEDULE`). To review before it reaches the client, run with review instead of auto-approve:
   ```bash
   curl -X POST $TEMPO_ENGINE_URL/v1/briefs -H 'content-type: application/json' \
     -d '{"client_slug":"bardi-tiktok","brief_type":"strategy","tier":"full"}'
   # open $TEMPO_ENGINE_URL/ui/briefs/<run_id> when GET /v1/briefs/<run_id> says pending_review
   ```
3. **The AM edits wording only,** then approves or rejects. If a *number* is wrong, that is a generator bug: reject, and file it with the run id. Do not edit around it.
4. **Weekly,** run `uv run python scripts/edit_distance_report.py strategy` and `uv run python eval/generic_detector.py --db strategy 20`. Record both in this file's §6 log.
5. **Tuning,** when an edit pattern repeats (the same rewrite twice), changes only:
   - `llm/strategy_gold_set.py`: add or replace the section's exemplar, with foreign numbers;
   - `llm/strategy_prompts.py`: glossary, section job, `PROMPT_VERSION` bump;
   - a gate, made **stricter** only.

   Then re-run `tests/test_live_strategy_exit_gate.py` (20 per fixture) before shipping the change.
6. **Go/no-go after 2 weeks:**
   - mean edit distance on model copy < 15% and falling;
   - no generator bug filed in week 2;
   - exit gate green on the current `PROMPT_VERSION`.

## 4. Final verification (whole PRD, 2026-10-21)

| Suite | Result |
|---|---|
| tempo-engine `pytest` (all, LM Studio and DB live; the 20-run exit gate deselected because it ran separately, see P4) | 320 passed, 13 skipped, **1 failed:** `test_probe_loop_live` (the deck's probe yield, 0.36 against 0.40; stochastic, pre-existing, see P4 §5) |
| Strategy exit gate, 40 runs (P4 §4) | all gates pass, p95 56 s |
| `@tempo/core` | 253 passed |
| `@tempo/reports` | 259 passed |
| `@tempo/db` | 70 passed, 1 skipped (live parity, `SPEND_PARITY_LIVE`) |
| `@tempo/tiktok` | 19 passed |
| `@tempo/ingestion` | 9 passed |
| Typecheck, every workspace package | clean |
| `@tempo/web` lint | clean |
| Live: async `/full` → stored PDF → warm serve (BARDI) | 46 s, 149 KB, `pregenerated` |
| Live: accept → measure → write-back → T9 (BARDI) | as in P5 §4 |

**PRD milestone status:**
- P0–P5 are done.
- P6's tooling is done; P6's review is the runbook above.
- The running `pnpm stack` engine (:8001) predates P2. Restart it to serve the strategy report and the full tier from the dashboard.

## 5. Deferred

- **The review itself** (3 clients × 2 weeks) and the go/no-go: human work, per the runbook above.
- **Edit capture in the portal.** Edits are captured on the engine's review page, the PRD's named surface (§11.4). The portal has no editor for report text.

## 6. Review log

| Week | Client | Runs reviewed | Mean edit distance (model copy) | Generic flags | Notes |
|---|---|---|---|---|---|
| | | | | | |
