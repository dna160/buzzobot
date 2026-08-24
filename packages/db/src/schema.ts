import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
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
