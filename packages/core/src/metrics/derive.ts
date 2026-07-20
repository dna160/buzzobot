import type { OrganicDailyMetric, PaidDailyMetric } from '../domain/entities.js';

/**
 * Pure metric derivation. Every ratio here guards against divide-by-zero and
 * returns 0 rather than NaN/Infinity so the presentation layer never has to.
 */

const ratio = (numerator: number, denominator: number): number =>
  denominator > 0 ? numerator / denominator : 0;

/** Aggregate paid totals summed across a set of daily fact rows. */
export interface PaidTotals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  videoViews: number;
}

export const emptyPaidTotals = (): PaidTotals => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  conversions: 0,
  conversionValue: 0,
  videoViews: 0,
});

export const sumPaid = (rows: readonly PaidDailyMetric[]): PaidTotals =>
  rows.reduce<PaidTotals>((acc, r) => {
    acc.spend += r.spend;
    acc.impressions += r.impressions;
    acc.clicks += r.clicks;
    acc.conversions += r.conversions;
    acc.conversionValue += r.conversionValue;
    acc.videoViews += r.videoViews;
    return acc;
  }, emptyPaidTotals());

/** Derived paid KPIs computed from totals. */
export interface PaidDerived extends PaidTotals {
  /** Click-through rate (clicks / impressions). */
  ctr: number;
  /** Cost per mille (spend per 1,000 impressions). */
  cpm: number;
  /** Cost per click. */
  cpc: number;
  /** Cost per acquisition (spend / conversions). */
  cpa: number;
  /** Conversion rate (conversions / clicks). */
  conversionRate: number;
  /** Return on ad spend (conversionValue / spend). */
  roas: number;
}

export const derivePaid = (totals: PaidTotals): PaidDerived => ({
  ...totals,
  ctr: ratio(totals.clicks, totals.impressions),
  cpm: ratio(totals.spend, totals.impressions) * 1000,
  cpc: ratio(totals.spend, totals.clicks),
  cpa: ratio(totals.spend, totals.conversions),
  conversionRate: ratio(totals.conversions, totals.clicks),
  roas: ratio(totals.conversionValue, totals.spend),
});

/** Aggregate organic totals summed across a set of daily fact rows. */
export interface OrganicTotals {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchTimeSec: number;
  reach: number;
  newFollowers: number;
}

export const emptyOrganicTotals = (): OrganicTotals => ({
  views: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  watchTimeSec: 0,
  reach: 0,
  newFollowers: 0,
});

export const sumOrganic = (rows: readonly OrganicDailyMetric[]): OrganicTotals =>
  rows.reduce<OrganicTotals>((acc, r) => {
    acc.views += r.views;
    acc.likes += r.likes;
    acc.comments += r.comments;
    acc.shares += r.shares;
    acc.watchTimeSec += r.watchTimeSec;
    acc.reach += r.reach;
    acc.newFollowers += r.newFollowers;
    return acc;
  }, emptyOrganicTotals());

/** Derived organic KPIs computed from totals. */
export interface OrganicDerived extends OrganicTotals {
  /** (likes + comments + shares) / views. */
  engagementRate: number;
  /** Average seconds watched per view. */
  avgWatchTimeSec: number;
  /** Views that came from accounts not yet following (reach proxy). */
  reachRate: number;
}

export const deriveOrganic = (totals: OrganicTotals): OrganicDerived => ({
  ...totals,
  engagementRate: ratio(totals.likes + totals.comments + totals.shares, totals.views),
  avgWatchTimeSec: ratio(totals.watchTimeSec, totals.views),
  reachRate: ratio(totals.reach, totals.views),
});

/**
 * Percentage change between two values, expressed as a fraction
 * (e.g. 0.25 = +25%). Returns null when there's no prior baseline to compare
 * against, so the UI can render "—" instead of a misleading "+100%".
 */
export const deltaPct = (current: number, previous: number): number | null => {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
};
