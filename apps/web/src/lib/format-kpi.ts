import { METRICS, formatMetricValue, type Currency, type MetricKey } from '@tempo/core';

/** Format a KPI value using its catalog definition and the client's currency. */
export const formatKpi = (key: MetricKey, value: number, currency: string): string =>
  formatMetricValue(METRICS[key], value, { currency: currency as Currency, compact: true });

/** Short axis/label date: "2026-07-04" -> "Jul 4". */
export const shortDate = (iso: string): string => {
  const [, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m) - 1]} ${Number(d)}`;
};
