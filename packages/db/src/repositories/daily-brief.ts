import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { deltaPct } from '@tempo/core';
import type { Database } from '../client.js';
import { campaigns, paidHourlyMetrics, tiktokAccounts } from '../schema.js';
import type { ClientSummary } from './dashboard.js';
import type { Totals } from './hourly.js';

/**
 * Day-grain read-model for the objective-specific "brief" reports (Awareness,
 * GMV, Install) — rolls `paidHourlyMetrics` up by calendar day over a
 * multi-day window, the same way `hourly.ts` rolls it up by hour over a
 * single day. Reach is required by all three briefs and only exists at the
 * hourly grain (see `hourly.ts`'s own module note), so it's summed across a
 * day's hourly rows the same way that file already does it — not deduped,
 * the accepted convention for this schema.
 *
 * Ratios are always derived from summed totals, matching the rule in
 * `hourly.ts` — never averaged across days.
 */

export interface DayPoint {
  date: string;
  totals: Totals;
}

export interface CampaignWindowRow {
  id: string;
  name: string;
  objective: string;
  totals: Totals;
}

/** Like-for-like comparison against the immediately preceding window of the same length. */
export interface DailyBriefComparison {
  firstDate: string;
  lastDate: string;
  previous: Totals;
  deltas: {
    impressions: number | null;
    reach: number | null;
    vtr6s: number | null;
    vtr15s: number | null;
    spend: number | null;
    clicks: number | null;
    ctr: number | null;
    cpc: number | null;
    cpm: number | null;
    conversions: number | null;
    cpa: number | null;
    roas: number | null;
  };
}

export interface DailyBriefDashboardData {
  client: ClientSummary;
  days: DayPoint[];
  windowTotals: Totals;
  comparison: DailyBriefComparison | null;
  campaigns: CampaignWindowRow[];
}

// --- helpers (mirrors hourly.ts's day-grain-equivalent aggregation) --------

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);
const ratioDelta = (current: number | null, previous: number | null): number | null =>
  current === null || previous === null ? null : deltaPct(current, previous);

interface Raw {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  videoViews: number;
  videoWatched6s: number;
  engagedView15s: number;
  engagements: number;
  conversions: number;
  conversionValue: number;
  campaignId: string;
  campaignName: string;
  campaignObjective: string;
}

type Acc = Omit<
  Totals,
  'ctr' | 'cpc' | 'cpm' | 'cpv' | 'vtr6s' | 'vtr15s' | 'frequency' | 'cpa' | 'conversionRate' | 'roas'
>;

const zero = (): Acc => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  reach: 0,
  videoViews: 0,
  videoWatched6s: 0,
  engagedView15s: 0,
  engagements: 0,
  conversions: 0,
  conversionValue: 0,
});

function add(acc: Acc, r: Raw): void {
  acc.spend += r.spend;
  acc.impressions += r.impressions;
  acc.clicks += r.clicks;
  acc.reach += r.reach;
  acc.videoViews += r.videoViews;
  acc.videoWatched6s += r.videoWatched6s;
  acc.engagedView15s += r.engagedView15s;
  acc.engagements += r.engagements;
  acc.conversions += r.conversions;
  acc.conversionValue += r.conversionValue;
}

function finish(acc: Acc): Totals {
  return {
    ...acc,
    vtr6s: ratio(acc.videoWatched6s, acc.impressions),
    vtr15s: ratio(acc.engagedView15s, acc.impressions),
    frequency: ratio(acc.impressions, acc.reach),
    ctr: ratio(acc.clicks, acc.impressions),
    cpc: ratio(acc.spend, acc.clicks),
    cpm: acc.impressions > 0 ? (acc.spend / acc.impressions) * 1000 : null,
    cpv: ratio(acc.spend, acc.videoViews),
    cpa: ratio(acc.spend, acc.conversions),
    conversionRate: ratio(acc.conversions, acc.clicks),
    roas: acc.spend > 0 && acc.conversionValue > 0 ? acc.conversionValue / acc.spend : null,
  };
}

const totalsOf = (rows: readonly Raw[]): Totals => {
  const acc = zero();
  for (const r of rows) add(acc, r);
  return finish(acc);
};

function daySeries(rows: readonly Raw[]): DayPoint[] {
  const byDate = new Map<string, Acc>();
  for (const r of rows) {
    let acc = byDate.get(r.date);
    if (!acc) {
      acc = zero();
      byDate.set(r.date, acc);
    }
    add(acc, r);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, acc]) => ({ date, totals: finish(acc) }));
}

// --- query ------------------------------------------------------------------

/** Campaign-level rows only (`adgroup_id IS NULL`) — the authoritative
 * account rollup; adgroup rows are a parallel decomposition and must never
 * be summed alongside them (same rule `hourly.ts` and the GMV/Awareness/
 * Install engine adapters all follow). */
async function fetchRollupRows(db: Database, clientId: string, start?: string, end?: string): Promise<Raw[]> {
  const conditions = [eq(tiktokAccounts.clientId, clientId), isNull(paidHourlyMetrics.adgroupId)];
  if (start) conditions.push(gte(paidHourlyMetrics.date, start));
  if (end) conditions.push(lte(paidHourlyMetrics.date, end));

  return db
    .select({
      date: paidHourlyMetrics.date,
      spend: paidHourlyMetrics.spend,
      impressions: paidHourlyMetrics.impressions,
      clicks: paidHourlyMetrics.clicks,
      reach: paidHourlyMetrics.reach,
      videoViews: paidHourlyMetrics.videoViews,
      videoWatched6s: paidHourlyMetrics.videoWatched6s,
      engagedView15s: paidHourlyMetrics.engagedView15s,
      engagements: paidHourlyMetrics.engagements,
      conversions: paidHourlyMetrics.conversions,
      conversionValue: paidHourlyMetrics.conversionValue,
      campaignId: paidHourlyMetrics.campaignId,
      campaignName: campaigns.name,
      campaignObjective: campaigns.objective,
    })
    .from(paidHourlyMetrics)
    .innerJoin(campaigns, eq(paidHourlyMetrics.campaignId, campaigns.id))
    .innerJoin(tiktokAccounts, eq(campaigns.accountId, tiktokAccounts.id))
    .where(and(...conditions))
    .orderBy(asc(paidHourlyMetrics.date));
}

/** Dates that have day-grain (campaign-rollup) data, newest last. */
export async function listDailyBriefDates(db: Database, clientId: string): Promise<string[]> {
  const rows = await fetchRollupRows(db, clientId);
  return [...new Set(rows.map((r) => r.date))].sort();
}

export async function getDailyBriefDashboard(
  db: Database,
  client: ClientSummary,
  opts: { endDate?: string; windowDays?: number } = {},
): Promise<DailyBriefDashboardData | null> {
  const windowDays = opts.windowDays ?? 7;
  const availableDates = await listDailyBriefDates(db, client.id);
  if (availableDates.length === 0) return null;

  const target = opts.endDate && availableDates.includes(opts.endDate) ? opts.endDate : availableDates[availableDates.length - 1]!;
  const candidates = availableDates.filter((d) => d <= target);
  const lastDate = candidates[candidates.length - 1] ?? availableDates[availableDates.length - 1]!;
  const windowDates = candidates.slice(-windowDays);
  const firstDate = windowDates[0] ?? lastDate;

  const windowRows = await fetchRollupRows(db, client.id, firstDate, lastDate);
  const days = daySeries(windowRows);
  const windowTotals = totalsOf(windowRows);

  // Previous window of the same length, immediately before this one.
  const priorCandidates = availableDates.filter((d) => d < firstDate);
  const priorWindowDates = priorCandidates.slice(-windowDays);
  let comparison: DailyBriefComparison | null = null;
  if (priorWindowDates.length > 0) {
    const priorFirst = priorWindowDates[0]!;
    const priorLast = priorWindowDates[priorWindowDates.length - 1]!;
    const priorRows = await fetchRollupRows(db, client.id, priorFirst, priorLast);
    const prv = totalsOf(priorRows);
    comparison = {
      firstDate: priorFirst,
      lastDate: priorLast,
      previous: prv,
      deltas: {
        impressions: deltaPct(windowTotals.impressions, prv.impressions),
        reach: deltaPct(windowTotals.reach, prv.reach),
        vtr6s: ratioDelta(windowTotals.vtr6s, prv.vtr6s),
        vtr15s: ratioDelta(windowTotals.vtr15s, prv.vtr15s),
        spend: deltaPct(windowTotals.spend, prv.spend),
        clicks: deltaPct(windowTotals.clicks, prv.clicks),
        ctr: ratioDelta(windowTotals.ctr, prv.ctr),
        cpc: ratioDelta(windowTotals.cpc, prv.cpc),
        cpm: ratioDelta(windowTotals.cpm, prv.cpm),
        conversions: deltaPct(windowTotals.conversions, prv.conversions),
        cpa: ratioDelta(windowTotals.cpa, prv.cpa),
        roas: ratioDelta(windowTotals.roas, prv.roas),
      },
    };
  }

  const campaignIds = [...new Set(windowRows.map((r) => r.campaignId))];
  const campaignRows: CampaignWindowRow[] = campaignIds
    .map((id) => {
      const rows = windowRows.filter((r) => r.campaignId === id);
      const first = rows[0]!;
      return { id, name: first.campaignName, objective: first.campaignObjective, totals: totalsOf(rows) };
    })
    .sort((a, b) => b.totals.spend - a.totals.spend);

  return {
    client,
    days,
    windowTotals,
    comparison,
    campaigns: campaignRows,
  };
}
