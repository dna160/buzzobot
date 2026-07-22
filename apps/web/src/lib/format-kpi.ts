import { METRICS, formatMetricValue, type Currency, type MetricKey } from '@tempo/core';

/** Format a KPI value using its catalog definition and the client's currency. */
export const formatKpi = (key: MetricKey, value: number, currency: string): string =>
  formatMetricValue(METRICS[key], value, { currency: currency as Currency, compact: true });

/** Hour-of-day label: 9 -> "09:00". */
export const hourLabel = (h: number): string => `${String(h).padStart(2, '0')}:00`;

/** Hour-of-day range label: 9 -> "09:00–10:00". */
export const hourRangeLabel = (h: number): string =>
  `${hourLabel(h)}–${hourLabel((h + 1) % 24)}`;

/**
 * Render a derived ratio that may be unavailable. The read-model returns null
 * when a denominator is zero, which must not be shown as a real 0.
 */
export const orNa = (v: number | null, render: (n: number) => string): string =>
  v === null ? 'n/a' : render(v);

/** Short axis/label date: "2026-07-04" -> "Jul 4". */
export const shortDate = (iso: string): string => {
  const [, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m) - 1]} ${Number(d)}`;
};
