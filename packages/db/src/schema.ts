import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
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
    date: date('date').notNull(),
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

export const organicDailyMetrics = pgTable(
  'organic_daily_metrics',
  {
    date: date('date').notNull(),
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
  videos,
  paidDailyMetrics,
  organicDailyMetrics,
  syncRuns,
};

export type Schema = typeof schema;
