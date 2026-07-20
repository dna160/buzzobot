import type { DashboardData, ClientSummary, Database } from '@tempo/db';
import { getDashboard } from '@tempo/db';
import { daysBetween, previousRange, type DateRange } from '@tempo/core';
import { buildInsights, type ReportInsights } from './insights.js';
import { DEFAULT_LOCALE, getCopy, type Locale, type ReportCopy } from './i18n.js';

/**
 * The complete, self-contained model a report is rendered from. It composes the
 * dashboard read-model with auto-generated narrative + a prioritized action
 * plan, plus presentation metadata (labels, timestamps) — all in the requested
 * locale. Pure data + the resolved copy pack the renderer reuses.
 */
export interface ReportModel {
  locale: Locale;
  copy: ReportCopy;
  client: ClientSummary;
  range: DateRange;
  previousRange: DateRange;
  /** Locale-formatted, e.g. "20 Jun – 19 Jul 2026 (30 hari)". */
  periodLabel: string;
  /** Locale-formatted, e.g. "Dibuat 20 Jul 2026 · 14:32 UTC". */
  generatedLabel: string;
  dashboard: DashboardData;
  insights: ReportInsights;
}

const fmtDay = (iso: string, copy: ReportCopy): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const mon = copy.months[(m ?? 1) - 1];
  return copy.dayFirst ? `${d} ${mon} ${y}` : `${mon} ${d}, ${y}`;
};

const fmtRange = (range: DateRange, copy: ReportCopy): string => {
  const [, sm, sd] = range.start.split('-').map(Number);
  const mon = copy.months[(sm ?? 1) - 1];
  const startShort = copy.dayFirst ? `${sd} ${mon}` : `${mon} ${sd}`;
  const days = daysBetween(range.start, range.end);
  return `${startShort} – ${fmtDay(range.end, copy)} (${days} ${copy.daysWord})`;
};

const fmtGenerated = (at: Date, copy: ReportCopy): string => {
  const iso = at.toISOString();
  const [date, time] = iso.split('T');
  return `${copy.generatedPrefix} ${fmtDay(date!, copy)} · ${time!.slice(0, 5)} UTC`;
};

/**
 * Assemble a full report model for a client and window. Reuses the exact same
 * dashboard rollups the UI shows, so the report can never disagree with the
 * live dashboard.
 */
export async function buildReport(
  db: Database,
  client: ClientSummary,
  range: DateRange,
  opts: { generatedAt: Date; locale?: Locale },
): Promise<ReportModel> {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const copy = getCopy(locale);
  const dashboard = await getDashboard(db, client, range);
  const insights = buildInsights(dashboard, copy);
  return {
    locale,
    copy,
    client,
    range,
    previousRange: previousRange(range),
    periodLabel: fmtRange(range, copy),
    generatedLabel: fmtGenerated(opts.generatedAt, copy),
    dashboard,
    insights,
  };
}
