import { and, asc, eq } from 'drizzle-orm';
import { deltaPct } from '@tempo/core';
import type { Database } from '../client.js';
import { adgroups, campaigns, paidHourlyMetrics, tiktokAccounts } from '../schema.js';
import type { ClientSummary } from './dashboard.js';

/**
 * Intraday read-model.
 *
 * Two rules govern everything here:
 *
 *  1. Ratios (CTR/CPC/CPM/CPV) are always derived from summed totals, never
 *     averaged across hours — averaging a ratio weights a quiet 3am hour the
 *     same as a peak evening hour and silently misstates the day.
 *
 *  2. Buckets with `spanHours > 1` are NOT hours. They are the first synced
 *     bucket of a day, carrying everything accumulated since midnight. They
 *     count toward day totals but are excluded from every hour-by-hour series
 *     and comparison, and are reported separately so the UI can say so.
 */

export interface HourPoint {
  hour: number;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  videoViews: number;
  engagements: number;
  /** Derived. Null when the denominator is zero — never a fake 0. */
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpv: number | null;
}

export interface Totals {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  videoViews: number;
  engagements: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpv: number | null;
}

export interface PacingPoint {
  hour: number;
  /** Cumulative spend through end of this hour. */
  cumulative: number;
  /** Share of the day's observed spend delivered by end of this hour (0..1). */
  share: number;
  /** Where an even hourly pace would sit by now, over observed hours (0..1). */
  evenShare: number;
}

export interface AdgroupBreakdown {
  id: string;
  name: string;
  totals: Totals;
  hours: HourPoint[];
}

export interface CampaignBreakdown {
  id: string;
  name: string;
  objective: string;
  totals: Totals;
  hours: HourPoint[];
  adgroups: AdgroupBreakdown[];
}

export interface DayOverDaySeries {
  date: string;
  points: HourPoint[];
}

export interface Coverage {
  firstHour: number | null;
  lastHour: number | null;
  /**
   * Buckets that absorb earlier hours, with how many hours each stands for.
   * A span of 2 at hour 01 only absorbs the (always empty) hour 00 and is
   * immaterial; a span of 21 at hour 20 is most of a day. Callers decide what
   * is worth surfacing — the read-model excludes them from hourly series
   * either way.
   */
  aggregatedHours: Array<{ hour: number; spanHours: number }>;
  /** True when the day's observed hours run to 23. */
  isComplete: boolean;
}

/**
 * Like-for-like comparison against the previous day.
 *
 * Restricted to the hours the selected day actually has, so a day synced only
 * through 11:00 is compared against the *same* 11 hours yesterday rather than
 * against yesterday's full 24 — which would read as a catastrophic decline.
 */
export interface Comparison {
  date: string;
  hoursMatched: number[];
  /** Selected day's totals over the matched hours only. */
  current: Totals;
  /** Previous day's totals over the same hours. */
  previous: Totals;
  /** Fractional change per metric; null when there's no baseline. */
  deltas: {
    spend: number | null;
    impressions: number | null;
    clicks: number | null;
    ctr: number | null;
    cpc: number | null;
    cpm: number | null;
  };
}

export interface HourlyDashboardData {
  client: ClientSummary;
  availableDates: string[];
  date: string;
  coverage: Coverage;
  /** Day totals, including any aggregated bucket (so spend reconciles). */
  totals: Totals;
  /** Same-hours comparison to the previous day, when there is one. */
  comparison: Comparison | null;
  /** True-hour series for the whole account on the selected date. */
  hours: HourPoint[];
  pacing: PacingPoint[];
  /** Same-hour comparison across every date that has data. */
  dayOverDay: DayOverDaySeries[];
  campaigns: CampaignBreakdown[];
}

// --- helpers ----------------------------------------------------------------

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

/** Percentage change between two derived ratios, either of which may be null. */
const ratioDelta = (current: number | null, previous: number | null): number | null =>
  current === null || previous === null ? null : deltaPct(current, previous);

interface Raw {
  date: string;
  hour: number;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  videoViews: number;
  engagements: number;
  spanHours: number;
  campaignId: string;
  campaignName: string;
  campaignObjective: string;
  adgroupId: string | null;
  adgroupName: string | null;
}

const zero = (): Omit<Totals, 'ctr' | 'cpc' | 'cpm' | 'cpv'> => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  reach: 0,
  videoViews: 0,
  engagements: 0,
});

function add(acc: ReturnType<typeof zero>, r: Raw): void {
  acc.spend += r.spend;
  acc.impressions += r.impressions;
  acc.clicks += r.clicks;
  acc.reach += r.reach;
  acc.videoViews += r.videoViews;
  acc.engagements += r.engagements;
}

function finish(acc: ReturnType<typeof zero>): Totals {
  return {
    ...acc,
    ctr: ratio(acc.clicks, acc.impressions),
    cpc: ratio(acc.spend, acc.clicks),
    cpm: acc.impressions > 0 ? (acc.spend / acc.impressions) * 1000 : null,
    cpv: ratio(acc.spend, acc.videoViews),
  };
}

const totalsOf = (rows: readonly Raw[]): Totals => {
  const acc = zero();
  for (const r of rows) add(acc, r);
  return finish(acc);
};

/** Build a true-hour series (span_hours === 1 only), sorted by hour. */
function hourSeries(rows: readonly Raw[]): HourPoint[] {
  const byHour = new Map<number, ReturnType<typeof zero>>();
  for (const r of rows) {
    if (r.spanHours !== 1) continue;
    let acc = byHour.get(r.hour);
    if (!acc) {
      acc = zero();
      byHour.set(r.hour, acc);
    }
    add(acc, r);
  }
  return [...byHour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, acc]) => ({ hour, ...finish(acc) }));
}

/**
 * Cumulative burn against an even-pace baseline.
 *
 * The baseline is spread over the hours actually observed, not a fixed 24, so
 * a partially-synced day isn't scored against a full day it never had.
 */
function pacingOf(hours: readonly HourPoint[]): PacingPoint[] {
  const total = hours.reduce((s, h) => s + h.spend, 0);
  const n = hours.length;
  let running = 0;
  return hours.map((h, i) => {
    running += h.spend;
    return {
      hour: h.hour,
      cumulative: running,
      share: total > 0 ? running / total : 0,
      evenShare: n > 0 ? (i + 1) / n : 0,
    };
  });
}

// --- query ------------------------------------------------------------------

async function fetchRows(db: Database, clientId: string, date?: string): Promise<Raw[]> {
  const where = date
    ? and(eq(tiktokAccounts.clientId, clientId), eq(paidHourlyMetrics.date, date))
    : eq(tiktokAccounts.clientId, clientId);

  return db
    .select({
      date: paidHourlyMetrics.date,
      hour: paidHourlyMetrics.hour,
      spend: paidHourlyMetrics.spend,
      impressions: paidHourlyMetrics.impressions,
      clicks: paidHourlyMetrics.clicks,
      reach: paidHourlyMetrics.reach,
      videoViews: paidHourlyMetrics.videoViews,
      engagements: paidHourlyMetrics.engagements,
      spanHours: paidHourlyMetrics.spanHours,
      campaignId: paidHourlyMetrics.campaignId,
      campaignName: campaigns.name,
      campaignObjective: campaigns.objective,
      adgroupId: paidHourlyMetrics.adgroupId,
      adgroupName: adgroups.name,
    })
    .from(paidHourlyMetrics)
    .innerJoin(campaigns, eq(paidHourlyMetrics.campaignId, campaigns.id))
    .innerJoin(tiktokAccounts, eq(campaigns.accountId, tiktokAccounts.id))
    .leftJoin(adgroups, eq(paidHourlyMetrics.adgroupId, adgroups.id))
    .where(where)
    .orderBy(asc(paidHourlyMetrics.date), asc(paidHourlyMetrics.hour));
}

/** Dates that have intraday data, newest last. */
export async function listHourlyDates(db: Database, clientId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ date: paidHourlyMetrics.date })
    .from(paidHourlyMetrics)
    .innerJoin(campaigns, eq(paidHourlyMetrics.campaignId, campaigns.id))
    .innerJoin(tiktokAccounts, eq(campaigns.accountId, tiktokAccounts.id))
    .where(eq(tiktokAccounts.clientId, clientId))
    .orderBy(asc(paidHourlyMetrics.date));
  return rows.map((r) => r.date);
}

export async function getHourlyDashboard(
  db: Database,
  client: ClientSummary,
  requestedDate?: string,
): Promise<HourlyDashboardData | null> {
  const availableDates = await listHourlyDates(db, client.id);
  if (availableDates.length === 0) return null;

  const date =
    requestedDate && availableDates.includes(requestedDate)
      ? requestedDate
      : availableDates[availableDates.length - 1]!;

  // Everything, so day-over-day doesn't need a second round trip.
  const all = await fetchRows(db, client.id);

  // Campaign-level rows are authoritative for account totals; adgroup rows are
  // a parallel decomposition and must never be summed alongside them.
  const rollup = all.filter((r) => r.adgroupId === null);
  const today = rollup.filter((r) => r.date === date);

  const hours = hourSeries(today);

  const aggregatedHours = [
    ...new Map(
      today
        .filter((r) => r.spanHours > 1)
        .map((r) => [r.hour, { hour: r.hour, spanHours: r.spanHours }] as const),
    ).values(),
  ].sort((a, b) => a.hour - b.hour);
  const observed = [...new Set(today.map((r) => r.hour))].sort((a, b) => a - b);

  const dayOverDay: DayOverDaySeries[] = availableDates.map((d) => ({
    date: d,
    points: hourSeries(rollup.filter((r) => r.date === d)),
  }));

  // Like-for-like comparison: the previous day, restricted to the same hours.
  const prevDate = availableDates[availableDates.indexOf(date) - 1] ?? null;
  let comparison: Comparison | null = null;
  if (prevDate) {
    const todayHours = new Set(hours.map((h) => h.hour));
    const prevRows = rollup.filter(
      (r) => r.date === prevDate && r.spanHours === 1 && todayHours.has(r.hour),
    );
    const prevHours = new Set(prevRows.map((r) => r.hour));
    // Only hours present on BOTH days, so neither side is padded.
    const matched = [...todayHours].filter((h) => prevHours.has(h)).sort((a, b) => a - b);

    if (matched.length > 0) {
      const matchedSet = new Set(matched);
      const cur = totalsOf(
        today.filter((r) => r.spanHours === 1 && matchedSet.has(r.hour)),
      );
      const prv = totalsOf(prevRows.filter((r) => matchedSet.has(r.hour)));
      comparison = {
        date: prevDate,
        hoursMatched: matched,
        current: cur,
        previous: prv,
        deltas: {
          spend: deltaPct(cur.spend, prv.spend),
          impressions: deltaPct(cur.impressions, prv.impressions),
          clicks: deltaPct(cur.clicks, prv.clicks),
          ctr: ratioDelta(cur.ctr, prv.ctr),
          cpc: ratioDelta(cur.cpc, prv.cpc),
          cpm: ratioDelta(cur.cpm, prv.cpm),
        },
      };
    }
  }

  // Campaign → adgroup drill-down for the selected date.
  const campaignIds = [...new Set(today.map((r) => r.campaignId))];
  const adgroupRows = all.filter((r) => r.date === date && r.adgroupId !== null);

  const campaignBreakdowns: CampaignBreakdown[] = campaignIds
    .map((id) => {
      const cRows = today.filter((r) => r.campaignId === id);
      const first = cRows[0]!;
      const agIds = [...new Set(adgroupRows.filter((r) => r.campaignId === id).map((r) => r.adgroupId!))];
      return {
        id,
        name: first.campaignName,
        objective: first.campaignObjective,
        totals: totalsOf(cRows),
        hours: hourSeries(cRows),
        adgroups: agIds
          .map((agId) => {
            const aRows = adgroupRows.filter((r) => r.adgroupId === agId);
            return {
              id: agId,
              name: aRows[0]?.adgroupName ?? agId,
              totals: totalsOf(aRows),
              hours: hourSeries(aRows),
            };
          })
          .sort((a, b) => b.totals.spend - a.totals.spend),
      };
    })
    .sort((a, b) => b.totals.spend - a.totals.spend);

  return {
    client,
    availableDates,
    date,
    coverage: {
      firstHour: observed[0] ?? null,
      lastHour: observed[observed.length - 1] ?? null,
      aggregatedHours,
      isComplete: (observed[observed.length - 1] ?? -1) >= 23,
    },
    totals: totalsOf(today),
    comparison,
    hours,
    pacing: pacingOf(hours),
    dayOverDay,
    campaigns: campaignBreakdowns,
  };
}
