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

/**
 * The three client-facing brief objectives. Lives here rather than in
 * `@tempo/reports` (where it started) because the metric catalog's grading
 * bands and the report spec's allowed-metric sets are both keyed by it, and a
 * domain kernel that cannot name the objective cannot express either.
 * `@tempo/reports` re-exports it, so existing importers are unaffected.
 */
export const BriefObjective = {
  Awareness: 'awareness',
  Gmv: 'gmv',
  Install: 'install',
} as const;
export type BriefObjective = (typeof BriefObjective)[keyof typeof BriefObjective];

/**
 * Which north star each objective is honest for. Presenting one objective's
 * brief against a client configured for a different north star would mislabel
 * real data (installs shown as GMV, or vice versa), so the API route gates on
 * this and the engine's own `build_*_metric_frame` re-checks it independently.
 */
export const OBJECTIVE_NORTH_STAR: Record<BriefObjective, NorthStar> = {
  [BriefObjective.Awareness]: NorthStar.Vtr,
  [BriefObjective.Gmv]: NorthStar.Shop,
  [BriefObjective.Install]: NorthStar.AppInstall,
};

/**
 * The inverse: which objective a client with this north star is really asking
 * for when it asks for "the report". Derived from `OBJECTIVE_NORTH_STAR` rather
 * than written out, so the two can never disagree — a hand-maintained second
 * table is exactly how a client ends up aliased to a deck the brief route then
 * refuses with a 409.
 */
export const NORTH_STAR_OBJECTIVE = Object.fromEntries(
  Object.entries(OBJECTIVE_NORTH_STAR).map(([objective, northStar]) => [northStar, objective]),
) as Record<NorthStar, BriefObjective>;

export function isBriefObjective(value: string): value is BriefObjective {
  return (
    value === BriefObjective.Awareness ||
    value === BriefObjective.Gmv ||
    value === BriefObjective.Install
  );
}
