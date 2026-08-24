# M7 — Kill list — HANDOVER

**Status:** ✅ Complete · **Verified:** the alias driven against a running server;
the deck re-rendered and the surface re-opened in a browser after the deletions.
`pnpm typecheck` 8/8, `lint` 8/8, `test` 6/6, `build` 3/3. Migration 0009 applies
clean on a local PGlite.

Seven thousand two hundred lines went. The reason they could go is the five
milestones before this one, not this one.

## 1. Scope

PRD §1, §9, §11 R6. The deck had to replace three client documents before any of
them could be deleted; M7 is where that debt was collected. K4 died at M3 and K6
at M5, so this milestone closes K1, K2, K3, K7 and ships K5's alias.

## 2. What shipped

Three commits — one per row-group, in the order the dependency graph allowed —
plus this handover.

### K5 — `GET /api/reports/:slug` is a logged 308 alias

Shipped **first**, so no window existed in which the old URL returned nothing.
It answers `308` to the Brief Deck for the client's own north star, carrying
`format`, `date`, `days` and `lang` across unchanged. `curl -L` and every HTTP
client the portal uses keep working untouched.

- `NORTH_STAR_OBJECTIVE` in `@tempo/core`, **derived** from `OBJECTIVE_NORTH_STAR`
  by inversion. The brief route's 409 gate reads the forward table; a
  hand-maintained inverse is precisely how the alias would come to redirect a
  caller to a deck that route then refuses.
- `AuthResult` gains a `Caller`. A key in a log file is a key that has leaked, so
  a keyed caller is logged as a 12-hex-character digest — enough to tell two
  integrations apart and to match one against `REPORT_API_KEYS`, useless to a
  reader.
- `Deprecation: true` and `Link: …; rel="successor-version"` (RFC 8594), so a
  caller's own monitoring can flag the endpoint without anyone reading our logs.

### K1 + K3 — the narrative stack and the hourly report

Paired because they import each other: the fact sheet is typed on
`HourlyReportBase`, and `buildHourlyReport` calls `generateNarrative`. Splitting
them would have meant writing code whose only purpose was to be deleted next.

Gone: `narrative/**` (prompt, fact sheet, schema, verify, probe, the Anthropic
and OpenAI-compatible providers), `hourly-{model,render,insights,analysis}.ts`,
the settings router's three report-AI procedures, `check:local-llm`,
`try:narrative`, `verify-north-star`, and `@anthropic-ai/sdk`.

The intraday **dashboard** is untouched — it reads `@tempo/db` read-models and
never went through that renderer. What died is the intraday *document*.

Migration **0009** deletes the orphaned `app_settings` row. A row holding a model
endpoint for a feature that no longer exists is exactly the stale-configuration
trap R6 names.

### K2 + K7 — the Phase 1.5 report and the copy monolith

Paired for the same reason: `i18n.ts` types its copy pack with `Priority` from
`insights.ts`.

Two things went beyond the written rows, because the deletions left them with no
caller at all:

- **`layout.ts`** — the shared A4 page furniture. `deck/render.ts` carries its
  own escaping and its own 16:9 stylesheet and never read it. §3 below expected
  "layout.ts remnants"; there are none.
- **`multiLineChart`** — the intraday pacing chart. `comboChart` and `rankChart`
  stay: they are what the deck draws with.

`brief-objective.ts`, a one-line shim forwarding `@tempo/core`, is folded into
the barrel.

## 3. Exit criteria (PRD §9)

| Criterion | State |
| --- | --- |
| `packages/reports/src` is `deck/` + `charts.ts` + remnants | ✅ `deck/`, `charts.ts`, `index.ts`, `scripts/try-deck.ts`. One file tighter than written — `layout.ts` had no remnant to keep |
| `typecheck · lint · test · build` green | ✅ 8/8 · 8/8 · 6/6 (142 in `@tempo/reports`) · 3/3 |
| `.env.example` and `README.md` updated | ✅ the `REPORT_NARRATIVE_*` block is replaced by a pointer to where narration actually lives; the API section leads with the deck and documents the alias |
| K5 ships with access logging; removal is a separate change | ✅ alias + logging shipped; removal is §5 |

## 4. Entry contract for whoever is next

| Contract | Where | Guarantee |
| --- | --- | --- |
| `@tempo/reports` | barrel | Exports the Brief Deck and nothing else. `BriefObjective` & friends are forwarded from `@tempo/core` |
| `@tempo/reports/spec-editor` | subpath | Still the client-safe entry (M6). K2 removed `pg` from the barrel's graph, so the barrel would now resolve in a browser — the subpath stays because it states its own constraint |
| `NORTH_STAR_OBJECTIVE` | `@tempo/core` | Inverse of `OBJECTIVE_NORTH_STAR`; round-trip tested across every north star a client can hold |
| `authenticate()` | `apps/web/src/lib/api-auth.ts` | Returns a `Caller` on success. Log the fingerprint, never the key |
| `SETTINGS_KEYS` | `@tempo/db` | Empty. The store is generic and kept; this was its only key |

## 5. Deferred — and one thing that is owed

- **Removing the alias.** This is not "deferred", it is **scheduled**: one
  release from now, gated on the log showing no caller left to migrate. Read the
  `[reports] DEPRECATED GET` lines, confirm every `key:` fingerprint is an
  integration that has moved, then delete `apps/web/src/app/api/reports/[slug]/`
  and its README paragraph. If a fingerprint is one nobody recognises, that is
  the answer R6 wanted and the alias stays another release.
- **Rejected calls are not logged.** The log records callers that got a
  redirect, not ones that failed auth — a 401 caller is not a caller to migrate,
  and logging them invites scanner noise. If the question becomes "is someone
  trying and failing", that decision flips.
- **`app_settings` has no keys.** The table and its repository are kept because
  the store is generic. If nothing claims it within a release or two, it is a
  table and a repository to delete, not a facility to maintain.
- **No golden-diff harness ever existed.** §9's "the deck beats the old report
  on goldens" was met by the deck shipping the same content across M2–M5 and by
  looking at the rendered output at each one — not by an automated comparison
  against a renderer that is now deleted. A future format change has the deck's
  own tests, not a baseline from the old one.

## 6. Kill-list state

| Row | State | Evidence |
| --- | --- | --- |
| K1 fact-sheet narrative stack | ☠️ **Dead** | Directory removed; `@anthropic-ai/sdk` dropped; migration 0009 clears its stored config |
| K2 Phase 1.5 daily report | ☠️ **Dead** | `model/render/insights.ts` removed; no caller since M2 |
| K3 hourly report document | ☠️ **Dead** | `hourly-*.ts` removed; the intraday dashboard is untouched and still renders |
| K4 A4 engine-brief renderer | ☠️ Dead at M3 | — |
| K5 old report route | 🔁 **Aliased + logged** | 308 verified live; removal is §5, one release out |
| K6 `ReportAiSettings` | ☠️ Dead at M5 | — |
| K7 report copy monolith | ☠️ **Dead** | `i18n.ts` removed, and `layout.ts` with it |

The kill list is closed but for K5's removal. Nothing in this program is
outstanding.

## 7. Decisions taken here

- **The alias before the deletion, not with it.** Shipping K5 first means the
  old URL never returned a 404 or a 500 for even one commit. The kill list's
  own ordering rule ("nothing is deleted on faith") applies inside a milestone
  as much as across one.
- **A fingerprint, not a key, not a name.** The question R6 asks is "which
  callers", and the cheapest honest answer that cannot itself become an incident
  is a truncated digest. It is matchable against the configured keys by anyone
  who already holds them, and inert to anyone who does not.
- **Two rows per commit where the code demanded it.** K1/K3 and K2/K7 are
  mutually referential. The alternative — a commit that stubs out the reference
  so the next one can delete it — would have put a placeholder in the tree, and
  "stub is not a state this system keeps" is the first line of the kill list.
- **Deleting more than the list said.** `layout.ts` and `multiLineChart` were
  not rows; they were things the rows kept alive. Leaving them would have left
  the package's shape a lie about what it does.
- **Not deleting `app_settings`.** It is a generic facility that happened to
  hold one dead key, and dropping a table is a migration whose reverse costs
  data. Retiring the key and clearing the row says the same thing at a fraction
  of the risk.
