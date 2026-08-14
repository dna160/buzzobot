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

/**
 * Which figure a client's dashboard and reports are built around. Different
 * brands buy TikTok media for fundamentally different outcomes, so the
 * "headline" metric — and which risks/recommendations even make sense — is
 * not universal:
 *   VTR         — no on-platform outcome exists (e.g. offline FMCG retail);
 *                 view-through rate is the honest proxy for attention earned.
 *   Shop        — real TikTok Shop purchases; conversions and ROAS lead.
 *   AppInstall  — app installs are the buyable outcome; CPI leads.
 */
export const NorthStar = {
  Vtr: 'vtr',
  Shop: 'shop',
  AppInstall: 'app_install',
} as const;
export type NorthStar = (typeof NorthStar)[keyof typeof NorthStar];

/** Currency codes we format for. Extend as the agency onboards new markets. */
export const Currency = {
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  IDR: 'IDR',
  SGD: 'SGD',
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];
