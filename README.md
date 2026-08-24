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

# One-time: create + apply the schema and seed a tenant
pnpm db:migrate
pnpm db:seed

# Run everything (web on http://localhost:3000)
pnpm dev
```

Open http://localhost:3000 — you land on the client's **hour-by-hour** view.

### Data sources

The provider is selected by `TIKTOK_DATA_PROVIDER` in `.env` (copy from
`.env.example`). No application code changes when switching.

| Provider  | Source                                   | Surfaces        | Intraday |
| --------- | ---------------------------------------- | --------------- | -------- |
| `fixture` | Deterministic synthetic data (default)   | paid + organic  | no       |
| `csv`     | A TikTok Ads "daily in hourly" export    | paid only       | **yes**  |
| `live`    | TikTok Business + Display APIs           | paid + organic  | no       |

To load a CSV export, point `TIKTOK_CSV_PATH` at it and describe the tenant:

```bash
TIKTOK_DATA_PROVIDER=csv
TIKTOK_CSV_PATH=./data/your-export.csv
TIKTOK_CSV_CLIENT_NAME=Acme
TIKTOK_CSV_CLIENT_SLUG=acme
TIKTOK_CSV_CURRENCY=IDR
TIKTOK_CSV_TIMEZONE=Asia/Jakarta
```

Then `pnpm db:seed`. The seed reads the export's own date span, so re-running it
with a wider export just backfills more days. `pnpm db:inspect` prints the
parsed intraday model for a quick sanity check.

### Report narration

The surface writes no prose. Every analytical claim on a deck is a `Finding`
produced by `tempo-engine`, which computes the figures deterministically first
and then puts three gates in front of anything a model wrote: it must validate
against the content schema, every numeral it prints must appear verbatim in the
finding's own evidence, and it may not name a metric the objective cannot
support. A failure falls back to the engine's deterministic `claim_frame`
templates and the deck says which tier produced it. The deck always renders.

Configuration for that model connection lives with the engine
(`tempo-engine/.env.example`), not here.

### Report API (external callers)

The Brief Deck (below) is the deliverable; `GET /api/reports/:slug/brief/:objective`
is the endpoint to integrate against.

`GET /api/reports/:slug` is a **deprecated alias**, kept for one release so no
existing integration breaks on the day the old report was removed. It answers
`308` to the deck for the client's own north star, carrying `format`, `date`,
`days` and `lang` across unchanged — any client that follows redirects keeps
working untouched:

```bash
curl -L -H "X-API-Key: $KEY" https://your-host/api/reports/cimory -o deck.pdf
#   308 → /api/reports/cimory/brief/gmv     (north star: shop)
```

Every call to it is logged with the caller's identity — same-origin, or a
truncated digest of the presented key, never the key itself — and the alias is
removed once the log shows no caller left to migrate. Migrate by naming the
objective in the URL.

Requests from this app's own UI pass through. Every external caller must send a
key as `X-API-Key` or `Authorization: Bearer <key>`:

```bash
curl -H "X-API-Key: $KEY" \
  https://your-host/api/reports/cimory/brief/gmv -o deck.pdf
```

Set `REPORT_API_KEYS` (comma-separated, so keys can be revoked individually) and
`REPORT_ALLOWED_ORIGINS` for browser callers. Keys are compared in constant time;
a browser caller must satisfy **both** the key and the origin allowlist, so a
leaked key cannot be used from another site. An unset `REPORT_API_KEYS` fails
closed — external access is refused rather than opened.

### Brief Deck (`/api/reports/:slug/brief/:objective`)

The client-facing deliverable: a landscape **16:9 deck** where every analytical
claim is a `Finding` from the Tempo Intelligence Engine (`tempo-engine/`), and
every number comes from the same day-grain rollup the dashboard reads.

```
GET /api/reports/cimory/brief/awareness                  → PDF (16:9, default)
GET /api/reports/cimory/brief/gmv?format=json            → the DeckModel, for portal UI
GET /api/reports/cimory/brief/install?format=html        → raw HTML preview
GET /api/reports/cimory/brief/gmv?tier=full&days=14      → full agentic run
```

`tier` picks how the prose is written, never what the numbers say:

| Tier | Path | Copy source | Target |
| --- | --- | --- | --- |
| `instant` (default) | generators → materiality, **zero model calls** | deterministic `claim_frame` templates | ≤ 10 s |
| `full` | + probe loop → narrator → critic → synthesist | agents | ≤ 6 min |

The cover badge and the footer on every slide state which tier produced the
deck, along with the run id — so any deck can be traced back to
`tempo-engine`'s own `/ui/briefs/{run_id}` review page in one step.

Because the full tier costs minutes, it is **pre-generated**: a weekly job
(`pnpm --filter @tempo/ingestion decks:cron`, run by pm2) renders each client's
full deck overnight and stores it, and the route serves that artifact while it
is fresh. A portal that wants both can download the instant deck immediately and
start a full run in parallel:

```
POST /api/reports/cimory/brief/gmv/full            → { runId }
GET  /api/reports/cimory/brief/gmv/full?runId=…    → { status: 'ready', downloadUrl }
```

Every generation is recorded in `report_runs`, which is what the engine health
card in Settings reads to answer "is the engine up, and did the last deck
render".

Which metrics a client's deck shows is a per-client `ReportSpec` (`report_specs`),
validated against the objective: an awareness spec containing `roas` is rejected
with a 422 rather than quietly rendering a number that objective should not show.
Absent a stored spec, the objective preset is used. See
[`docs/architecture/PRD_tempo_brief_deck.md`](docs/architecture/PRD_tempo_brief_deck.md)
and [`docs/phases/brief-deck/`](docs/phases/brief-deck/README.md).

To see a deck without a database or an engine running:

```bash
pnpm --filter @tempo/reports try:deck deck.html gmv   # renders the checked-in fixture
```

### How the hourly grain works

The export's `h00..h24` columns are cumulative-since-midnight; `d00..d23` are
the hour deltas. Two facts drive the whole pipeline:

- **Campaign rows and adgroup rows are parallel decompositions, not a sum.**
  Campaign `reach` dedupes across adgroups and the levels can be synced at
  different cutoffs, so they are stored separately (`adgroup_id IS NULL` is the
  campaign rollup) and never added together.
- **The first synced bucket of a day is not an hour.** It carries everything
  accumulated since midnight, so it is stored with `span_hours > 1`, counted in
  day totals, and excluded from every hour-by-hour series and comparison.
  Day-over-day deltas compare only the hours both days actually share.

## Repository layout

```
packages/
  core/       Domain kernel — entities, metric catalog, derivation, formatting
  tiktok/     TikTok provider layer — live (Business + Display) + fixtures
  db/         Drizzle schema, dual-driver client, ingestion pipeline, read-models
  reports/    Client PDF report generation — model, insights, inline-SVG charts, HTML
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
| `pnpm db:seed`      | Seed a tenant via the real ingestion pipeline   |
| `pnpm db:inspect`   | Print the parsed intraday model to the terminal |
| `pnpm db:studio`    | Open Drizzle Studio                             |
