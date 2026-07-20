/**
 * Canonical enumerations shared across ingestion, storage, and presentation.
 * Keeping these centralized prevents string-literal drift between layers.
 */

/** Which TikTok surface a metric or entity originates from. */
export const DataSurface = {
  /** Paid advertising — TikTok Business / Marketing API. */
  Paid: 'paid',
  /** Organic content — TikTok Display / Content Posting API. */
  Organic: 'organic',
} as const;
export type DataSurface = (typeof DataSurface)[keyof typeof DataSurface];

/** Lifecycle status normalized across paid entities. */
export const EntityStatus = {
  Active: 'active',
  Paused: 'paused',
  Deleted: 'deleted',
  Pending: 'pending',
} as const;
export type EntityStatus = (typeof EntityStatus)[keyof typeof EntityStatus];

/** TikTok campaign objectives, normalized to a stable internal set. */
export const CampaignObjective = {
  Reach: 'reach',
  Traffic: 'traffic',
  VideoViews: 'video_views',
  Engagement: 'engagement',
  AppPromotion: 'app_promotion',
  LeadGeneration: 'lead_generation',
  WebConversions: 'web_conversions',
  ProductSales: 'product_sales',
} as const;
export type CampaignObjective = (typeof CampaignObjective)[keyof typeof CampaignObjective];

/** State of an ingestion run, used for observability and idempotency. */
export const SyncStatus = {
  Queued: 'queued',
  Running: 'running',
  Succeeded: 'succeeded',
  Failed: 'failed',
  PartiallyFailed: 'partially_failed',
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

/** Currency codes we format for. Extend as the agency onboards new markets. */
export const Currency = {
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  IDR: 'IDR',
  SGD: 'SGD',
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];
