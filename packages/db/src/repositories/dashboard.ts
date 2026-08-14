import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import {
  type DateRange,
  type MetricKey,
  type NorthStar,
  METRICS,
  derivePaid,
  deriveOrganic,
  deltaPct,
  emptyOrganicTotals,
  emptyPaidTotals,
  previousRange,
  sumOrganic,
  sumPaid,
  type OrganicDailyMetric,
  type PaidDailyMetric,
} from '@tempo/core';
import type { Database } from '../client.js';
import {
  campaigns,
  clients,
  organicDailyMetrics,
  paidDailyMetrics,
  tiktokAccounts,
  videos,
} from '../schema.js';

/**
 * Read-models for the client dashboard. Queries pull the raw daily facts for
 * the selected window (and the preceding one for deltas) and roll them up in
 * TypeScript via the shared, unit-tested derivation kernel — so the numbers a
 * client sees are computed by exactly the same code as the metric tests.
 */

export interface ClientSummary {
  id: string;
  name: string;
  slug: string;
  brandColor: string | null;
  currency: string;
  timezone: string;
  /** Which figure this client's dashboard/reports are built around. */
  northStar: NorthStar;
}

export interface KpiCard {
  key: MetricKey;
  label: string;
  value: number;
  /** Period-over-period change as a fraction, or null if no baseline. */
  delta: number | null;
  /** Whether a positive delta is favorable (drives coloring). */
  goodDirection: 'up' | 'down' | 'neutral';
  /** Per-day values across the window for the tile's sparkline. */
  sparkline: number[];
}

export interface TimeseriesPoint {
  date: string;
  spend: number;
  roas: number;
  conversions: number;
  clicks: number;
  views: number;
  engagementRate: number;
  newFollowers: number;
}

export interface CampaignRow {
  id: string;
  name: string;
  objective: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  cpa: number;
  roas: number;
}

export interface VideoRow {
  id: string;
  caption: string;
  shareUrl: string | null;
  publishedAt: string;
  views: number;
  likes: number;
  engagementRate: number;
  avgWatchTimeSec: number;
  shares: number;
}

export interface DashboardData {
  client: ClientSummary;
  range: DateRange;
  paidKpis: KpiCard[];
  organicKpis: KpiCard[];
  timeseries: TimeseriesPoint[];
  campaigns: CampaignRow[];
  topVideos: VideoRow[];
  hasPaid: boolean;
  hasOrganic: boolean;
}

export async function getClientBySlug(
  db: Database,
  slug: string,
): Promise<ClientSummary | null> {
  const [row] = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      brandColor: clients.brandColor,
      currency: clients.currency,
      timezone: clients.timezone,
      northStar: clients.northStar,
    })
    .from(clients)
    .where(eq(clients.slug, slug))
    .limit(1);
  // clients.northStar is a plain text column at the storage layer (so an
  // unrecognized value degrades gracefully instead of failing a write); the
  // narrower NorthStar union is the application-level contract.
  return (row as ClientSummary | undefined) ?? null;
}

export async function listClients(db: Database): Promise<ClientSummary[]> {
  return db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      brandColor: clients.brandColor,
      currency: clients.currency,
      timezone: clients.timezone,
      northStar: clients.northStar,
    })
    .from(clients)
    .orderBy(asc(clients.name)) as unknown as Promise<ClientSummary[]>;
}

// --- Raw fact fetchers ------------------------------------------------------

async function fetchPaidRows(
  db: Database,
  clientId: string,
  range: DateRange,
): Promise<Array<PaidDailyMetric & { campaignId: string }>> {
  const rows = await db
    .select({
      date: paidDailyMetrics.date,
      campaignId: paidDailyMetrics.campaignId,
      spend: paidDailyMetrics.spend,
      impressions: paidDailyMetrics.impressions,
      clicks: paidDailyMetrics.clicks,
      conversions: paidDailyMetrics.conversions,
      conversionValue: paidDailyMetrics.conversionValue,
      videoViews: paidDailyMetrics.videoViews,
    })
    .from(paidDailyMetrics)
    .innerJoin(campaigns, eq(paidDailyMetrics.campaignId, campaigns.id))
    .innerJoin(tiktokAccounts, eq(campaigns.accountId, tiktokAccounts.id))
    .where(
      and(
        eq(tiktokAccounts.clientId, clientId),
        gte(paidDailyMetrics.date, range.start),
        lte(paidDailyMetrics.date, range.end),
      ),
    );
  return rows;
}

async function fetchOrganicRows(
  db: Database,
  clientId: string,
  range: DateRange,
): Promise<Array<OrganicDailyMetric & { videoId: string }>> {
  const rows = await db
    .select({
      date: organicDailyMetrics.date,
      videoId: organicDailyMetrics.videoId,
      views: organicDailyMetrics.views,
      likes: organicDailyMetrics.likes,
      comments: organicDailyMetrics.comments,
      shares: organicDailyMetrics.shares,
      watchTimeSec: organicDailyMetrics.watchTimeSec,
      reach: organicDailyMetrics.reach,
      newFollowers: organicDailyMetrics.newFollowers,
    })
    .from(organicDailyMetrics)
    .innerJoin(videos, eq(organicDailyMetrics.videoId, videos.id))
    .innerJoin(tiktokAccounts, eq(videos.accountId, tiktokAccounts.id))
    .where(
      and(
        eq(tiktokAccounts.clientId, clientId),
        gte(organicDailyMetrics.date, range.start),
        lte(organicDailyMetrics.date, range.end),
      ),
    );
  return rows;
}

// --- Aggregation helpers ----------------------------------------------------

/** Group rows by ISO date, preserving chronological order. */
function groupByDate<T extends { date: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const bucket = map.get(r.date);
    if (bucket) bucket.push(r);
    else map.set(r.date, [r]);
  }
  return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** Numeric accessor for any derived metric key (paid or organic). */
const valueOf = (derived: Record<string, number>, key: MetricKey): number => derived[key] ?? 0;

function buildKpi(
  key: MetricKey,
  current: Record<string, number>,
  previous: Record<string, number>,
  perDay: Array<Record<string, number>>,
): KpiCard {
  const def = METRICS[key];
  return {
    key,
    label: def.shortLabel,
    value: valueOf(current, key),
    delta: deltaPct(valueOf(current, key), valueOf(previous, key)),
    goodDirection: def.goodDirection,
    sparkline: perDay.map((d) => valueOf(d, key)),
  };
}

// --- The dashboard read-model ----------------------------------------------

const PAID_KPI_KEYS: MetricKey[] = ['spend', 'roas', 'conversions', 'cpa'];
const ORGANIC_KPI_KEYS: MetricKey[] = ['views', 'engagementRate', 'newFollowers', 'avgWatchTimeSec'];

export async function getDashboard(
  db: Database,
  client: ClientSummary,
  range: DateRange,
): Promise<DashboardData> {
  const prev = previousRange(range);

  const [paidRows, paidPrevRows, organicRows, organicPrevRows] = await Promise.all([
    fetchPaidRows(db, client.id, range),
    fetchPaidRows(db, client.id, prev),
    fetchOrganicRows(db, client.id, range),
    fetchOrganicRows(db, client.id, prev),
  ]);

  const hasPaid = paidRows.length > 0;
  const hasOrganic = organicRows.length > 0;

  // ---- Paid rollups ----
  const paidCurrent = derivePaid(sumPaid(paidRows));
  const paidPrev = derivePaid(sumPaid(paidPrevRows));
  const paidByDate = groupByDate(paidRows);
  const paidPerDay = [...paidByDate.values()].map((rows) => derivePaid(sumPaid(rows)));
  const paidKpis = PAID_KPI_KEYS.map((k) =>
    buildKpi(k, paidCurrent as never, paidPrev as never, paidPerDay as never),
  );

  // ---- Organic rollups ----
  const organicCurrent = deriveOrganic(sumOrganic(organicRows));
  const organicPrev = deriveOrganic(sumOrganic(organicPrevRows));
  const organicByDate = groupByDate(organicRows);
  const organicPerDay = [...organicByDate.values()].map((rows) => deriveOrganic(sumOrganic(rows)));
  const organicKpis = ORGANIC_KPI_KEYS.map((k) =>
    buildKpi(k, organicCurrent as never, organicPrev as never, organicPerDay as never),
  );

  // ---- Unified daily timeseries (union of both surfaces' dates) ----
  const allDates = new Set<string>([...paidByDate.keys(), ...organicByDate.keys()]);
  const timeseries: TimeseriesPoint[] = [...allDates]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      const p = derivePaid(sumPaid(paidByDate.get(date) ?? []));
      const o = deriveOrganic(sumOrganic(organicByDate.get(date) ?? []));
      return {
        date,
        spend: round2(p.spend),
        roas: round2(p.roas),
        conversions: p.conversions,
        clicks: p.clicks,
        views: o.views,
        engagementRate: round4(o.engagementRate),
        newFollowers: o.newFollowers,
      };
    });

  const [campaignTable, videoTable] = await Promise.all([
    buildCampaignTable(db, client.id, paidRows),
    buildVideoTable(db, client.id, organicRows),
  ]);

  return {
    client,
    range,
    paidKpis,
    organicKpis,
    timeseries,
    campaigns: campaignTable,
    topVideos: videoTable,
    hasPaid,
    hasOrganic,
  };
}

async function buildCampaignTable(
  db: Database,
  clientId: string,
  paidRows: Array<PaidDailyMetric & { campaignId: string }>,
): Promise<CampaignRow[]> {
  const meta = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      objective: campaigns.objective,
      status: campaigns.status,
    })
    .from(campaigns)
    .innerJoin(tiktokAccounts, eq(campaigns.accountId, tiktokAccounts.id))
    .where(eq(tiktokAccounts.clientId, clientId))
    .orderBy(asc(campaigns.name));

  const byCampaign = new Map<string, PaidDailyMetric[]>();
  for (const r of paidRows) {
    const b = byCampaign.get(r.campaignId);
    if (b) b.push(r);
    else byCampaign.set(r.campaignId, [r]);
  }

  return meta
    .map((c) => {
      const totals = sumPaid(byCampaign.get(c.id) ?? []);
      const d = derivePaid(totals);
      return {
        id: c.id,
        name: c.name,
        objective: c.objective,
        status: c.status,
        spend: round2(d.spend),
        impressions: d.impressions,
        clicks: d.clicks,
        ctr: round4(d.ctr),
        conversions: d.conversions,
        cpa: round2(d.cpa),
        roas: round2(d.roas),
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

async function buildVideoTable(
  db: Database,
  clientId: string,
  organicRows: Array<OrganicDailyMetric & { videoId: string }>,
): Promise<VideoRow[]> {
  const meta = await db
    .select({
      id: videos.id,
      caption: videos.caption,
      shareUrl: videos.shareUrl,
      publishedAt: videos.publishedAt,
    })
    .from(videos)
    .innerJoin(tiktokAccounts, eq(videos.accountId, tiktokAccounts.id))
    .where(eq(tiktokAccounts.clientId, clientId))
    .orderBy(desc(videos.publishedAt));

  const byVideo = new Map<string, OrganicDailyMetric[]>();
  for (const r of organicRows) {
    const b = byVideo.get(r.videoId);
    if (b) b.push(r);
    else byVideo.set(r.videoId, [r]);
  }

  return meta
    .map((v) => {
      const d = deriveOrganic(sumOrganic(byVideo.get(v.id) ?? []));
      return {
        id: v.id,
        caption: v.caption,
        shareUrl: v.shareUrl,
        publishedAt:
          v.publishedAt instanceof Date ? v.publishedAt.toISOString().slice(0, 10) : String(v.publishedAt),
        views: d.views,
        likes: d.likes,
        engagementRate: round4(d.engagementRate),
        avgWatchTimeSec: round2(d.avgWatchTimeSec),
        shares: d.shares,
      };
    })
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Convenience: empty rollups, used when a client has no data yet. */
export const emptyRollups = () => ({
  paid: derivePaid(emptyPaidTotals()),
  organic: deriveOrganic(emptyOrganicTotals()),
});
