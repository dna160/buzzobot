# M6 — Spec editor (AM-facing) — HANDOVER

**Status:** ✅ Complete · **Verified:** driven in a real browser against a seeded database.
An AM opened `/clients/aurora-skincare/deck`, swapped the leading tile
(**"OMZET (GMV)" → "RASIO KLIK (CTR)"**), set a target of 2.5 on it, saved, and the change
survived a reload — no code, no SQL. Screenshots in the scratch run; the engine health
card was confirmed rendering its unreachable state at the same time.
`pnpm typecheck` 8/8, `pnpm lint` 8/8, `pnpm test` 6/6 (194 in `@tempo/reports`,
19 of them new).

## 1. Scope

PRD §3.3, §8, D3. M1 shipped `ReportSpec` as a validated contract; M6 gives account
managers a way to edit one. Brands still choose presets — direct brand self-service is
explicitly v1.1.

## 2. What shipped

### `@tempo/reports`

- `deck/spec-editor.ts` — the editor's operations as pure functions: `paletteFor`,
  `replaceMetric` (the Slot Swap), `addMetric`, `removeMetric`, `moveMetric`, `setTarget`,
  `previewSpec`. Every one refuses to produce a spec the schema would reject, so "can I
  save this?" has one answer no matter which surface asks.
- A **client-safe subpath export** `@tempo/reports/spec-editor`. The barrel re-exports the
  Phase 1.5 report model, which pulls in `@tempo/db` and therefore `pg` — a module graph
  no browser bundle can resolve (§7).
- `MIN_SPEC_METRICS` / `MAX_SPEC_METRICS` named in `spec.ts`, so the schema and the editor
  enforce the same two numbers rather than each carrying a literal.
- `spec-editor.test.ts` (19), including a property test that `previewSpec().valid` and
  `parseReportSpec` never disagree across a sequence of edits.

### `apps/web`

- `server/routers/report-spec.ts` — `get` / `save` / `reset`. `save` calls the same
  `parseReportSpec` the export path calls; an objective mismatch becomes a 422 carrying
  the offending metrics so the editor can point at them.
- `components/deck-spec/DeckSpecEditor.tsx` — objective switcher, live grid preview,
  palette grouped by category, drag **or** click slot swap, per-metric targets, appendix
  toggles, save/reset.
- `app/clients/[slug]/deck/page.tsx` + a sidebar entry.

## 3. Entry contract for M7

| Contract | Where | Guarantee | Held up by |
| --- | --- | --- | --- |
| `@tempo/reports/spec-editor` | subpath export | Imports only `@tempo/core` + zod — safe from a client component | web build (it failed loudly before) |
| `paletteFor(objective, spec?)` | `deck/spec-editor.ts` | Offers exactly what a save would accept and a tile could fill | `spec-editor.test.ts` |
| `replaceMetric` / `moveMetric` / … | `deck/spec-editor.ts` | Never produce an unsavable spec; a duplicate drop swaps rather than duplicating | `spec-editor.test.ts` |
| `previewSpec(spec, objective)` | `deck/spec-editor.ts` | Agrees with `parseReportSpec` on validity | property test |
| `reportSpec.get/save/reset` | tRPC | Validation delegated to `@tempo/reports`; 422 names the offending metrics | typecheck + live run |

M7 is the kill list. Nothing here blocks it; §6 notes what M6 changed about K1's footprint.

## 4. How to run / verify

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm db:migrate && pnpm db:seed          # a local PGlite tenant
pnpm dev                                  # /clients/<slug>/deck
```

Note for whoever runs this next: `PGLITE_DATA_DIR` resolves **relative to the workspace
root**, not the current directory. Pointing the dev server and the seed at what look like
the same path from different folders gives you two databases and a confusing
`relation "clients" does not exist`.

## 5. Deferred

- **A preview of the actual deck** next to the editor. The grid preview is the real
  solver, but seeing the rendered slide would need an engine run per keystroke; a
  "preview deck" button that calls the export is the natural next step.
- **Per-objective specs for a client whose north star forbids that objective.** The editor
  lets an AM prepare one and says plainly that the export will refuse it — deliberate,
  since north stars change, but it means a saved spec can sit unused.
- **Undo.** The draft is local until saved, so the escape hatch today is "reload"; a
  proper undo stack over the pure operations would be cheap.
- **Component tests.** The editor was driven end to end by hand in a browser; `apps/web`
  still has no test harness, so the pure layer under it carries the automated coverage.

## 6. Kill-list state

| Row | Made deletable? | Evidence / what is still missing |
| --- | --- | --- |
| K7 report copy monolith | Closer | The editor's labels come from `labelId` + `deck/copy.ts`; nothing new reads `i18n.ts` |
| K1 fact-sheet narrative stack | Unchanged since M5 | Its router procedures are still present and unused; they die with it at M7 |
| K2 / K3 / K5 | No | All M7 |

## 7. Decisions taken here

- **The editor decides nothing.** Palette, slot swap, preview and "would this save" are
  the same functions the export path uses. A rule restated in a client is a rule that
  eventually drifts, and the copy nobody is looking at is the one that goes wrong.
- **Slot Swap is a drag *or* a click.** Drag is what the PRD describes and what feels
  right with a mouse; select-then-pick does the same splice and works with a keyboard and
  on a trackpad. Both call `replaceMetric`.
- **Dropping a metric that is already on the spec swaps the two positions** rather than
  duplicating it. Two tiles showing the same number is never what the drop meant.
- **An edited spec becomes `preset: 'custom'`.** Keeping the preset name on a spec that no
  longer matches it would make the label a lie.
- **A client-safe subpath, not a barrel import.** The web build failed with
  `Can't resolve 'fs'` — the reports barrel reaches `pg` through the Phase 1.5 model. K2
  removes that at M7 and the barrel loosens, but a subpath that states its own constraint
  is better than one that happens to work.
- **Two UI defects found by looking at it**: the selected objective chip used `bg-primary`
  — a *text* colour token — and painted white on white; palette chips used a surface token
  with too little contrast against the card. Both now use the design system's
  accent/surface pairs, matching the sidebar.
