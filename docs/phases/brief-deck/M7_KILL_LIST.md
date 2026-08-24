# M7 — Kill list — HANDOVER

**Status:** ⏭ Planned · **Verified:** —

## 1. Scope

PRD §1, §11 R6. The deck has to beat the old renderers on goldens *before* anything is
deleted; M7 is where that debt is collected. Each row is its own PR.

## 2. Planned work

| Row | Deletion | Precondition |
| --- | --- | --- |
| K1 | `packages/reports/src/narrative/**` (prompt, fact sheet, providers, verify, probe) | tempo-engine is the only narration source, M3 shipped |
| K2 | `packages/reports/src/{model,render,insights}.ts` | Brief Deck goldens beat the daily report |
| K3 | `packages/reports/src/hourly-*.ts` (report side only — the dashboard's `@tempo/db` read-models are untouched) | intraday detail renders as Lampiran A |
| K7 | `packages/reports/src/i18n.ts` | surviving strings migrated to `deck/copy.ts` + `labelId` |
| K5 | `GET /api/reports/:slug` → 308 alias to the north-star objective, **logged**, removed one release later | zero unknown callers for a full release |

`ReportAiSettings` (K6) died at M5; the A4 engine-brief renderer (K4) died at M3.

**What does not die** (PRD §1): the engine's review gate `interrupt()`, the numeral /
schema / metric gates, the deterministic fallback doctrine, `/ui/briefs/{run_id}`, and
the dashboard.

## 3. Exit criteria (PRD §9)

- `packages/reports/src` contains `deck/`, `charts.ts`, and `layout.ts` remnants only.
- `pnpm typecheck · lint · test · build` green; `.env.example` and `README.md` updated —
  R6 names the stale portal documentation as the specific trap.
- K5 alias ships with access logging; removal is a separate PR one release later, gated
  on zero unknown callers.
