import type { Currency } from '../domain/enums.js';
import type { MetricDef, MetricFormat } from '../metrics/catalog.js';

/**
 * Presentation formatters. These are locale-aware and deterministic so the
 * server and client render identical strings (avoids hydration mismatches).
 */

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const plainNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const currencyFormatter = (currency: Currency, precision: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    // 'narrowSymbol' renders the local symbol (IDR → "Rp", USD → "$") instead of
    // the ISO code the en-US default would print for non-USD currencies ("IDR").
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });

/** Compact currency for KPI tiles: $12.4K, $1.2M. Falls back to full below 10k. */
export const formatCurrencyCompact = (value: number, currency: Currency): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs < 10_000) return currencyFormatter(currency, abs % 1 === 0 ? 0 : 2).format(value);
  const symbol = currencyFormatter(currency, 0).format(0).replace(/[\d.,\s]/g, '');
  return `${sign}${symbol}${compactNumber.format(abs)}`;
};

/** Compact number for tiles: 12.4K, 3.1M. */
export const formatNumberCompact = (value: number): string =>
  Math.abs(value) < 1000 ? plainNumber.format(value) : compactNumber.format(value);

/** Percent from a fraction: 0.0234 -> "2.34%". */
export const formatPercent = (fraction: number, precision = 2): string =>
  `${(fraction * 100).toFixed(precision)}%`;

/** Ratio like ROAS: 3.2 -> "3.20x". */
export const formatRatio = (value: number, precision = 2): string =>
  `${value.toFixed(precision)}x`;

/** Seconds -> "1m 05s" or "42.5s". */
export const formatDuration = (seconds: number, precision = 1): string => {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  }
  return `${seconds.toFixed(precision)}s`;
};

/** Signed percent for deltas: 0.123 -> "+12.3%", -0.05 -> "-5.0%". */
export const formatDelta = (fraction: number | null, precision = 1): string => {
  if (fraction === null) return '—';
  const sign = fraction > 0 ? '+' : '';
  return `${sign}${(fraction * 100).toFixed(precision)}%`;
};

interface FormatValueOptions {
  currency?: Currency;
  compact?: boolean;
}

/**
 * Format a raw metric value using its catalog definition. This is the one
 * function the UI calls — it never needs to know a metric's format itself.
 */
export const formatMetricValue = (
  metric: Pick<MetricDef, 'format' | 'precision'>,
  value: number,
  opts: FormatValueOptions = {},
): string => {
  const { currency = 'USD', compact = true } = opts;
  return formatByType(metric.format, value, {
    precision: metric.precision,
    currency,
    compact,
  });
};

const formatByType = (
  format: MetricFormat,
  value: number,
  { precision, currency, compact }: { precision?: number; currency: Currency; compact: boolean },
): string => {
  switch (format) {
    case 'currency':
      return compact
        ? formatCurrencyCompact(value, currency)
        : currencyFormatter(currency, precision ?? 2).format(value);
    case 'number':
      return compact ? formatNumberCompact(value) : plainNumber.format(value);
    case 'percent':
      return formatPercent(value, precision ?? 2);
    case 'ratio':
      return formatRatio(value, precision ?? 2);
    case 'duration':
      return formatDuration(value, precision ?? 1);
    default:
      return String(value);
  }
};
