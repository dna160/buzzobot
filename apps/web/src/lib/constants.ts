/**
 * The "today" the dashboard anchors its date windows to. The demo seed
 * populates a 90-day window ending on this date, so anchoring here guarantees
 * the dashboard always renders populated data. In a live deployment this would
 * be the actual current date (e.g. `toIsoDate(new Date())`).
 */
export const DASHBOARD_ANCHOR_DATE = '2026-07-19';

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
