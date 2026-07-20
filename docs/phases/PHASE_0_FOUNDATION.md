# Phase 0 — Foundation & Domain Kernel — HANDOVER

**Status:** ✅ Complete · **Verified:** migrations apply, seed ingests 672 rows,
dashboard read-model returns correct rollups against embedded PGlite.

## 1. What shipped

A Turborepo/pnpm monorepo with the full backend spine and design system, running
end-to-end with **zero external services**.

```
tempo-insight-engine/
├── packages/
│   ├── tsconfig/          Shared TS base/next/react/node configs
│   ├── eslint-config/     Shared flat ESLint config
│   ├── core/              Domain kernel — entities, metric catalog, derivation, formatters
│   ├── tiktok/            TikTok provider layer — live (Business+Display) + fixtures
│   └── db/                Drizzle schema, dual-driver client, ingestion pipeline, read-models
├── docs/
│   ├── design/            FAANG-grade design system (tokens, components, dashboard IA)
│   ├── architecture/      System architecture
│   └── phases/            This handover set
├── .github/workflows/     CI (typecheck · lint · test · build)
├── docker-compose.yml     Optional Postgres + Redis for prod-like runs
└── turbo.json, pnpm-workspace.yaml, tsconfig.json, .env.example
```

### Domain kernel (`@tempo/core`)
- `domain/entities.ts` — Zod schemas & types for Agency, Client, TikTokAccount,
  Campaign, Video, PaidDailyMetric, OrganicDailyMetric, SyncRun.
- `metrics/catalog.ts` — the **METRICS** map: every KPI's label, format, and
  good-direction. **This is the contract the UI formats against.**
- `metrics/derive.ts` — pure, divide-by-zero-safe rollups: `sumPaid`/`derivePaid`
  (ROAS, CPA, CTR, CPM, CPC, CVR), `sumOrganic`/`deriveOrganic` (engagement rate,
  avg watch time), and `deltaPct`. **Unit-tested.**
- `utils/format.ts` + `utils/date.ts` — deterministic formatters and ISO-date math.

### TikTok integration (`@tempo/tiktok`)
- `types.ts` — the `TikTokDataProvider` interface (the seam the whole system
  programs against) + normalized DTOs.
- `fixtures/` — deterministic, trend-bearing synthetic data (seeded PRNG; weekly
  seasonality, growth, per-campaign character, video virality long-tail).
- `live/` — real `TikTokBusinessClient` (report/integrated + campaign/get) and
  `TikTokDisplayClient` (video/list + query) with a resilient retrying HTTP layer.
- `factory.ts` — `createTikTokProvider()` selects live vs fixture from env.

### Persistence & ingestion (`@tempo/db`)
- `schema.ts` — 8 tables; daily-fact grain with `(date, entity_id)` PKs.
- `client.ts` — `getDb()` returns Postgres (if `DATABASE_URL`) or embedded PGlite.
- `ingest/pipeline.ts` — `ingestAccount()`: fetch → upsert → record `sync_run`.
- `ingest/bootstrap.ts` — `ensureDemoTenant()` provisions the demo agency/client/accounts.
- `repositories/dashboard.ts` — `getDashboard()` returns the typed `DashboardData`
  read-model (KPI cards, time-series, campaign table, top-videos table).
- `scripts/` — `migrate.ts`, `seed.ts` (runs the **real** pipeline against fixtures).

### Design system (`docs/design/`)
- `DESIGN_SYSTEM.md`, `COMPONENTS.md`, `DASHBOARD_IA.md`, `tokens.css`.
- Dark-first; Inter + Geist Mono; validated colorblind-safe categorical palette;
  8-KPI dashboard layout (Paid: Spend/ROAS/Conversions/CPA · Organic:
  Views/Engagement/Followers/Watch-time).

## 2. Contracts the next phase relies on

- **`TikTokDataProvider`** (`@tempo/tiktok`) — implement/extend, never bypass.
- **`METRICS` catalog + `DashboardData`** — the API returns `DashboardData`;
  the UI renders it. Add a metric = add a catalog entry + a rollup field.
- **`getDb(): Database`** — the single DB handle. Repositories accept `Database`.
- **`getDashboard(db, client, range)`** — the one call the dashboard page needs.

## 3. How to run / verify

```bash
pnpm install
pnpm db:generate      # produce SQL migrations from the schema
pnpm db:migrate       # apply to embedded PGlite (or Postgres if DATABASE_URL set)
pnpm db:seed          # ingest a 90-day demo window via the real pipeline
pnpm --filter @tempo/core test     # metric derivation unit tests
pnpm --filter @tempo/tiktok test   # fixture determinism tests
```

Expected seed output: `✓ paid ... 450 daily rows`, `✓ organic ... 222 daily rows`.

## 4. Deferred (by design)

- **No UI/API yet** — that's Phase 1 (the vertical slice).
- **Auth & multi-tenant isolation** — schema is multi-tenant-ready; enforcement
  is Phase 2.
- **Scheduled ingestion / BullMQ + Redis** — pipeline is synchronous now;
  `apps/ingestion` will add scheduling in Phase 2. `REDIS_URL` reserved.
- **OAuth account connection** — `LiveTikTokProvider.listAccounts()` returns `[]`
  until the onboarding flow seeds connected accounts (Phase 2).
- **Live credentials** — provider defaults to fixtures until TikTok secrets are
  provided in `.env`; no code change needed to go live.
