# P3 — Web, instant tier — HANDOVER

**Status:** ✅ Complete. · **Verified 2026-10-21** against the live Tempo DB and a second engine on :8002 running this branch:
- The real route handler (`GET /api/reports/:slug/strategy-report`) returned:
  - BARDI as HTML in 168 ms
  - a JSON brand-class preview with the brand section order
  - Purbasari as an A4 PDF (5 pages, 144 KB) in 1.2 s
  - 404 for `chocomory` (6 TTMS days) and for `nivea-auction` (no TTMS account)
- In the browser, `/clients/bardi-tiktok/strategy-report` renders the panel. Saving a rank-25 goal and a brand override persisted, the next engine run paced it ("#39 → target #25, proyeksi #31, 1,71× laju saat ini") and showed it in the T1 chip. **Reset** removed the row.
- reports 17 strategy tests and 173 deck + strategy tests pass. web typecheck and lint are clean.

## 1. Scope

PRD §12 P3: sidebar entry, page, panel (settings and generate), route (GET html/pdf/json), pipeline, renderer, and the `report_runs` objective. The panel's third card (accept / snooze, PRD §9.3) was built here as well, since its tRPC endpoints already existed from P1. P5 adds the measuring side.

## 2. What shipped

| Area | Files |
|---|---|
| Renderer (`packages/reports/src/strategy-report/`) | `model.ts` (`StrategyReportModel`, the only thing the renderer reads), `build.ts` (`buildStrategyReportModel`: class order, labels, `light()` grading against the benchmark), `charts.ts` (inline SVG funnel, spend scatter + fit + knee, inverted rank line + target + projection, content mix with paid/non-paid stacked and sub-types as separate bars with benchmark ticks), `render.ts` (A4 HTML), `format.ts` (id-ID numbers), `build.test.ts` |
| Contract | `deck/engine-content.ts`: `parseEngineContent` validates strategy content against `EngineStrategyContentSchema` (strategy and verdict draft shapes), so the deck's strict draft schema is untouched |
| Web | `app/api/reports/[slug]/strategy-report/route.ts`, `lib/strategy-report-pipeline.ts`, `lib/strategy-actions.ts`, `app/clients/[slug]/strategy-report/page.tsx`, `components/strategy-report/StrategyReportPanel.tsx`, `components/app-shell/Sidebar.tsx` (the "Strategy Report" entry after Template Report, `Compass` icon) |
| db | `resolveStrategyWindow` (the warm-cache key without calling the engine), `insertProposedActionsOnce` |
| Engine polish found in review | "tahap ini berkurang N orang" when outflow exceeds new; "naik/turun x%" in place of "tumbuh -x%"; T8 always shows the Lite lock rows outside the cap, with two warnings per generator |

## 3. The route

`GET /api/reports/:slug/strategy-report?format=html|pdf|json&tier=instant|full&days=28&date=&class=&fresh=1`
- **Auth** is same-origin or an API key, as on every report route.
- **Window:** `days` is clamped to 14–90. `date` is clamped by the engine to the settled TTMS day.
- **Cache:** a stored full-tier PDF for the exact window is served warm (`X-Report-Artifact: pregenerated`). A class preview is never cached or recorded.
- **Ledger:** every PDF generation is recorded in `report_runs` (objective `strategy`). Full-tier PDFs are stored under `TEMPO_ARTIFACT_DIR`.
- **Proposals:** every non-preview run records its Action List as `proposed` (once per run), per PRD Q3's default. Only an explicit accept starts the loop.
- **Errors:** an engine 404 passes through, a content contract failure is a 502, and an unreachable engine is a 502.

## 4. How to run / verify

```bash
pnpm --filter @tempo/reports exec vitest run src/strategy-report src/deck
pnpm --filter @tempo/web typecheck
# with an engine running this branch:
curl "http://127.0.0.1:3001/api/reports/bardi-tiktok/strategy-report?format=html" > bardi.html
```

**The running `pnpm stack` engine predates P2.** Until it is restarted, the dashboard's "Lihat HTML" / "Unduh PDF" get a 502 from it. Restart `pnpm stack` (or pm2's `tempo-engine`) to pick up the strategy brief type.

## 5. Deferred

- **`…/strategy-report/full` (async POST + poll)** needs a truly async engine `POST /v1/briefs` (PRD §13 #1), which is P4. Until then "Tier: Penuh" in the panel is a blocking GET with `maxDuration` 660 s.
- **The health card listing strategy runs** is P5.
- **Inferred class in the panel:** the class is computed per run by the engine and shown in the report and the JSON. The settings card shows "Otomatis" rather than a stale guess.
- **Grouping Template Report and Strategy Report under one "Reports" sub-nav** (PRD Q2): the PRD default is a flat sibling item, which is what shipped.

## 6. Decisions taken here

1. **Default `format` is `html`,** because the panel opens it in a tab, as Template Report does. PDF is explicit.
2. **The renderer never prints a classification score** (PRD Q5 default: AM only). The header shows the class badge and "ditetapkan oleh AM" when overridden.
3. **Empty states print once.** When a draft's headline is its own first sentence, only the sentence renders. T8 renders its signal rows instead of a restating paragraph.
4. **Funnel ratios above 1 are not drawn as funnel steps,** matching T01 (P0 §6.2).
