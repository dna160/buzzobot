import { z } from 'zod';
import {
  CampaignObjective,
  Currency,
  DataSurface,
  EntityStatus,
  SyncStatus,
} from './enums.js';

/**
 * Domain entities as Zod schemas. These are the single source of truth for
 * shapes flowing through the system; DB rows, tRPC payloads, and ingestion
 * outputs all validate against (or derive from) these.
 */

const zEnum = <T extends Record<string, string>>(e: T) =>
  z.enum(Object.values(e) as [string, ...string[]]);

export const AgencySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  createdAt: z.date(),
});
export type Agency = z.infer<typeof AgencySchema>;

export const ClientSchema = z.object({
  id: z.string().uuid(),
  agencyId: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  logoUrl: z.string().url().nullable(),
  /** Accent color used to brand the client's dashboard header. */
  brandColor: z.string().nullable(),
  timezone: z.string().default('UTC'),
  currency: zEnum(Currency).default(Currency.USD),
  createdAt: z.date(),
});
export type Client = z.infer<typeof ClientSchema>;

/** A connected TikTok account (either an ad account or a creator profile). */
export const TikTokAccountSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  surface: zEnum(DataSurface),
  /** TikTok's own identifier (advertiser_id for paid, open_id for organic). */
  externalId: z.string().min(1),
  displayName: z.string(),
  username: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  status: zEnum(EntityStatus).default(EntityStatus.Active),
  connectedAt: z.date(),
});
export type TikTokAccount = z.infer<typeof TikTokAccountSchema>;

export const CampaignSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  externalId: z.string(),
  name: z.string(),
  objective: zEnum(CampaignObjective),
  status: zEnum(EntityStatus),
  dailyBudget: z.number().nonnegative().nullable(),
  createdAt: z.date(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

/** An organic video/post. */
export const VideoSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  externalId: z.string(),
  caption: z.string(),
  thumbnailUrl: z.string().url().nullable(),
  shareUrl: z.string().url().nullable(),
  durationSec: z.number().nonnegative(),
  publishedAt: z.date(),
});
export type Video = z.infer<typeof VideoSchema>;

/**
 * A single day of paid performance for one campaign. This is the atomic fact
 * row for the paid surface; everything on the dashboard rolls up from here.
 */
export const PaidDailyMetricSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  campaignId: z.string().uuid(),
  spend: z.number().nonnegative(),
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
  conversionValue: z.number().nonnegative(),
  videoViews: z.number().int().nonnegative(),
});
export type PaidDailyMetric = z.infer<typeof PaidDailyMetricSchema>;

/** A single day of organic performance for one video. */
export const OrganicDailyMetricSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  videoId: z.string().uuid(),
  views: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  shares: z.number().int().nonnegative(),
  /** Total seconds watched across all viewers — powers avg watch time. */
  watchTimeSec: z.number().nonnegative(),
  reach: z.number().int().nonnegative(),
  newFollowers: z.number().int(),
});
export type OrganicDailyMetric = z.infer<typeof OrganicDailyMetricSchema>;

export const SyncRunSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  surface: zEnum(DataSurface),
  status: zEnum(SyncStatus),
  windowStart: z.string(),
  windowEnd: z.string(),
  rowsIngested: z.number().int().nonnegative(),
  error: z.string().nullable(),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
});
export type SyncRun = z.infer<typeof SyncRunSchema>;
