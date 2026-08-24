# PRD — Tempo Brief Deck v1

**Owner:** Johnson Leonardi
**Relationship to the system:** `dna160/buzzobot` (Tempo Insight Engine, TypeScript) is the surface — ingestion, storage, read-models, delivery. `tempo-engine` (Python) is the analysis — generators, probe loop, narration, gates. This document specifies the **one client artifact both exist to produce**: the objective brief, rendered as a deck.
**Supersedes:** Phase 1.5 daily PDF report · the fact-sheet narrative stack (`packages/reports/src/narrative/**`) · the A4 engine-brief renderer (`packages/reports/src/engine-brief/render.ts`) · the "Adaptive Grid" plan (Plan_Template) as a separate deliverable — its grammar is absorbed here.
**Date:** 24 Aug 2026

---

## 0. Positioning — one artifact, not two

Today the system can produce three different client documents: the Phase 1.5 daily report (deterministic + fact-sheet LLM), the hourly report (same pipeline, intraday), and the engine brief (tempo-engine, rendered A4 portrait as callouts around dashboard furniture). Meanwhile the team's Plan_Template describes a fourth: an adaptive-grid, traffic-light, human-language deck.

**v1 collapses all of this into one product: the Brief Deck.**

> Generating a brief (`awareness` | `gmv` | `install`) produces a **landscape 16:9, deck-grade document** in the Plan_Template visual grammar — adaptive KPI grid, traffic lights, Bahasa-only labels, clickable video slide, raw-data appendix — where every analytical claim on every slide is a rendered **Finding** from tempo-engine.

Plan_Template supplies the *frame* (what a slide looks like, how metrics adapt to the client, how status is communicated). The engine supplies the *content* (what is true, what matters, what to do). Neither is optional; neither is decoration.

### 0.1 Format decision: landscape PDF first, PPTX later

| | Landscape PDF (Chromium) | Native PPTX (pptxgenjs) |
|---|---|---|
| Fidelity | Pixel-exact: full CSS, inline SVG charts, brand theming, web fonts | Constrained: no gradients, chart styling limited, layout in inches |
| Pipeline | **Already exists** — `apps/web/src/lib/report-pdf.ts` (`htmlToPdf`, playwright-core); only the page geometry changes | New renderer, new QA surface, new failure modes |
| Links | `<a>` survives Chromium print → clickable video thumbnails work | Supported |
| Client editability | None | Full |
| Risk | Low | Medium (OOXML corruption classes, chart XML quirks) |

**Decision: landscape PDF is the v1 output.** The user-facing promise ("high fidelity") is better served by the pipeline we already trust. Editability is the only thing PPTX buys, and it is not the v1 requirement. The door stays open structurally: the renderer consumes a typed `DeckModel` (§3.2), so a pptxgenjs renderer over the same model is an additive milestone, not a redesign.

Hard rule: **no renderer reads engine JSON or read-model rows directly.** Everything renders from `DeckModel`. This is what makes the output format swappable and the goldens meaningful.

---

## 1. Kill list

"Stub" is not a state this system keeps. Each row is deleted in its own PR, only after the exit criterion in §9 that replaces it has passed. Nothing is deleted on faith.

| # | Component | Path | Replaced by | Dies at |
|---|---|---|---|---|
| K1 | Fact-sheet narrative stack — prompt, fact sheet, providers, verify, probe, settings schema | `packages/reports/src/narrative/**` | tempo-engine is the **only** narration source (its own gates + deterministic fallback already exist) | M7 |
| K2 | Phase 1.5 daily report | `packages/reports/src/{model,render,insights}.ts` | Brief Deck | M7 |
| K3 | Hourly report as a client deliverable | `packages/reports/src/{hourly-model,hourly-render,hourly-insights,hourly-analysis}.ts` (report-side only — the dashboard reads `@tempo/db` read-models and is untouched) | Brief Deck; intraday detail becomes Appendix A when the window is intraday | M7 |
| K4 | A4 engine-brief renderer | `packages/reports/src/engine-brief/render.ts` | `packages/reports/src/deck/**` | M3 |
| K5 | Old report route behavior | `GET /api/reports/:slug` | 308-alias to `/api/reports/:slug/brief/:northStarObjective` for one release (with access logging to find unknown callers), then removed | M7 + 1 release |
| K6 | LM Studio probe settings UI (`ReportAiSettings`) | `apps/web/src/components/settings/ReportAiSettings.tsx` | Engine health card (reads new `GET /healthz` on tempo-engine + last run stats from `insight.*`) | M5 |
| K7 | Report copy monolith | `packages/reports/src/i18n.ts` | Catalog `labelId` (§3.4) + a small `deck/copy.ts`; strings still needed are migrated, the rest die with K2–K4 | M7 |

What explicitly does **not** die: the engine's review gate (`interrupt()`), the numeral/schema/metric gates, the deterministic fallback doctrine ("the brief always renders"), `/ui/briefs/{run_id}`, and the dashboard.

---

## 2. System shape

```
buzzobot portal (portal.buzzohero.co.id)
      │  X-API-Key (existing api-auth.ts, unchanged)
      ▼
GET /api/reports/:slug/brief/:objective?tier=&format=          apps/web
      │
      ├── POST tempo-engine /v1/briefs (async, default)  ──►  LangGraph run
      │        or /v1/briefs/sync (tier=instant, CLI)          steward → generators
      │                                                        → [probe loop] → materiality
      │   content_version: 2  ◄── §3.1                         → [narrate → critic → gate
      │   findings · rankings · coverage · probe_log              → synthesist] → review
      │   + s1 · sections · s6
      │
      ├── @tempo/db read-models (parallel):
      │     getDailyBriefDashboard(db, client, {endDate, windowDays})
      │     listWindowVideos(db, client, range)        ◄── new, §4 S5
      │     getReportSpec(db, client)                  ◄── new, §3.3
      │
      ▼
buildDeckModel(engineContent, dashboard, videos, spec, objective)   pure, tested
      ▼
renderDeckHtml(model)  →  htmlToPdf (16:9 landscape @page)  →  PDF
                        └─ format=html (preview) · format=json (DeckModel, portal-side UI)
```

Two changes of ownership, stated plainly:

1. **The engine API exports state, the renderer chooses what to show.** Today `_content_from_state()` (`tempo-engine/src/engine/api/dispatcher.py`) exports four keys and discards the findings, the rankings, the below-the-cut list, and the G08 coverage audit — the exact material a deck is made of. That projection moves out of the server boundary and into `buildDeckModel`.
2. **Narration moves entirely to the engine.** apps/web no longer holds a prompt, a provider, or a verifier. K1 is the enforcement.

---

## 3. Contracts

Contracts first; show them before building (house rule).

### 3.1 `EngineBriefContent` v2 — widen the boundary (additive)

`_content_from_state()` gains, alongside the existing `s1 / sections / s6 / probe_loop`:

```python
{
  "content_version": 2,
  "findings":  [Finding.model_dump()],          # ALL findings, generator + probe origin
  "rankings":  {                                 # per section: selected ids + below-the-cut
      "2": {"selected": [...], "below_cut": [{"id":..., "materiality":...}, ...]},
      ...
  },
  "coverage":  G08CoverageAudit.model_dump(),    # null rates, entity coverage, recency lag
  "probe_log": [...],                            # already in state; now exported
}
```

The Finding contract itself (PRD_tempo_intelligence_engine §6.1) is unchanged — `evidence`, `level`, `magnitude_pct`, `materiality`, `confidence`, `caveats`, `claim_frame`, `direction`, `actionability`, `provenance`, `origin` are precisely the fields the deck renders. A mirrored TypeScript type lands in `@tempo/reports/deck/engine-content.ts` with a drift check against the Pydantic schema (same mechanism as the existing METRICS catalog port test).

### 3.2 `DeckModel` — the renderer-agnostic slide model

```ts
interface DeckModel {
  meta: { client: ClientSummary; objective: BriefObjective; period: string;
          tier: 'instant' | 'full'; runId: string; engineVersion: string;
          generatedAt: string; fallbacks: SectionFallback[] };
  slides: Slide[];
}
type Slide = { id: string; title: string; blocks: Block[] };
type Block =
  | { kind: 'kpiGrid';  tiles: KpiTile[]; layout: '1x3' | '2x2' | '2x3' }
  | { kind: 'chart';    spec: ChartSpec }                    // rendered by charts.ts → SVG
  | { kind: 'table';    spec: TableSpec }                    // rows may carry lights + actions
  | { kind: 'findingCard'; card: FindingCard }
  | { kind: 'videoGrid'; videos: VideoCell[] }               // thumbnail + href + metrics
  | { kind: 'roadmap';  rows: RoadmapRow[] }
  | { kind: 'prose';    text: string };                      // S1 headline, outlook
interface KpiTile { metric: MetricKey; label: string; value: string;
                    delta?: string; light: 'green' | 'yellow' | 'red' | 'none'; }
interface FindingCard { findingId: string; light: Light; headline: string;
                        evidenceChips: {label: string; value: string}[];
                        mechanism: string; action?: string;
                        footer: { level: string; confidence: string; source: string }; } // "G01" | "Probe r2"
interface RoadmapRow { priority: 'P0'|'P1'|'P2'; action: string; owner: string;
                       impact: string;            // from finding.magnitude_pct: "34% dari belanja"
                       evidenceRef: string; }
```

`buildDeckModel` is a pure function with unit tests. It is the *only* place engine content, read-model rows, and the spec meet.

### 3.3 `ReportSpec` — the adaptive-grid configuration

```ts
const ReportSpecSchema = z.object({
  version: z.literal(1),
  preset: z.enum(['views', 'jualan', 'install', 'custom']),
  metrics: z.array(MetricKeySchema).min(3).max(20),   // ordered = priority; first 3–6 tile
  appendix: z.object({ rawTable: z.boolean().default(true),
                       allVideos: z.boolean().default(true),
                       internal: z.boolean().default(false) }),   // §4 Appendix C
  targets: z.record(MetricKeySchema, z.number()).optional(),
});
```

Stored in a new `report_specs` table keyed by client; absent → the objective preset. **Validation is objective-constrained:** each objective declares an allowed metric set mirroring the engine's `ObjectiveContract` axes — an `awareness` spec containing `roas` or `conversionValue` is a 422, which is how "brand awareness tidak melihat GMV sama sekali" becomes a guarantee instead of a habit. Slot Swap from Plan_Template is an array splice on `metrics` in the editor (M6); the layout solver re-derives the grid — it is not a layout feature.

### 3.4 Metric catalog extension (`@tempo/core`)

`MetricDef` gains:

```ts
labelId: string;          // Bahasa display label — "Total Biaya Iklan", "Tontonan 15 Detik"
category: MetricCategory; // picker grouping: biaya | hasil | efisiensi | video | jangkauan
bands?: Partial<Record<BriefObjective, { green: number; yellow: number }>>;
pickerVisible: boolean;
```

Two hard rules, both CI-enforced: **every `pickerVisible` metric has a non-empty `labelId`** (the label-coverage test), and **no renderer ever prints a `MetricKey`** — `labelId` is the only string that reaches a slide. This is Plan_Template §6 ("Wajib Bahasa Manusia") made structural instead of aspirational. The current 19-key catalog is the seed; the "500+ metrics" ambition is served by the catalog being data-driven (key → source column/derivation → def), added on demand — not by pre-building 500 tiles.

### 3.5 Lights — one grading substrate for the whole system

```ts
light(value, def: MetricDef, objective, target?, delta?) → 'green' | 'yellow' | 'red' | 'none'
```

Pure, direction-aware, property-tested. Resolution order: per-client `targets` override → objective `bands` → delta-only heuristic → `none` (never guess). Semantics per Plan_Template: green = tambah anggaran, yellow = pertahankan, red = evaluasi — but **placement is granularity-aware**: account-level tiles get color only; campaign/video table rows get color + action, because there the red row *is* the culprit. When the engine ran, G04 (zero-yield) and G05 (marginal return) findings upgrade generic row actions to named ones — "Matikan: [campaign], 0 pesanan pada belanja Rp N" — sourced from `evidence`, so the numeral gate already covers them. This same function is the future substrate for dashboard deltas and any scoreboard grading: one definition of "good," not three drifting ones.

---

## 4. The deck — slide specification

Common frame for all three objectives; S4 and the tile presets are objective-specific. Every slide pairs **data blocks** (tiles / chart / table — deterministic, from read-models) with **finding cards** (the engine's reading, routed by `section_affinity`). The card grammar is verdict-first: light chip → specific headline → evidence chips → mechanism → action. Numbers live in chips, prose carries mechanism — which is both how the reference audit format earns trust and what the numeral gate wants.

| Slide | Content | Data blocks | Engine blocks |
|---|---|---|---|
| **S0 Sampul** | Brand-colored cover: client, objective label, period, tier badge | — | — |
| **S1 Ringkasan** | **Adaptive KPI grid** — first 3–6 spec metrics as tiles with lights + delta chips (solver: 3→1×3, 4→2×2, 5–6→2×3; 5 auto-fills the 6th from the preset, marked *disarankan*; >6 overflows to Appendix A) | `kpiGrid`, trend `chart` | S1 headline (`prose`, one sentence — the synthesist writes it last, after S6) + the single top-materiality finding as a full card |
| **S2 Tren** | Daily (or hourly) series | `chart`, `table` | S2 finding cards (≤3) |
| **S3 Kinerja Kampanye** | Spend/outcome rank chart; campaign table with **per-row lights + actions** | `chart`, `table` | S3 cards; G04/G05 findings name culprits in row actions |
| **S4 — per objective** | `awareness`: frekuensi & jangkauan efektif (A01–A04 — the one place reach non-additivity is the signal) · `gmv`: funnel & mix (M01–M04: sesi live, AOV/mix, tangga kreator, SKU) · `install`: kebocoran funnel & kualitas kohort (N01–N04) | objective `chart`/`table` | S4 cards |
| **S5 Video Terbaik** | Top-N `videoGrid`: cached thumbnail, **clickable `shareUrl`**, per-video metrics + light | `videoGrid` | S5 cards (creative findings) |
| **S6 Risiko & Rencana Aksi** | **Roadmap table** — engine s6 risks ∪ section actions, deduped; `P0/P1/P2 = f(severity, magnitude_pct)`; columns Aksi · Pemilik · Dampak (share of spend/outcome from the parent finding) · Bukti (finding id) | `roadmap` | outlook (`prose`), confidence badge |
| **Lampiran A — Data Mentah** | Full window table: all spec metrics + standard set, per day (per hour for intraday windows). Plan_Template's promise: halaman depan bersih, halaman belakang lengkap | `table` | — |
| **Lampiran B — Semua Video** | Every KOL/video in window: akun, link, tontonan, engagement (omzet per video **gated** — §11 R7) | `table` | — |
| **Lampiran C — Internal** (`appendix.internal`, default **off** for client exports) | Probe trace (question → instrument → yield), below-the-cut rankings, G08 coverage audit | — | full transparency layer; this is also the preset-tuning signal loop |

Coverage gaps render as counted denominators, not silence: a section whose generators skipped for missing metrics shows *"4 dari 6 sinyal tersedia"* sourced from G08 — thinness reads as honesty. A section with no findings above the cut renders its data blocks and the line *"Tidak ada temuan material periode ini"* — never an empty card, never a hallucinated one.

---

## 5. Generation tiers — reconciling "hitungan detik" with a real agentic run

The engine's full graph costs minutes by design (~24 model calls on the 12B budget). Plan_Template promises seconds. Both are kept by making the LLM pass a *tier*, not a prerequisite — the existing fallback doctrine, promoted to a feature:

| Tier | Path | Copy source | Target p95 | Use |
|---|---|---|---|---|
| **instant** | steward → generators → materiality. **Zero model calls.** | Deterministic templates per `claim_frame` (closed enum → template table; the B4 fallback writer, reused per section) | ≤ 10 s | Portal default response; CLI; anything interactive |
| **full** | + probe loop → narrators → critic → numeral gate → synthesist → review | Agents | ≤ 6 min | Scheduled weekly runs; "Analisis Lengkap" button |

Engine: `tier` on `POST /v1/briefs` and `/sync`; instant runs skip the agent nodes in `graphs/brief.py` and stamp `tier` into content. Surface: the portal button returns the **instant deck immediately** and kicks off a full run; when it lands (poll or webhook), the portal swaps the download and notifies. A weekly cron (`report_runs` table: client × objective × period → run_id, status, artifact) pre-generates full decks so the *routine* download is instant **and** fully narrated. Both tiers render the identical `DeckModel` shape — a full-tier deck differs only in richer card prose and probe-sourced findings, never in layout. The footer states the tier; no deck pretends to be the other.

---

## 6. Fidelity requirements

- **Geometry:** `@page { size: 338.67mm 190.5mm; }` (16:9), landscape, `printBackground: true`, zero-margin bleed on the cover. One slide = one page, `break-after: page`; blocks may never straddle a page.
- **Theming:** brand color from `ClientSummary.brandColor` drives cover, chips, chart accents via CSS vars — same mechanism `layout.ts` uses today.
- **Charts:** inline SVG only (`charts.ts`, extended with the rank/funnel variants S3–S4 need). No client-side JS, no canvas — vectors print crisp at any DPI.
- **Video slide:** `<a href={shareUrl}>` survives Chromium print as a real link annotation — thumbnails are clickable inside the PDF. **Thumbnail bytes are cached at ingestion** (new `videos.thumbnail_cached_path`; TikTok CDN URLs expire, and N fetches at render time murders the instant tier). Missing cache → branded placeholder, never a broken image.
- **Type:** self-hosted font (embed via `@font-face`, no network at render), 3-step scale, table numerals `font-variant-numeric: tabular-nums`.
- **Language:** `labelId` everywhere (§3.4); engine narrates in Bahasa already (engine PRD §7); `deck/copy.ts` is id-first.
- **Provenance footer on every deck:** run_id, engine version, tier, probe count/yield, per-section fallback reasons; `X-Engine-Run-Id` response header. A thin deck must be traceable to `/ui/briefs/{run_id}` in one step.
- **Budget:** ≤ 5 MB typical; goldens fail the build past 8 MB.

---

## 7. Routes

```
GET /api/reports/:slug/brief/:objective        canonical
    ?tier=instant|full     default instant (portal), full for cron
    ?format=pdf|html|json  pdf default; json returns DeckModel for portal-side UI
    ?date=&days=           unchanged semantics
GET /api/reports/:slug                          K5: 308 → northStar objective, logged, then removed
GET tempo-engine /healthz                       new; feeds the K6 settings card
```

Auth unchanged (`lib/api-auth.ts`): same-origin passes, external callers present `X-API-Key`, fail-closed on unset keys.

---

## 8. Non-goals v1

PPTX export (door held open by `DeckModel`; costed, not committed) · client-facing drag-and-drop **builder is M6, AM-facing** — brands get presets + AM-tuned specs in v1, direct brand self-service is v1.1 · revenue-per-video (R7 gate) · dashboard changes · benchmark/cohort content (engine B14 territory).

---

## 9. Milestones

| M | Contents | Exit criteria |
|---|---|---|
| **M0** | Engine: content v2 (`_content_from_state` widened), `tier` param, `claim_frame` template table for instant copy, `/healthz`. TS mirror types + drift check. | `format=json` on a real client returns findings/rankings/coverage; drift test red when Pydantic changes; instant run completes with zero LM Studio calls |
| **M1** | Contracts in TS: `DeckModel`, `ReportSpec` + `report_specs` migration + presets, catalog extension (`labelId` for all 19 keys + intraday keys, `category`, `bands`), lights fn. | Label-coverage CI green; solver + lights property tests green; awareness spec containing `roas` → 422 |
| **M2** | `deck/` renderer: S0–S3 + S6 + Lampiran A, 16:9 pipeline, provenance footer. Golden decks (3 objectives × 2 tiers) — structural (`pdftotext -layout`) + image-diff with tolerance. | buzzobot downloads a real GMV deck; 3/4/6/9-metric specs produce correct grids and overflow; goldens pinned |
| **M3** | Finding cards wired everywhere; S4 per objective; counted-denominator coverage lines. **K4 dies.** | Every card's chips resolve to `evidence` values; a section with zero findings renders the honest empty state |
| **M4** | S5 + Lampiran B; thumbnail caching in the ingestion pipeline; link integrity check. | Thumbnails click through to TikTok from inside the PDF; export adds < 300 ms over M3 |
| **M5** | Tiers end-to-end: portal instant-then-full flow, `report_runs` + weekly cron, engine health card (**K6 dies**). | Portal button: instant deck < 10 s p95; full deck replaces it unattended; Monday-morning download is pre-generated |
| **M6** | Spec editor in apps/web (palette by `category`, grid canvas, drop-to-replace = splice, preset buttons, targets), portal-linked. | An AM builds, saves, and exports a custom spec without code; slot-swap re-renders correctly |
| **M7** | **K1, K2, K3, K7 die.** K5 alias ships with logging; removed one release later after zero unknown callers. | `packages/reports/src` contains `deck/`, `charts.ts`, `layout.ts` remnants only; CI green; docs updated |

Order is deliberate: the deck must beat the old renderers on goldens **before** anything is deleted, and the alias window exists because "kill" without caller telemetry is how portals break silently.

---

## 10. Eval & QA additions

The engine harness (numeral fidelity, level/ratio integrity, finding coverage, determinism, probe yield, generic-sentence detector, schema conformance, catalog drift) stands. The deck adds: **(1)** label coverage 100%, hard fail · **(2)** solver determinism — same spec, same grid · **(3)** lights property tests across direction × bands × targets · **(4)** golden decks per objective × tier, structural + visual diff · **(5)** link integrity — every `videoGrid` href equals the row's `shareUrl` · **(6)** latency budgets (instant ≤ 10 s, full ≤ 6 min) in nightly CI · **(7)** the generic-sentence detector runs on deck card text too — the container changed; the bar for prose did not · **(8)** `DeckModel` render purity: `buildDeckModel` snapshot-tested against fixture engine content, so renderer bugs and analysis bugs never blur.

---

## 11. Honest failure risks

1. **R1 — Latency expectation collision.** The team plan promised seconds; the engine costs minutes. *Mitigation is §5 itself* — but only if the portal UI names the tier honestly. If instant decks get mistaken for the full product, the engine's value is invisible again. Tier badge on cover + footer is non-negotiable.
2. **R2 — PDF non-editability pushback.** Some brand will ask to edit the deck. *Mitigation:* `DeckModel` keeps the pptx renderer a bounded milestone; do not hand-promise it before it is costed against the OOXML failure classes.
3. **R3 — Chromium fidelity drift** across dev/CI/prod. *Mitigation:* pin playwright-core + browser build; image-diff goldens with tolerance; fonts embedded, never fetched.
4. **R4 — Instant-tier template copy reads robotic.** Closed-enum templates are safe but flat. *Mitigation:* 2–3 phrasing variants per `claim_frame`, chosen deterministically by finding id hash; evidence chips carry the specificity so templates only carry mechanism.
5. **R5 — 12B S1 on a deck cover.** Known weakest output (engine PRD §11.2). *Mitigation:* S1 is one sentence over tiles that already tell the story; synthesist keeps the richest few-shot; hardest human review.
6. **R6 — Kill list breaks an unknown caller.** `.env.example` documents the portal against the *old* route. *Mitigation:* K5's logged alias window; deletion blocked on zero unknown callers for a full release.
7. **R7 — "Omzet per video" assumes the Shop surface.** Its DTO is explicitly undocumented (engine PRD §3.3). *Gate:* the column ships only after the Shop contract lands; until then Lampiran B shows organic metrics and says so.
8. **R8 — Two grading vocabularies drift** (deck lights vs any future brief grades vs dashboard deltas). *Mitigation:* §3.5 is the single substrate; adding a second threshold source anywhere is a review-blocking offense.

Standing framing carried over from the engine PRD: this raises the floor and the fidelity of what the system already computes. It does not raise the analytical ceiling — if the generators find four material things, the deck shows four excellent cards. Lampiran C's below-the-cut view is how we find out which problem we actually have.

---

## 12. Decisions to close before M0

| # | Question | Default if unanswered |
|---|---|---|
| D1 | Portal button tier | `instant`, full runs async + weekly cron |
| D2 | 5-metric grid rule | Auto-fill 6th from preset, badged *disarankan* |
| D3 | Who edits specs in v1 | AMs only; brands choose presets |
| D4 | Lampiran C default for client exports | Off (internal flag) |
| D5 | K5 sunset | One release after M7, gated on zero unknown callers |
| D6 | PPTX commitment | Not committed; revisit after first month of client feedback |
