import type { CampaignObjective, DataSurface, EntityStatus } from '@tempo/core';
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
}
