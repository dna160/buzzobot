import type { CampaignObjective, DataSurface, EntityStatus, NorthStar } from '@tempo/core';
import type { DateRange } from '@tempo/core';

/**
 * Provider-facing DTOs. These mirror the *normalized* shape the ingestion
 * layer expects — each concrete provider (live API or fixtures) is responsible
 * for translating TikTok's raw responses into these. Downstream code depends
 * only on this contract, never on TikTok's wire format.
 */

export interface AccountDTO {
  surface: DataSurface;
  /** advertiser_id (paid) or open_id (organic). */
  externalId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  status: EntityStatus;
}

export interface CampaignDTO {
  externalId: string;
  name: string;
  objective: CampaignObjective;
  status: EntityStatus;
  dailyBudget: number | null;
}

export interface PaidMetricDTO {
  date: string;
  campaignExternalId: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  videoViews: number;
}

export interface AdgroupDTO {
  externalId: string;
  campaignExternalId: string;
  name: string;
  status: EntityStatus;
}

/**
 * An intraday fact. `adgroupExternalId === null` is the campaign-level rollup
 * as reported by TikTok, which is authoritative for campaign totals and is not
 * the sum of its adgroups (reach dedupes; sync cutoffs differ).
 */
export interface PaidHourlyMetricDTO {
  date: string;
  /** 0..23 in the advertiser's own timezone. */
  hour: number;
  campaignExternalId: string;
  adgroupExternalId: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  videoViews: number;
  /** 6-second video views (`video_watched_6s`): numerator for VTR6s. */
  videoWatched6s: number;
  /** 15-second engaged views (`engaged_view_15s`): numerator for VTR15s. */
  engagedView15s: number;
  engagements: number;
  likes: number;
  comments: number;
  shares: number;
  follows: number;
  profileVisits: number;
  /** The platform-reported primary conversion event — see HourBucket. */
  conversions: number;
  /** Revenue/value attached to `conversions`, when the source reports one. */
  conversionValue: number;
  /** >1 when this bucket absorbs earlier unsynced hours; not a true hour. */
  spanHours: number;
}

export interface VideoDTO {
  externalId: string;
  caption: string;
  thumbnailUrl: string | null;
  shareUrl: string | null;
  durationSec: number;
  publishedAt: Date;
}

export interface OrganicMetricDTO {
  date: string;
  videoExternalId: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchTimeSec: number;
  reach: number;
  newFollowers: number;
}

/**
 * The single interface the rest of the system programs against. Swapping live
 * TikTok data for fixtures is a one-line factory change — nothing else moves.
 */
/** Tenant identity a provider can declare, overriding the bootstrap default. */
export interface TenantDTO {
  clientName: string;
  clientSlug: string;
  agencyName: string;
  agencySlug: string;
  currency: string;
  timezone: string;
  brandColor: string | null;
  /** Which figure this client's dashboard/reports are built around. */
  northStar: NorthStar;
}

export interface TikTokDataProvider {
  /** Human name for logs / observability (e.g. "live", "fixture"). */
  readonly name: string;
  /** Which surfaces this provider can serve. */
  readonly surfaces: readonly DataSurface[];

  listAccounts(): Promise<AccountDTO[]>;

  // --- Paid surface (TikTok Business / Marketing API) ---
  listCampaigns(advertiserId: string): Promise<CampaignDTO[]>;
  getPaidDailyMetrics(advertiserId: string, range: DateRange): Promise<PaidMetricDTO[]>;

  // --- Organic surface (TikTok Display / Content API) ---
  listVideos(openId: string): Promise<VideoDTO[]>;
  getOrganicDailyMetrics(openId: string, range: DateRange): Promise<OrganicMetricDTO[]>;

  // --- Intraday (optional) -------------------------------------------------
  // Only providers backed by an hourly source implement these. The pipeline
  // feature-detects them, so daily-only providers are unaffected.

  /** The tenant this provider's data belongs to, if it knows. */
  describeTenant?(): TenantDTO;
  /**
   * The date span this provider actually holds data for, if it is bounded.
   * May be async — a provider backed by a live query cannot answer this
   * synchronously the way a provider backed by a file on disk can.
   */
  describeRange?(): DateRange | null | Promise<DateRange | null>;
  listAdgroups?(advertiserId: string): Promise<AdgroupDTO[]>;
  getPaidHourlyMetrics?(advertiserId: string, range: DateRange): Promise<PaidHourlyMetricDTO[]>;
}
