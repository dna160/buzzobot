# Architecture — Tempo Insight Engine

> A consumer-grade TikTok analytics platform that a marketing agency operates
> on behalf of its clients. It ingests **paid** (TikTok Business/Marketing API)
> and **organic** (TikTok Display/Content API) performance data, stores it as
> daily facts, and renders per-client dashboards.

## 1. System shape

```
┌────────────────────────────────────────────────────────────────────────┐
│                              TikTok APIs                                 │
│        Business/Marketing (paid)          Display/Content (organic)      │
└───────────────────────────────┬──────────────────────────┬──────────────┘
                                │                          │
                     ┌──────────▼──────────────────────────▼─────────┐
                     │        @tempo/tiktok  (provider layer)         │
                     │   TikTokDataProvider  ─  live | fixture        │
                     └──────────────────────┬─────────────────────────┘
                                            │  normalized DTOs
                     ┌──────────────────────▼─────────────────────────┐
                     │           @tempo/db  (ingestion + storage)      │
                     │   pipeline → idempotent upserts → Postgres/PGlite│
                     │   read-models (dashboard rollups)               │
                     └───────────┬─────────────────────┬───────────────┘
                                 │                     │
              ┌──────────────────▼──────┐   ┌──────────▼───────────────┐
              │   apps/ingestion (CLI)  │   │  apps/web  (Next.js)     │
              │   backfill / scheduled  │   │  tRPC API + dashboard UI │
              └─────────────────────────┘   └──────────┬───────────────┘
                                                        │ consumes
                                            ┌───────────▼─────────────┐
                                            │  @tempo/ui + @tempo/core │
                                            │  design system + domain  │
                                            └──────────────────────────┘
```

## 2. Packages (why each exists)

| Package             | Responsibility                                                                 | Depends on          |
| ------------------- | ------------------------------------------------------------------------------ | ------------------- |
| `@tempo/core`       | Framework-free domain kernel: entities, metric **catalog**, metric derivation, formatting. Single source of truth for "what a metric is." | —                   |
| `@tempo/tiktok`     | Integration layer. `TikTokDataProvider` abstraction with a **live** (Business + Display) and a deterministic **fixture** implementation. | `core`              |
| `@tempo/db`         | Drizzle schema, auto-selecting DB client (Postgres **or** embedded PGlite), the ingestion **pipeline**, and dashboard **read-models**. | `core`, `tiktok`    |
| `@tempo/ui`         | Design-system component library implementing `docs/design`. Framework: React + Tailwind. | `core`              |
| `apps/web`          | Next.js 15 dashboard. tRPC API (server) + App Router UI (client).              | all packages        |
| `apps/ingestion`    | CLI/worker entry for backfills and (Phase 2) scheduled syncs.                  | `db`, `tiktok`, `core` |

## 3. Key decisions

- **The metric catalog is law.** `@tempo/core`'s `METRICS` map defines every
  KPI's label, format, and good-direction. Tiles, tables, and charts reference a
  `MetricKey` — formatting/coloring is never re-decided at the call site.
- **Fact-grain storage.** `paid_daily_metrics` and `organic_daily_metrics` are
  the atomic tables (a star-schema fact grain). All rollups derive from them, so
  new views cost a query, not a migration.
- **Idempotent ingestion.** Metric rows use `(date, entity_id)` composite PKs;
  re-ingesting a day upserts, never duplicates. Every run is recorded in
  `sync_runs` for observability.
- **Provider abstraction over TikTok.** Nothing downstream knows TikTok's wire
  format. Swapping live↔fixture is a one-line factory decision driven by env.
- **One database interface, two backends.** `getDb()` returns Postgres when
  `DATABASE_URL` is set, otherwise an embedded PGlite persisted to disk — so the
  whole product runs locally with zero external services, and the *same* Drizzle
  code targets production Postgres.
- **Rollups reuse the tested kernel.** Read-models aggregate raw rows through the
  same `derivePaid`/`deriveOrganic` functions the unit tests cover — the dashboard
  can't drift from the spec.

## 4. Data flow (a request for a client dashboard)

1. `apps/web` server calls the tRPC `dashboard.get` procedure with `{ clientSlug, range }`.
2. The procedure loads the client, then `getDashboard(db, client, range)`:
   - fetches paid + organic daily facts for the window **and** the preceding
     window (for period-over-period deltas),
   - rolls them up via `@tempo/core` into KPI cards, a unified time-series, a
     campaign table, and a top-content table.
3. The typed `DashboardData` flows to the client and renders through `@tempo/ui`.

## 5. Environments & security

- Secrets (TikTok credentials) are read from the environment only, never
  committed. See `.env.example`.
- Multi-tenancy is modeled from row one (`agency → client → account`); tenant
  isolation becomes a `WHERE` clause when auth lands (Phase 2).

See `docs/phases/` for the phased delivery plan and per-phase handovers.
