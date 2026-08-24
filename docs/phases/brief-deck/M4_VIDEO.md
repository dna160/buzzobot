# M4 — S5 video slide · Lampiran B · thumbnail caching — HANDOVER

**Status:** ⏭ Planned · **Verified:** —

## 1. Scope

PRD §4 (S5, Lampiran B), §6 (video slide fidelity), §11 R7. The one slide that needs
bytes rather than numbers: cached thumbnails, clickable `shareUrl` links that survive
Chromium print, and the full KOL/video appendix.

## 2. Planned work

- `listWindowVideos(db, client, range)` in `@tempo/db` — video rows + organic metrics +
  `shareUrl` for the window (`videos` already carries `thumbnailUrl` / `shareUrl`).
- `videos.thumbnail_cached_path` + caching in the ingestion pipeline. TikTok CDN URLs
  expire and N fetches at render time would blow the instant tier's budget, so bytes are
  fetched once at ingestion, never at render. Missing cache → branded placeholder,
  never a broken image.
- `videoGrid` block renderer: thumbnail + `<a href={shareUrl}>` + per-video metrics +
  light; Lampiran B table for every video in the window.
- **R7 gate:** the "omzet per video" column ships only after the Shop DTO contract lands
  (engine PRD §3.3). Until then Lampiran B shows organic metrics and says so.

## 3. Entry contract this milestone assumes

From M1: `light()` for per-video grading, `MetricDef.labelId` for column headers.
From M2: `videoGrid` is already in the `Block` union and the renderer's switch — M4
fills it, it does not widen the contract.

## 4. Exit criteria (PRD §9)

- Thumbnails click through to TikTok from inside the generated PDF (link-integrity test:
  every `videoGrid` href equals the row's `shareUrl`).
- Export adds < 300 ms over the M2 deck.
- No render-time network fetch: rendering with the network unplugged produces the same
  deck (placeholders only where the cache genuinely missed).
