<div align="center">

# Tempo Insight Engine

**A consumer-grade TikTok analytics platform for marketing agencies and their clients.**

Ingests paid (TikTok Business/Marketing API) and organic (TikTok Display/Content API)
performance data into per-client dashboards.

</div>

![Tempo Insight Engine — client dashboard](docs/screenshots/dashboard-dark.png)

---

## Highlights

- **Both surfaces, one product** — paid campaigns (spend, ROAS, CPA, conversions)
  and organic content (views, engagement, followers, watch-time) side by side.
- **Runs with zero setup** — an embedded PGlite database and a deterministic
  fixture data provider mean `pnpm dev` works with no Postgres and no TikTok
  credentials. Drop in real ones and nothing else changes.
- **Typed end to end** — a Turborepo monorepo where the domain kernel, the
  ingestion layer, the API, and the UI share the same types.
- **Design-system driven** — a dark-first, accessible, FAANG-grade component
  library (`docs/design/`) rendered with Tailwind + Recharts.

## Tech stack

| Layer     | Choice                                                     |
| --------- | ---------------------------------------------------------- |
| Monorepo  | pnpm workspaces + Turborepo                                |
| Language  | TypeScript (strict)                                        |
| Web       | Next.js 15 (App Router) · React 18                         |
| API       | tRPC v11 · Zod                                             |
| Data      | Drizzle ORM · Postgres (prod) / PGlite (local & CI)        |
| Charts    | Recharts                                                   |
| Testing   | Vitest                                                     |

## Quick start

```bash
pnpm install

# One-time: create + apply the schema and seed a demo tenant (fixtures)
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# Run everything (web on http://localhost:3000)
pnpm dev
```

Open http://localhost:3000 — you land on the **Aurora Skincare** demo client
dashboard.

### Going live with real TikTok data

1. Copy `.env.example` → `.env`.
2. Fill in the TikTok Business and/or Display credentials.
3. Set `TIKTOK_DATA_PROVIDER=live` (or leave unset — it auto-detects credentials).
4. Re-run `pnpm db:seed` (or the ingestion CLI) to pull real data.

No application code changes are required to switch providers or databases.

## Repository layout

```
packages/
  core/       Domain kernel — entities, metric catalog, derivation, formatting
  tiktok/     TikTok provider layer — live (Business + Display) + fixtures
  db/         Drizzle schema, dual-driver client, ingestion pipeline, read-models
  ui/         Design-system component library
apps/
  web/        Next.js dashboard (tRPC API + App Router UI)
  ingestion/  CLI for backfills / scheduled syncs
docs/
  design/         Design system (tokens, components, dashboard IA)
  architecture/   System architecture
  phases/         Phased delivery plan + handovers
```

See [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) for
the full picture and [`docs/phases/`](docs/phases/) for the delivery plan.

## Scripts

| Command             | Description                                     |
| ------------------- | ----------------------------------------------- |
| `pnpm dev`          | Run all apps in dev mode                        |
| `pnpm build`        | Build everything                                |
| `pnpm typecheck`    | Typecheck all packages                          |
| `pnpm lint`         | Lint all packages                               |
| `pnpm test`         | Run all unit tests                              |
| `pnpm db:migrate`   | Apply migrations                                |
| `pnpm db:seed`      | Seed a demo tenant via the real pipeline        |
| `pnpm db:studio`    | Open Drizzle Studio                             |
