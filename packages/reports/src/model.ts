import type { DashboardData, ClientSummary, Database } from '@tempo/db';
import { getDashboard } from '@tempo/db';
import { daysBetween, previousRange, type DateRange } from '@tempo/core';
import { buildInsights, type ReportInsights } from './insights.js';

/**
 * The complete, self-contained model a report is rendered from. It composes the
 * dashboard read-model with auto-generated narrative + a prioritized action
 * plan, plus presentation metadata (labels, timestamps). Pure data — the
 * renderer turns this into HTML, and the PDF layer turns that into a document.
 */
export interface ReportModel {
  client: ClientSummary;
  range: DateRange;
  previousRange: DateRange;
  /** e.g. "Jun 20 – Jul 19, 2026 (30 days)". */
  periodLabel: string;
  /** e.g. "Generated Jul 20, 2026, 14:32 UTC". */
  generatedLabel: string;
  dashboard: DashboardData;
  insights: ReportInsights;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmtDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
};

const fmtRange = (range: DateRange): string => {
  const [, sm, sd] = range.start.split('-').map(Number);
  const days = daysBetween(range.start, range.end);
  return `${MONTHS[(sm ?? 1) - 1]} ${sd} – ${fmtDay(range.end)} (${days} days)`;
};

const fmtGenerated = (at: Date): string => {
  const iso = at.toISOString();
  const [date, time] = iso.split('T');
  const [y, m, d] = date!.split('-').map(Number);
  return `Generated ${MONTHS[(m ?? 1) - 1]} ${d}, ${y} · ${time!.slice(0, 5)} UTC`;
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
  opts: { generatedAt: Date },
): Promise<ReportModel> {
  const dashboard = await getDashboard(db, client, range);
  const insights = buildInsights(dashboard);
  return {
    client,
    range,
    previousRange: previousRange(range),
    periodLabel: fmtRange(range),
    generatedLabel: fmtGenerated(opts.generatedAt),
    dashboard,
    insights,
  };
}
