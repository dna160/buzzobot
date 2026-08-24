import {
  METRICS,
  deltaPct,
  formatDelta,
  formatMetricValue,
  type Currency,
  type MetricKey,
} from '@tempo/core';
import type { Totals } from '@tempo/db';

/**
 * The one place a `MetricKey` is resolved against the day-grain brief rollup.
 *
 * `Totals` (`@tempo/db`) and `MetricKey` (`@tempo/core`) were written years
 * apart for different consumers, so this mapping is where they meet. Keeping it
 * in a single total function means a metric that cannot be filled returns
 * `null` — an honest "—" on the slide — rather than `undefined` leaking through
 * a template as "NaN" or "[object Object]".
 *
 * Nothing here computes a ratio. Every value below is read from a `Totals`
 * field that `daily-brief.ts` already derived from summed numerators and
 * denominators, which is the rule that keeps the deck and the dashboard from
 * disagreeing (and, on the engine side, the rule §3.1 of the engine PRD binds
 * every generator to).
 */

const DIRECT: Record<MetricKey, ((t: Totals) => number | null) | null> = {
  spend: (t) => t.spend,
  impressions: (t) => t.impressions,
  clicks: (t) => t.clicks,
  conversions: (t) => t.conversions,
  conversionValue: (t) => t.conversionValue,
  ctr: (t) => t.ctr,
  cpm: (t) => t.cpm,
  cpc: (t) => t.cpc,
  cpa: (t) => t.cpa,
  conversionRate: (t) => t.conversionRate,
  roas: (t) => t.roas,
  videoViews: (t) => t.videoViews,
  videoWatched6s: (t) => t.videoWatched6s,
  engagedView15s: (t) => t.engagedView15s,
  engagements: (t) => t.engagements,
  vtr6s: (t) => t.vtr6s,
  vtr15s: (t) => t.vtr15s,
  frequency: (t) => t.frequency,
  cpv: (t) => t.cpv,
  reach: (t) => t.reach,
  // Organic metrics have no day-grain rollup behind the brief window yet, which
  // is exactly why the catalog marks them `pickerVisible: false`. Listed
  // explicitly as `null` so adding a metric to the catalog without deciding how
  // a deck fills it is a type error, not a silent blank tile.
  views: null,
  likes: null,
  comments: null,
  shares: null,
  newFollowers: null,
  engagementRate: null,
  avgWatchTimeSec: null,
};

/** The window value for a metric, or `null` when this rollup cannot fill it. */
export function metricValue(totals: Totals, metric: MetricKey): number | null {
  const read = DIRECT[metric];
  if (!read) return null;
  const value = read(totals);
  return value === null || Number.isFinite(value) ? value : null;
}

/**
 * Period-over-period change for any metric, computed the same way for all of
 * them. `DailyBriefComparison.deltas` covers only a subset of the catalog, so
 * deriving from `windowTotals` vs `comparison.previous` keeps one rule instead
 * of two — and produces the identical figure for the metrics both cover.
 */
export function metricDelta(
  current: Totals,
  previous: Totals | null | undefined,
  metric: MetricKey,
): number | null {
  if (!previous) return null;
  const now = metricValue(current, metric);
  const before = metricValue(previous, metric);
  if (now === null || before === null) return null;
  return deltaPct(now, before);
}

/** Formatted for display, or an em dash when the metric is not reported. */
export function formatMetric(
  metric: MetricKey,
  value: number | null,
  currency: Currency,
  compact = true,
): string {
  if (value === null) return '—';
  return formatMetricValue(METRICS[metric], value, { currency, compact });
}

export function formatMetricDelta(delta: number | null): string | undefined {
  return delta === null ? undefined : formatDelta(delta);
}
