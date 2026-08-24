# M2 — Renderer: S0–S3, S6, Lampiran A · 16:9 pipeline · route — HANDOVER

**Status:** ✅ Complete · **Verified:** a real PDF was produced end-to-end from the
checked-in engine fixture through the actual pipeline (`renderDeckHtml` → headless
Chromium with `preferCSSPageSize`): **6 page objects for 6 slides, every MediaBox
960×540pt = 338.7×190.5mm, ratio 1.7778, 122 KB** — 16:9 confirmed, one slide per page,
far inside the 5 MB budget. Every slide was screenshotted and reviewed; three rendering
defects found that way are fixed (§7). `pnpm typecheck` 8/8, `pnpm lint` 8/8,
`pnpm test` 5/5 (147 tests in `@tempo/reports`), `uv run pytest` 184 passed / 21 skipped.

## 1. Scope

PRD §3.2 (`buildDeckModel`), §4 (S0–S3, S6, Lampiran A), §6 (fidelity), §7 (routes).
The milestone where the deck becomes a thing you can download. Finding cards, S4 and
the coverage lines are deliberately M3 — the `Block` union already carries them, and
this milestone renders engine prose in `prose` blocks instead.

## 2. What shipped

### `@tempo/reports/deck/`

- `build.ts` — `buildDeckModel()`: pure, no clock (`generatedAt` is an input), no
  randomness. Cover · S1 adaptive KPI grid + trend · S2 trend + prose · S3 rank chart +
  campaign table with per-row lights and actions · S6 roadmap · Lampiran A.
- `render.ts` — `renderDeckHtml()`: reads `DeckModel` and nothing else.
  `@page { size: 338.67mm 190.5mm }`, one slide per page, inline SVG only, brand colour
  through CSS vars, provenance footer on every slide.
- `copy.ts` — every deck string, plus the objective label overrides (`conversions`
  reads "Pesanan" on a GMV deck and "Instal" on an install deck).
- `metric-values.ts` — the one place a `MetricKey` is resolved against `Totals`, total
  by construction: a metric this rollup cannot fill returns `null`, printed as "—".
- `fixtures/dashboard.ts` — a deterministic day-grain rollup fixture, ratios derived the
  way `daily-brief.ts` derives them.
- `scripts/try-deck.ts` (`pnpm --filter @tempo/reports try:deck deck.html gmv`) — renders
  the checked-in fixture to HTML with no database, engine, or browser.
- Tests: `build.test.ts` (20) against **real engine output**, `render.test.ts` (9)
  structural — geometry, one section per slide, self-containment, escaping, stability.

### `apps/web`

- `lib/report-pdf.ts` — `htmlToPdf(html, mode)`. `deck` mode uses `preferCSSPageSize`,
  so the document's own `@page` is authoritative and the geometry is stated once.
- `api/reports/[slug]/brief/[objective]/route.ts` — rewritten onto the deck path:
  `?tier=` (default `instant`, D1), `format=json` returns the `DeckModel` for portal-side
  UI, `X-Engine-Run-Id` on every response, spec resolution via `getReportSpec`, and a 502
  when engine content fails its own contract instead of a deck with blank cards.

### `tempo-engine`

- `copy/templates.py` — instant-tier mechanism sentences lead with numeric evidence and
  humanize keys; internal switches (`rule`, `cohort_level`, …) stay out of client prose.
  `instant_s1_draft` de-duplicates headlines before joining them.

### Docs

- `README.md` gains a Brief Deck section (route, tiers, spec, preview command);
  `.env.example` corrects the stale "sibling repo" note (PRD §11 R6's specific trap).

## 3. Entry contract for M3

| Contract | Where | Guarantee | Held up by |
| --- | --- | --- | --- |
| `buildDeckModel(input)` | `deck/build.ts` | Pure; same input → identical model | `build.test.ts` |
| `renderDeckHtml(model)` | `deck/render.ts` | Reads only `DeckModel`; escapes everything | `render.test.ts` |
| `htmlToPdf(html, 'deck')` | `apps/web/lib/report-pdf.ts` | 16:9, one slide per page | measured MediaBox |
| `Block` union | `deck/model.ts` | `findingCard` / `videoGrid` render as nothing until filled | `render.ts` switch |
| `?tier=`, `?format=json`, `X-Engine-Run-Id` | brief route | Stable for portal callers | typecheck; no route test yet |
| `deck/fixtures/*` | `@tempo/reports` | Regenerable engine output + deterministic dashboard | `dump_deck_fixture.py` |

M3 adds card blocks inside the existing slides — `buildDeckModel` already receives the
findings and rankings it needs, so no signature changes.

## 4. How to run / verify

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @tempo/reports try:deck deck.html gmv   # open in a browser
# against a live stack:
curl -H "X-API-Key: $KEY" "http://localhost:3000/api/reports/sovella/brief/gmv" -o deck.pdf
curl -H "X-API-Key: $KEY" "http://localhost:3000/api/reports/sovella/brief/gmv?format=json" | jq .deck.meta
```

## 5. Deferred

- **A live end-to-end download.** The PDF above was produced from the checked-in fixture
  through the real renderer and the real Chromium settings; what has *not* run here is
  the full route against a live Postgres and a running engine. That is PRD §9's "buzzobot
  downloads a real GMV deck" and needs the stack up.
- **Image-diff goldens.** Structural goldens ship; pixel diffing needs a pinned browser
  build in CI (PRD §11 R3) and belongs with the nightly job in M5.
- **Self-hosted font.** The deck asks for Inter and falls back to Helvetica/Arial. PRD §6
  wants an embedded `@font-face` — a real fidelity gap, cheap to close once a licensed
  file is in the repo, and it must be embedded rather than fetched.
- **IDR formatting below 10k.** `formatCurrencyCompact` falls back to full en-US
  formatting under 10,000, so a CPM prints as `Rp 5,208.33` in an otherwise compact,
  Indonesian deck. Fixing it means touching `@tempo/core`'s shared formatters, which the
  dashboard also uses — a deliberate deck-scope decision, not an oversight.
- **Route-level tests.** `apps/web` has no test harness today; the route is covered by
  typecheck plus the unit tests behind it.

## 6. Kill-list state

| Row | Made deletable? | Evidence / what is still missing |
| --- | --- | --- |
| K4 A4 engine-brief renderer | Nearly | The route no longer calls it; `renderEngineBriefHtml` is now unused by any caller. It dies at M3 with the finding cards that replace its callouts. |
| K2/K3 daily & hourly reports | No | Still the only thing `/api/reports/:slug` serves; needs the golden comparison at M7 |
| K5 old report route | No | Alias + access logging is M7 |

## 7. Decisions taken here

Three defects were found by rendering the deck and *looking at it*, which no unit test
in this milestone would have caught:

- **Charts overflowed the slide.** The SVG rendered at its intrinsic height, pushing the
  x-axis under the provenance footer. Fixed by making the chart block flexible and
  letting the SVG scale inside whatever space is left — a slide is a fixed page, so the
  body has to fit inside it rather than assume it can grow.
- **Axis ticks printed raw numbers** (`21000000` on a rupiah axis). The model carried
  pre-formatted labels for series *values*, but axis ticks are computed by the chart
  generator and are not series members, so they fell through to `String(v)`.
  `ChartSeries` now carries its `metric`, and the renderer formats any value from the
  catalog definition. Formatting is rendering, so it belongs on this side of the
  boundary — and a pptx renderer would need exactly the same thing.
- **S1 repeated itself.** One finding can be top-ranked for several sections
  (`section_affinity` is a list), so the engine's summary said the same sentence three
  times. De-duplicated in the engine's S1 writer, and the deck no longer prints the
  headline twice when the summary already opens with it.

Two product decisions:

- **P0 is capped at three rows.** At the instant tier the engine derives severity from
  magnitude, so `f(severity, magnitude)` collapses and every risk landed at P0 — a
  roadmap where five of five lines are urgent prioritizes nothing. Overflow is demoted to
  P1 by magnitude; nothing is dropped and no claim changes, only the ordering label.
- **`format=json` returns `{run_id, status, tier, deck}`, not raw engine content.** The
  portal renders the same model the PDF renders, so the two surfaces cannot drift — and
  the engine's internal shape stays free to change behind the contract.
