# M5 — Tiers end-to-end · `report_runs` + cron · engine health card — HANDOVER

**Status:** ⏭ Planned · **Verified:** —

## 1. Scope

PRD §5, §11 R1, K6. M0 made `tier` a real parameter on the engine; M5 makes it a real
product flow: the portal gets an instant deck immediately, a full run lands behind it,
and the routine Monday download was pre-generated overnight.

## 2. Planned work

- `report_runs` table (client × objective × period → run_id, status, artifact) + weekly
  cron alongside `packages/db/src/scripts/scheduler.ts` (the sanitizer cron is the
  precedent — same process manager entry in `ecosystem.config.cjs`).
- Portal flow: instant deck returned synchronously, full run kicked off async, swap +
  notify when it lands (poll or webhook).
- **K6:** replace `ReportAiSettings` (LM Studio probe UI) with an engine health card
  reading `GET /healthz` (shipped in M0) plus last-run stats from `insight.*`.
- R1 mitigation is non-negotiable here: the tier badge on the cover and in the footer,
  and portal copy that names the tier honestly. An instant deck mistaken for the full
  product makes the engine invisible.

## 3. Entry contract this milestone assumes

From M0: `tier` on `POST /v1/briefs` and `/v1/briefs/sync`, `content.tier`, `GET /healthz`.
From M2: the deck route already accepts `?tier=` and stamps the badge/footer.

## 4. Exit criteria (PRD §9)

- Portal button: instant deck < 10 s p95; full deck replaces it unattended.
- Monday-morning download is pre-generated (cron row exists, artifact served without a
  live engine call).
- `ReportAiSettings` is gone; the health card shows engine reachability and last-run stats.
