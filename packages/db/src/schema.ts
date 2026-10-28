import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Physical schema for Tempo Insight Engine.
 *
 * Modeling notes:
 *  - Multi-tenant from row one: agency → client → account is the ownership
 *    spine, so tenant isolation is a WHERE clause away when auth lands.
 *  - Daily metric tables are the atomic "fact" grain (star-schema style).
 *    Everything on the dashboard rolls up from these two tables.
 *  - Metric rows use (date, entity_id) composite PKs so re-ingesting a day is
 *    an idempotent upsert, never a duplicate.
 */

export const agencies = pgTable('agencies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id')
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logoUrl: text('logo_url'),
    brandColor: text('brand_color'),
    timezone: text('timezone').notNull().default('UTC'),
    currency: text('currency').notNull().default('USD'),
    /**
     * Which figure this client's dashboard and reports are built around —
     * different brands buy TikTok media for fundamentally different outcomes,
     * and presenting the wrong headline (e.g. view-through rate for a brand
     * whose real conversions are on TikTok Shop) would misrepresent what
     * actually matters to them:
     *   'vtr'         — no on-platform outcome exists (e.g. offline FMCG
     *                    retail); view-through rate is the honest proxy.
     *   'shop'        — real TikTok Shop purchases; conversions and ROAS lead.
     *   'app_install'  — app installs are the buyable outcome; CPI leads.
     */
    northStar: text('north_star').notNull().default('vtr'),
    /**
     * Service tier:
     *   'premium'  — Full hourly intraday telemetry (*_daily_performance tables), pacing, and brief reports.
     *   'standard' — GMV Brief / Daily Overview performance summaries.
     */
    tier: text('tier').notNull().default('standard'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('clients_agency_slug_uq').on(t.agencyId, t.slug)],
);

export const tiktokAccounts = pgTable(
  'tiktok_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    surface: text('surface').notNull(), // 'paid' | 'organic'
    externalId: text('external_id').notNull(),
    displayName: text('display_name').notNull(),
    username: text('username'),
    avatarUrl: text('avatar_url'),
    status: text('status').notNull().default('active'),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('accounts_surface_external_uq').on(t.surface, t.externalId),
    index('accounts_client_idx').on(t.clientId),
  ],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => tiktokAccounts.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    objective: text('objective').notNull(),
    status: text('status').notNull(),
    dailyBudget: doublePrecision('daily_budget'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('campaigns_account_external_uq').on(t.accountId, t.externalId)],
);

export const videos = pgTable(
  'videos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => tiktokAccounts.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    caption: text('caption').notNull().default(''),
    thumbnailUrl: text('thumbnail_url'),
    /**
     * Where the thumbnail's bytes were cached at ingestion (Brief Deck PRD §6).
     *
     * TikTok's CDN URLs expire, so `thumbnail_url` is not something a report
     * generated next week can still resolve — and fetching N images while
     * rendering would blow the instant tier's ten-second budget even when the
     * URLs are live. The bytes are fetched once, on ingest, and the deck reads
     * them from here. Null means "not cached", which renders as a branded
     * placeholder, never a broken image.
     */
    thumbnailCachedPath: text('thumbnail_cached_path'),
    shareUrl: text('share_url'),
    durationSec: doublePrecision('duration_sec').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('videos_account_external_uq').on(t.accountId, t.externalId)],
);

export const paidDailyMetrics = pgTable(
  'paid_daily_metrics',
  {
    date: date('date', { mode: 'string' }).notNull(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    spend: doublePrecision('spend').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    conversions: integer('conversions').notNull().default(0),
    conversionValue: doublePrecision('conversion_value').notNull().default(0),
    videoViews: integer('video_views').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.campaignId] }),
    index('paid_metrics_campaign_idx').on(t.campaignId),
  ],
);

export const adgroups = pgTable(
  'adgroups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
  },
  (t) => [uniqueIndex('adgroups_campaign_external_uq').on(t.campaignId, t.externalId)],
);

/**
 * Intraday facts at (date, hour, campaign, adgroup) grain.
 *
 * `adgroup_id` NULL means the campaign-level rollup as reported by TikTok —
 * kept as its own row rather than derived, because campaign `reach` dedupes
 * across adgroups and the two levels can be synced at different cutoffs, so
 * summing adgroups does NOT reproduce the campaign figure.
 *
 * NULL doesn't participate in a Postgres composite PK, so identity is enforced
 * by two partial unique indexes instead.
 */
export const paidHourlyMetrics = pgTable(
  'paid_hourly_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date', { mode: 'string' }).notNull(),
    /** 0..23, in the advertiser account's own timezone. */
    hour: integer('hour').notNull(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    adgroupId: uuid('adgroup_id').references(() => adgroups.id, { onDelete: 'cascade' }),
    spend: doublePrecision('spend').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    reach: integer('reach').notNull().default(0),
    videoViews: integer('video_views').notNull().default(0),
    /**
     * 6-second video views (TikTok `video_watched_6s`). Numerator for the 6s
     * view-through rate — VTR6s = videoWatched6s / impressions. The headline
     * quality metric for a view-objective FMCG brand.
     */
    videoWatched6s: integer('video_watched_6s').notNull().default(0),
    /**
     * 15-second engaged views (TikTok `engaged_view_15s`). Numerator for the
     * 15s view-through rate — VTR15s = engagedView15s / impressions.
     */
    engagedView15s: integer('engaged_view_15s').notNull().default(0),
    engagements: integer('engagements').notNull().default(0),
    likes: integer('likes').notNull().default(0),
    comments: integer('comments').notNull().default(0),
    shares: integer('shares').notNull().default(0),
    follows: integer('follows').notNull().default(0),
    profileVisits: integer('profile_visits').notNull().default(0),
    /**
     * The platform-reported primary conversion event, generic across north
     * stars: TikTok Shop purchases for a 'shop' client, app installs for an
     * 'app_install' client. Always 0 for a 'vtr' client — no column here means
     * "not tracked," never a fabricated zero used as a real figure.
     */
    conversions: integer('conversions').notNull().default(0),
    /** Revenue/value attached to `conversions`, when the source reports one (e.g. Shop GMV). */
    conversionValue: doublePrecision('conversion_value').notNull().default(0),
    /**
     * Hours of activity this row represents. 1 for a true hour; >1 when the
     * bucket is the first synced hour of the day and therefore absorbs every
     * earlier hour. Rows with span_hours > 1 must be excluded from hourly
     * comparisons — they are not hours.
     */
    spanHours: integer('span_hours').notNull().default(1),
  },
  (t) => [
    uniqueIndex('paid_hourly_campaign_uq')
      .on(t.date, t.hour, t.campaignId)
      .where(sql`${t.adgroupId} IS NULL`),
    uniqueIndex('paid_hourly_adgroup_uq')
      .on(t.date, t.hour, t.campaignId, t.adgroupId)
      .where(sql`${t.adgroupId} IS NOT NULL`),
    index('paid_hourly_campaign_idx').on(t.campaignId, t.date),
  ],
);

export const organicDailyMetrics = pgTable(
  'organic_daily_metrics',
  {
    date: date('date', { mode: 'string' }).notNull(),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    views: integer('views').notNull().default(0),
    likes: integer('likes').notNull().default(0),
    comments: integer('comments').notNull().default(0),
    shares: integer('shares').notNull().default(0),
    watchTimeSec: doublePrecision('watch_time_sec').notNull().default(0),
    reach: integer('reach').notNull().default(0),
    newFollowers: integer('new_followers').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.videoId] }),
    index('organic_metrics_video_idx').on(t.videoId),
  ],
);

/**
 * Operator-configurable application settings, as a small key→JSON store.
 *
 * A key-value table rather than typed columns because these are low-volume,
 * read-once-per-request app preferences (e.g. the report AI connection) whose
 * shape is owned and validated by the code that reads them — not query
 * predicates. `value` holds a JSON document; `updated_at` is bumped on write.
 */
/**
 * Per-client Brief Deck configuration (Brief Deck PRD §3.3) — which metrics a
 * deck shows and in what priority order, plus appendix toggles and targets.
 *
 * Keyed by (client, objective) rather than client alone: awareness decks are
 * available to every client regardless of north star, so one client can hold an
 * awareness spec alongside the spec for their own objective. Absent means the
 * objective's preset, which is why nothing here is required for a client to get
 * a working deck.
 *
 * The payload is validated by `ReportSpecSchema` in `@tempo/reports` on the way
 * in and on the way out — `jsonb` here is storage, not a schema decision. A
 * stored spec that no longer suits its objective falls back to the preset
 * rather than failing the export.
 */
export const reportSpecs = pgTable(
  'report_specs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** 'awareness' | 'gmv' | 'install' — `BriefObjective` in @tempo/core. */
    objective: text('objective').notNull(),
    spec: jsonb('spec').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('report_specs_client_objective_uq').on(t.clientId, t.objective),
    index('report_specs_client_idx').on(t.clientId),
  ],
);

/**
 * One row per deck generation (Brief Deck PRD §5).
 *
 * Two jobs. It is the **pre-generation ledger**: the weekly cron renders a
 * full-tier deck per client × objective ahead of Monday, and the route serves
 * that artifact instead of spending minutes regenerating it while someone
 * waits. And it is the **run history** the engine health card reads, so
 * "did the last run work" is answerable from the surface's own data rather
 * than only from inside tempo-engine.
 *
 * Keyed by (client, objective, window, tier) because those four determine what
 * the deck says: a different window is a different deck, and an instant deck
 * must never be served where a full one was asked for.
 */
export const reportRuns = pgTable(
  'report_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    objective: text('objective').notNull(),
    /**
     * Inclusive window the deck covers. Null until it is known: an async
     * full run is recorded the moment it starts, before the rollup that
     * decides its window has been read. A row with a null window is a run in
     * flight, never a servable artifact — `latestCompletedRun` matches on
     * exact dates, so it cannot return one.
     */
    periodStart: date('period_start', { mode: 'string' }),
    periodEnd: date('period_end', { mode: 'string' }),
    /** 'instant' | 'full' — which path produced it. */
    tier: text('tier').notNull(),
    /** tempo-engine's run id, so a deck traces to /ui/briefs/{run_id}. */
    runId: text('run_id'),
    /** 'running' | 'completed' | 'failed'. */
    status: text('status').notNull().default('running'),
    /** Where the rendered PDF was stored; null until it completes. */
    artifactPath: text('artifact_path'),
    artifactBytes: integer('artifact_bytes'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('report_runs_lookup_idx').on(t.clientId, t.objective, t.periodEnd),
    index('report_runs_status_idx').on(t.status),
  ],
);

/**
 * Manually-entered target values for the Template Report's "Result Metric vs
 * Benchmark" section. There is no industry-benchmark data source anywhere in
 * this system — an AM types in the numbers they actually negotiate with the
 * brand, one row per (client, funnel stage, metric).
 */
export const reportBenchmarks = pgTable(
  'report_benchmarks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** 'awareness' | 'consideration' | 'conversion' — the template's funnel stage. */
    objective: text('objective').notNull(),
    /** 'cpm' | 'ctr' | 'vtr' | 'cpc' | 'cost_per_atc' | 'roi' | 'cvr' | 'cpa'. */
    metric: text('metric').notNull(),
    targetValue: doublePrecision('target_value').notNull(),
    /** 'higher_is_better' | 'lower_is_better' — which side of the target is Baik. */
    comparisonDirection: text('comparison_direction').notNull(),
    updatedBy: text('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('report_benchmarks_client_obj_metric_uq').on(t.clientId, t.objective, t.metric)],
);

/**
 * One row per Template Report generation — the ledger, mirroring `reportRuns`.
 * The shared report link (`/r/:token`) is what writes it: a run is the cache
 * entry for one (client, template, benchmark, window), and its rendered HTML
 * lives on disk at `artifactPath`, same as a deck.
 */
export const templateReportRuns = pgTable(
  'template_report_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** 'shop' | 'vtr' | 'app_install' — which template was rendered. */
    template: text('template').notNull().default('shop'),
    /** 'industry' | 'previous_period' — what §2/§3 were graded against. */
    benchmarkMode: text('benchmark_mode').notNull().default('industry'),
    /** First day covered. */
    periodStart: date('period_start', { mode: 'string' }),
    /** Last day covered — inclusive, as a person picked it ("1–31 Aug"). */
    periodEnd: date('period_end', { mode: 'string' }),
    status: text('status').notNull().default('running'),
    artifactPath: text('artifact_path'),
    artifactBytes: integer('artifact_bytes'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('template_report_runs_lookup_idx').on(t.clientId, t.periodEnd),
    // At most one generation in flight per key: two viewers opening the same
    // link at once must share one LM Studio run, not start two.
    uniqueIndex('template_report_runs_running_uq')
      .on(t.clientId, t.template, t.benchmarkMode, t.periodStart, t.periodEnd)
      .where(sql`${t.status} = 'running'`),
  ],
);

/**
 * Shareable, unauthenticated links to a client's Template Report
 * (`/r/:token`). The token is the only credential — 32 random bytes, so it
 * cannot be guessed — and it is stored as issued so the portal's "Generate
 * Report" can hand back the same stable link every time rather than minting a
 * new one per click. It never expires on its own; `revokedAt` kills it, and the
 * next request for that client issues a fresh token.
 */
export const reportLinks = pgTable(
  'report_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    /** Who asked for it, as the caller described them (e.g. "portal:user:42"). */
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('report_links_token_uq').on(t.token),
    // One live link per client — what makes "create or return" well defined.
    uniqueIndex('report_links_client_active_uq').on(t.clientId).where(sql`${t.revokedAt} IS NULL`),
  ],
);

/**
 * Industry classification for real Buzzohero ad accounts (the source
 * `brands` table has no category/industry column of its own — confirmed by
 * inspecting `information_schema.columns`). Populated by a one-time Claude
 * categorization pass over the full real account list (not by an LLM at
 * runtime, and never by string-matching), so "populate benchmarks from
 * industry peers" can look up a client's real peers by a fixed `industry`
 * code instead of re-deriving keyword guesses on every run. Lives in Tempo's
 * own domain DB — it is enrichment data Tempo owns, not something written
 * back into the shared real Buzzohero source database.
 */
export const brandIndustryTags = pgTable(
  'brand_industry_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The real TikTok ad account id from Buzzohero's `brands` table — the join key back to real data. */
    tiktokAdAccountId: text('tiktok_ad_account_id').notNull(),
    /** Snapshot of the real account name at categorization time, for auditability. */
    name: text('name').notNull(),
    /** One of INDUSTRY_TAXONOMY's fixed codes (e.g. 'cosmetics_skincare'). */
    industry: text('industry').notNull(),
    /** 'high' | 'medium' — how confident the categorization is; low-confidence guesses are deliberately excluded rather than stored as noise. */
    confidence: text('confidence').notNull(),
    source: text('source').notNull().default('claude-categorized'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('brand_industry_tags_account_uq').on(t.tiktokAdAccountId),
    index('brand_industry_tags_industry_idx').on(t.industry),
  ],
);

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => tiktokAccounts.id, { onDelete: 'cascade' }),
    surface: text('surface').notNull(),
    status: text('status').notNull(),
    windowStart: date('window_start').notNull(),
    windowEnd: date('window_end').notNull(),
    rowsIngested: integer('rows_ingested').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    isBackfill: boolean('is_backfill').notNull().default(false),
  },
  (t) => [index('sync_runs_account_idx').on(t.accountId, sql`${t.startedAt} DESC`)],
);

// ─── Market Scope (TTMS) mirror — Strategy Report PRD §6.3 ──────────────────
//
// A read-only copy of the portal's `ttms_*` tables, filled by
// `ingest/market-scope-sync.ts` inside the sanitizer run, so tempo-engine keeps
// reading only Tempo's own DB (engine PRD §1). Deliberately the portal's
// **wide** shape — one row per (account, day, stage) with every benchmark level
// as a column — rather than the PRD's row-per-benchmark sketch: brand values do
// not vary by benchmark level, so a row per level would store each one four
// times, and a 1:1 shape is what lets the mirror be checked row-for-row against
// its source (P0_DISCOVERY.md §2). Dates are TTMS days, which are UTC.

/**
 * One TTMS account the portal can open. Which Tempo clients it serves is in
 * `market_scope_links`: an account is a brand, and a brand's TTMS account can
 * list several ad accounts held by different Tempo clients (TCL's lists both
 * its TikTok Shop and its Tokopedia ad account).
 */
export const marketScopeAccounts = pgTable(
  'market_scope_accounts',
  {
    ttmsAccountId: text('ttms_account_id').primaryKey(),
    /** TikTok's own name for the brand — also its row name in ranking lists. */
    brandName: text('brand_name').notNull(),
    vertical: text('vertical'),
    regionCode: text('region_code'),
    /** Raw plan text from TikTok, e.g. "TTS Purchase(Lite)". Use `isLite` for logic. */
    plan: text('plan'),
    isLite: boolean('is_lite').notNull().default(true),
    /** Metrics (or METRIC:CONTENT_TYPE pairs) TikTok refuses for this plan — the source of locked rows. */
    unavailableMetrics: text('unavailable_metrics').array().notNull().default(sql`'{}'::text[]`),
    linkedAdvertiserIds: text('linked_advertiser_ids').array().notNull().default(sql`'{}'::text[]`),
    /** Latest settled TTMS day in the source; nothing after it is meaningful. */
    lastDataDate: date('last_data_date', { mode: 'string' }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

/**
 * Which Tempo clients a TTMS account serves: every client holding one of the
 * ad accounts it lists (`ttms_accounts.advertiser_ids` ∩ the client's paid
 * `tiktok_accounts.external_id`). Rewritten by each Market Scope sync.
 */
export const marketScopeLinks = pgTable(
  'market_scope_links',
  {
    ttmsAccountId: text('ttms_account_id').notNull(),
    clientId: uuid('client_id').notNull(),
    /**
     * The account this client's strategy report uses by default when it has
     * several (Purbasari and Senka share one advertiser): the one whose TikTok
     * name matches the client's, or the only one. `strategy_specs.ttms_account_id` overrides.
     */
    isPrimary: boolean('is_primary').notNull().default(false),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'market_scope_links_pk', columns: [t.ttmsAccountId, t.clientId] }),
    // Named explicitly: the generated names run past Postgres's 63-character limit.
    foreignKey({ name: 'ms_links_account_fk', columns: [t.ttmsAccountId], foreignColumns: [marketScopeAccounts.ttmsAccountId] }).onDelete('cascade'),
    foreignKey({ name: 'ms_links_client_fk', columns: [t.clientId], foreignColumns: [clients.id] }).onDelete('cascade'),
    index('market_scope_links_client_idx').on(t.clientId),
  ],
);

/** Daily audience per funnel stage (ACC, Awareness, Consideration, Conversion). */
export const marketScopeAudienceDaily = pgTable(
  'market_scope_audience_daily',
  {
    ttmsAccountId: text('ttms_account_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    /** 'acc' | 'awareness' | 'consideration' | 'conversion' */
    stage: text('stage').notNull(),
    /** A stock over TTMS's rolling window, not a flow — see `size_ratio` in the catalog. */
    brandTotal: bigint('brand_total', { mode: 'number' }),
    brandNew: bigint('brand_new', { mode: 'number' }),
    brandOutflow: bigint('brand_outflow', { mode: 'number' }),
    /** From the audience-trend call; differs by ±1 from `market_scope_rankings_daily`, which is canonical. */
    brandRanking: integer('brand_ranking'),
    totalBrandCount: integer('total_brand_count'),
    benchTotalTop5: doublePrecision('bench_total_top5'),
    benchTotalTop10: doublePrecision('bench_total_top10'),
    benchTotalTop25: doublePrecision('bench_total_top25'),
    benchTotalTop50: doublePrecision('bench_total_top50'),
    benchNewTop5: doublePrecision('bench_new_top5'),
    benchNewTop10: doublePrecision('bench_new_top10'),
    benchNewTop25: doublePrecision('bench_new_top25'),
    benchNewTop50: doublePrecision('bench_new_top50'),
    benchOutflowTop5: doublePrecision('bench_outflow_top5'),
    benchOutflowTop10: doublePrecision('bench_outflow_top10'),
    benchOutflowTop25: doublePrecision('bench_outflow_top25'),
    benchOutflowTop50: doublePrecision('bench_outflow_top50'),
  },
  (t) => [
    primaryKey({ name: 'ms_audience_daily_pk', columns: [t.ttmsAccountId, t.date, t.stage] }),
    foreignKey({ name: 'ms_audience_daily_account_fk', columns: [t.ttmsAccountId], foreignColumns: [marketScopeAccounts.ttmsAccountId] }).onDelete('cascade'),
  ],
);

/**
 * Daily brand-insight metric per content type ('all' = no filter). The content
 * types overlap except `paid` + `non_paid`, which partition `all`.
 */
export const marketScopeInsightsDaily = pgTable(
  'market_scope_insights_daily',
  {
    ttmsAccountId: text('ttms_account_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    /** Lower-case TTMS metric: 'impressions', 'engagements', … 'nsr'. */
    metric: text('metric').notNull(),
    /** 'all' | 'paid' | 'non_paid' | 'ads' | 'creator_boosted' | … | 'ugc_organic' */
    contentType: text('content_type').notNull(),
    brandValue: doublePrecision('brand_value'),
    /** The brand's share of the whole vertical that day (0–1). */
    brandShare: doublePrecision('brand_share'),
    benchValueTop5: doublePrecision('bench_value_top5'),
    benchValueTop10: doublePrecision('bench_value_top10'),
    benchValueTop25: doublePrecision('bench_value_top25'),
    benchValueTop50: doublePrecision('bench_value_top50'),
    benchShareTop5: doublePrecision('bench_share_top5'),
    benchShareTop10: doublePrecision('bench_share_top10'),
    benchShareTop25: doublePrecision('bench_share_top25'),
    benchShareTop50: doublePrecision('bench_share_top50'),
  },
  (t) => [
    primaryKey({ name: 'ms_insights_daily_pk', columns: [t.ttmsAccountId, t.date, t.metric, t.contentType] }),
    foreignKey({ name: 'ms_insights_daily_account_fk', columns: [t.ttmsAccountId], foreignColumns: [marketScopeAccounts.ttmsAccountId] }).onDelete('cascade'),
  ],
);

/**
 * The daily category ranking list per stage — names and ranks only; TikTok
 * gives no competitor values. Ties share a rank. Canonical source for "#x of N".
 */
export const marketScopeRankingsDaily = pgTable(
  'market_scope_rankings_daily',
  {
    ttmsAccountId: text('ttms_account_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    stage: text('stage').notNull(),
    /** Public brand name as TikTok lists it. */
    brand: text('brand').notNull(),
    ranking: integer('ranking').notNull(),
  },
  (t) => [
    primaryKey({ name: 'ms_rankings_daily_pk', columns: [t.ttmsAccountId, t.date, t.stage, t.brand] }),
    foreignKey({ name: 'ms_rankings_daily_account_fk', columns: [t.ttmsAccountId], foreignColumns: [marketScopeAccounts.ttmsAccountId] }).onDelete('cascade'),
    index('market_scope_rankings_stage_date_idx').on(t.ttmsAccountId, t.stage, t.date),
  ],
);

// ─── Strategy Report specs and the action loop — PRD §6.4 ───────────────────

/**
 * What an AM set for a client's Strategy Report: the class override, the goal
 * the report paces against, and the costs TikTok Ads cannot see. One row per
 * client; absent means "inferred class, no goal, no fees".
 */
export const strategySpecs = pgTable(
  'strategy_specs',
  {
    clientId: uuid('client_id')
      .primaryKey()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** Which TTMS account to report on when a client has several; null = the primary one. */
    ttmsAccountId: text('ttms_account_id'),
    /** 'brand' | 'shop' — `ReportClass` in @tempo/core; null = inferred per run. */
    reportClassOverride: text('report_class_override'),
    /**
     * 'rank' | 'share' | 'size_ratio' | 'cost_per_new'. `size_ratio` replaces the
     * PRD's `move_on_rate` (P0 §6.2); `cost_per_new` is offered only for stages
     * with daily flow, never Conversion (P0 §6.3) — enforced in the repository.
     */
    goalKind: text('goal_kind'),
    /** 'acc' | 'awareness' | 'consideration' | 'conversion' */
    goalStage: text('goal_stage'),
    /** For share goals: a TTMS insight metric such as 'impressions'. */
    goalMetric: text('goal_metric'),
    goalValue: doublePrecision('goal_value'),
    goalDeadline: date('goal_deadline', { mode: 'string' }),
    /** IDR per month, typed by the AM — creator fees never appear in TikTok Ads. */
    creatorFeeMonthly: doublePrecision('creator_fee_monthly'),
    bgcCostMonthly: doublePrecision('bgc_cost_monthly'),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'strategy_specs_ttms_account_fk',
      columns: [t.ttmsAccountId],
      foreignColumns: [marketScopeAccounts.ttmsAccountId],
    }).onDelete('set null'),
    check('strategy_specs_class_ck', sql`${t.reportClassOverride} IN ('brand', 'shop')`),
    check('strategy_specs_goal_kind_ck', sql`${t.goalKind} IN ('rank', 'share', 'size_ratio', 'cost_per_new')`),
    check('strategy_specs_goal_stage_ck', sql`${t.goalStage} IN ('acc', 'awareness', 'consideration', 'conversion')`),
  ],
);

/**
 * Every action a Strategy Report proposed, and what became of it (PRD §5.6).
 * `action_json` is the engine's `ActionItem` as proposed — targets come from
 * the Target Solver, never a model — so the next run can measure the same
 * metric against the same target.
 */
export const strategyActions = pgTable(
  'strategy_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** The engine run that proposed it. */
    runId: text('run_id').notNull(),
    actionJson: jsonb('action_json').notNull(),
    /** proposed → running (accepted) → worked | weak | failed; or snoozed. */
    status: text('status').notNull().default('proposed'),
    acceptedBy: text('accepted_by'),
    startedAt: date('started_at', { mode: 'string' }),
    measuredValue: doublePrecision('measured_value'),
    /** The benchmark's change over the same window — what "beat the category" is measured against. */
    categoryDelta: doublePrecision('category_delta'),
    measuredRunId: text('measured_run_id'),
    measuredAt: timestamp('measured_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('strategy_actions_client_status_idx').on(t.clientId, t.status),
    check('strategy_actions_status_ck', sql`${t.status} IN ('proposed', 'running', 'worked', 'weak', 'failed', 'snoozed')`),
  ],
);

export const schema = {
  agencies,
  clients,
  tiktokAccounts,
  campaigns,
  adgroups,
  videos,
  paidDailyMetrics,
  paidHourlyMetrics,
  organicDailyMetrics,
  syncRuns,
  appSettings,
};

export type Schema = typeof schema;
