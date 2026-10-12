import { toIsoDate } from '@tempo/core';

/**
 * The "today" the dashboard anchors its date windows to.
 *
 * This was a frozen literal ('2026-07-19') left over from the demo seed, which
 * pinned every preset window to a date in July. However current the ingest was,
 * the dashboard's 30d window still ended 19 Jul — a live GMV Max brand like
 * Chocomory, synced through yesterday, appeared to stop dead two months ago.
 *
 * It is now the real current date, which is what the original comment said a
 * live deployment should use. Deliberately a function, not a module-level
 * `const`: a const is evaluated once when the module is first loaded, so a
 * long-running server would freeze the anchor at its own start date and drift
 * silently the longer it stayed up.
 *
 * Anchoring to the real date rather than to `max(date)` in the data is also on
 * purpose — a window that ends today shows an ingest lag as missing trailing
 * days, where anchoring to the last row present would hide it.
 */
export function dashboardAnchorDate(): string {
  return toIsoDate(new Date());
}

export const RANGE_PRESETS = [
  { label: '7D', value: '7d' },
  { label: '28D', value: '28d' },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
] as const;

export type RangePresetValue = (typeof RANGE_PRESETS)[number]['value'];

export const SURFACE_FILTERS = [
  { label: 'Overview', value: 'both' },
  { label: 'Paid', value: 'paid' },
  { label: 'Organic', value: 'organic' },
] as const;

export type SurfaceFilter = (typeof SURFACE_FILTERS)[number]['value'];
