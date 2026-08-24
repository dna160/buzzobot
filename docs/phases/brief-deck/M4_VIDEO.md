# M4 — S5 video slide · Lampiran B · thumbnail caching — HANDOVER

**Status:** ✅ Complete · **Verified:** the generated PDF carries **three real `/URI` link
annotations**, one per video cell, pointing at the rows' own `shareUrl` — the links work
from inside the PDF, not just in a browser. 9 pages for 9 slides, every MediaBox
960×540pt, 177 KB. `pnpm typecheck` 8/8, `pnpm lint` 8/8, `pnpm test` 5/5 (175 tests in
`@tempo/reports`, 17 in `@tempo/db`).

## 1. Scope

PRD §4 (S5, Lampiran B), §6 (video-slide fidelity), §11 R7. The one slide that needs
bytes rather than numbers: cached thumbnails, clickable permalinks that survive Chromium
print, and the full KOL/video appendix.

## 2. What shipped

### `@tempo/db`

- `ingest/thumbnails.ts` — `cacheThumbnail()` fetches once at ingest and writes under
  `TEMPO_MEDIA_DIR`; `readThumbnailDataUri()` reads it back for embedding. Never throws:
  every failure path returns an outcome, because a slow image host must not fail a
  client's metrics ingest.
- `videos.thumbnail_cached_path` + migration `0006_fixed_albert_cleary.sql`.
- `repositories/writes.ts` — `upsertVideos` caches on the way in, and only writes the
  column when this run actually produced a path, so a failed fetch cannot erase a path
  cached earlier.
- `repositories/window-videos.ts` — `listWindowVideos()`: organic activity per video for
  the window, rates derived from summed totals, thumbnails read from disk only for the
  rows that will show one.
- Tests: `thumbnails.test.ts` (10) — cache hit/miss, every failure mode, per-video keying,
  data-URI round-trip.

### `@tempo/reports/deck/`

- `build.ts` — `buildVideoGrid()` (top three by views) and `buildVideoTable()` (Lampiran
  B, every video). The S5 slide and the appendix are both **omitted entirely** when a
  client has no organic videos.
- `render.ts` — the `videoGrid` block: the whole cell is an `<a>`, thumbnails embed as
  `data:` URIs, a missing cache draws a branded placeholder.
- `copy.ts` — video table headers, the placeholder label, and the R7 disclosure.
- `fixtures/videos.ts` — includes one video with no cached thumbnail and one with no
  permalink, because both are states the real pipeline produces.
- Tests: `videos.test.ts` (11) — link integrity, no render-time fetch, placeholder,
  ranking, R7.

### `apps/web`

- The brief route loads window videos alongside the engine call and passes them to
  `buildDeckModel`; a failed read logs and yields no video slide rather than no deck.

## 3. Entry contract for M5

| Contract | Where | Guarantee | Held up by |
| --- | --- | --- | --- |
| `listWindowVideos(db, client, {startDate,endDate})` | `@tempo/db` | Rates from summed totals; thumbnails only for the top rows | typecheck; no live-DB test yet |
| `cacheThumbnail(externalId, url)` | `@tempo/db` | Never throws; a miss is a placeholder | `thumbnails.test.ts` |
| `readThumbnailDataUri(path)` | `@tempo/db` | Returns null on any problem | `thumbnails.test.ts` |
| `BuildDeckInput.videos` | `deck/build.ts` | Optional — absent means no S5, not an empty S5 | `videos.test.ts` |
| Deck self-containment | `deck/render.ts` | Every `<img src>` is a data URI; URLs appear only as `href` | `render.test.ts`, `videos.test.ts` |

M5 needs none of this to change. It wires the tier flow end to end — `report_runs`, the
weekly cron, the portal's instant-then-full swap, and the engine health card that
replaces `ReportAiSettings` (K6).

## 4. How to run / verify

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @tempo/reports try:deck deck.html gmv    # renders with the video fixture
pnpm db:migrate                                        # applies 0006
```

`TEMPO_MEDIA_DIR` sets where thumbnails are cached (default `.tempo-media/thumbnails`).
Ingestion and the web app share a host today (`ecosystem.config.cjs`), so a directory is
enough; a split deployment would need shared storage or a move to object storage.

## 5. Deferred

- **A real ingest against live TikTok.** The cache is proven against a stubbed fetch,
  every failure mode included. What has not run here is a fetch against the actual CDN.
- **Per-video grading.** Cells carry `light: 'none'` — no threshold for per-video
  engagement exists in this codebase, and `light()` refuses to guess. It becomes real the
  moment an AM sets a target (M6).
- **Revenue per video (R7).** Not deferred so much as blocked: Shop revenue is not
  joinable to a video in this schema at all. The slide says so rather than leaving a
  reader to wonder.
- **Export-time budget (< 300 ms over M3).** The deck grew 159 KB → 177 KB with three
  embedded thumbnails, and reads are local-disk; the p95 assertion belongs with M5's
  nightly latency job.

## 6. Kill-list state

| Row | Made deletable? | Evidence / what is still missing |
| --- | --- | --- |
| K3 hourly report (report side) | Closer | The deck now covers organic content too; still needs the M7 golden comparison |
| K6 `ReportAiSettings` | No | `/healthz` exists since M0; the card that replaces the UI is M5 |
| K1 / K2 / K5 / K7 | No | Unchanged — all M7 |

## 7. Decisions taken here

- **Thumbnails are cached at ingest, on disk, not in Postgres.** They are opaque blobs
  nothing queries, they would bloat every `SELECT *` on `videos`, and the CDN URL they
  come from expires — so the fetch has to happen once, early, or never.
- **The grid is one row of three.** A second row fits only by shrinking thumbnails until
  they stop being the reason the slide exists, and it pushed the creative finding and the
  R7 note off the page. Lampiran B carries every video.
- **Both disclosures sit directly under the grid.** Same lesson as M3's coverage line: a
  note placed last is the first thing a full slide clips, and R7's "no revenue per video"
  is exactly the sentence that must not go missing.
- **A video with no permalink renders as a plain cell**, not an anchor with an empty
  `href`. A link that goes nowhere inside a client's PDF is worse than no link.
- **The self-containment test now states the real rule.** It used to assert "no `<img>`,
  no `http`", which M4 would have made false; it now asserts that every image source is a
  `data:` URI and that a URL may appear only as a link target — never as something the
  document must load to render.
