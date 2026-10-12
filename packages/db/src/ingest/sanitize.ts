import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { CampaignObjective, EntityStatus } from '@tempo/core';
import {
  inferObjective,
  pivotHourlyRows,
  type CampaignDTO,
  type HourBucket,
  type PaidHourlyMetricDTO,
  type PaidMetricDTO,
  type RawExportRow,
} from '@tempo/tiktok';
import { getDb, resolvePgliteDir, type Database } from '../client.js';
import { sql } from 'drizzle-orm';
import { agencies, clients, syncRuns, tiktokAccounts } from '../schema.js';
import {
  upsertAdgroups,
  upsertCampaigns,
  upsertPaidHourlyMetrics,
  upsertPaidMetrics,
} from '../repositories/writes.js';
import {
  discoverPostgresBrands,
  discoverSanitizedBrands,
  type DiscoveredBrand,
} from './discovery.js';

// Parse PostgreSQL DATE type (OID 1082) as plain string to avoid local timezone offset shifting dates
pg.types.setTypeParser(1082, (val: string) => val);

// Hours to check: h00 through h23 (and h24 column if present in raw table)
const HOUR_KEYS = Array.from({ length: 24 }, (_, i) => `h${String(i).padStart(2, '0')}`);
const ALL_HOUR_COLUMNS = Array.from({ length: 25 }, (_, i) => `h${String(i).padStart(2, '0')}`);

export interface FetchSanitizeOptions {
  pgliteDir?: string;
  closeOnComplete?: boolean;
  /**
   * Reuse an already-open PGlite instance instead of opening one from
   * `pgliteDir`. When provided, the caller owns its lifecycle and it is not
   * closed here (regardless of `closeOnComplete`).
   */
  pglite?: PGlite;
}

export const toIsoDate = (v: unknown): string => {
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) {
    const year = v.getFullYear();
    const month = String(v.getMonth() + 1).padStart(2, '0');
    const day = String(v.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(v).slice(0, 10);
};

/**
 * Batch insert raw rows into PGlite brand_hourly_tempo in chunks of 50 rows.
 */
async function batchInsertSanitizedRows(
  pglite: PGlite,
  brandKey: string,
  rows: readonly RawExportRow[],
): Promise<void> {
  const BATCH_SIZE = 50;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const valuePlaceholders: string[] = [];
    const params: unknown[] = [];

    batch.forEach((r, rowIdx) => {
      const offset = rowIdx * 32;
      const placeholders = Array.from({ length: 32 }, (_, colIdx) => `$${offset + colIdx + 1}`);
      valuePlaceholders.push(`(${placeholders.join(', ')})`);

      params.push(
        brandKey,
        r.campaignId,
        r.date,
        r.adgroupId || '',
        r.metrics,
        r.campaignName || '',
        r.adgroupName || '',
        ...ALL_HOUR_COLUMNS.map((_, hIdx) => Number(r.hh[hIdx] || 0)),
      );
    });

    const sql = `
      INSERT INTO brand_hourly_tempo (
        brand, campaign_id, date, adgroup_id, metrics, campaign_name, adgroup_name,
        h00, h01, h02, h03, h04, h05, h06, h07, h08, h09, h10, h11,
        h12, h13, h14, h15, h16, h17, h18, h19, h20, h21, h22, h23, h24
      ) VALUES ${valuePlaceholders.join(', ')}
      ON CONFLICT (brand, campaign_id, date, adgroup_id, metrics) DO NOTHING;
    `;

    await pglite.query(sql, params);
  }
}

/**
 * Ingest parsed brand export rows into the core application tables
 * (agencies, clients, tiktokAccounts, campaigns, adgroups, paidHourlyMetrics, paidDailyMetrics).
 */
export async function syncBrandToDomain(
  db: Database,
  brand: DiscoveredBrand,
  rawRows: readonly RawExportRow[],
  postgresPool?: pg.Pool | null,
): Promise<{ hourlyIngested: number; dailyIngested: number; dateCount: number }> {
  const extraFields: Record<string, keyof HourBucket> = {};
  if (brand.conversionMetric) extraFields[brand.conversionMetric] = 'conversions';
  if (brand.conversionValueMetric) extraFields[brand.conversionValueMetric] = 'conversionValue';

  const parsed = pivotHourlyRows(rawRows, extraFields);

  // 1. Ensure Agency
  const [agency] = await db
    .insert(agencies)
    .values({ name: 'Buzzo Media', slug: 'buzzo-media' })
    .onConflictDoUpdate({ target: agencies.slug, set: { name: 'Buzzo Media' } })
    .returning({ id: agencies.id });
  const agencyId = agency!.id;

  // 2. Ensure Client
  const [client] = await db
    .insert(clients)
    .values({
      agencyId,
      name: brand.name,
      slug: brand.slug,
      brandColor: brand.brandColor,
      currency: brand.currency,
      timezone: brand.timezone,
      northStar: brand.northStar,
      tier: brand.tier,
    })
    .onConflictDoUpdate({
      target: [clients.agencyId, clients.slug],
      set: {
        name: brand.name,
        brandColor: brand.brandColor,
        currency: brand.currency,
        timezone: brand.timezone,
        northStar: brand.northStar,
        tier: brand.tier,
      },
    })
    .returning({ id: clients.id });
  const clientId = client!.id;

  // 3. Ensure TikTok Account. Campaigns/adgroups/hourly metrics parent to
  // this one row regardless of how many real accounts feed the brand's
  // table — they don't need to be split by which of several real accounts
  // they came from for the dashboard's purposes.
  const externalId = brand.tiktokAdAccountId || `${brand.slug}-tiktok-ads`;
  const [account] = await db
    .insert(tiktokAccounts)
    .values({
      clientId,
      surface: 'paid',
      externalId,
      displayName: brand.name,
      status: 'active',
    })
    .onConflictDoUpdate({
      target: [tiktokAccounts.surface, tiktokAccounts.externalId],
      set: { clientId, displayName: brand.name, status: 'active' },
    })
    .returning({ id: tiktokAccounts.id });
  const accountId = account!.id;

  // A hand-curated Premium table can be built from more than one real ad
  // account (e.g. Kanzler's 5) — link every one of them to this client too,
  // purely so a caller that needs the client's full real-account footprint
  // (e.g. the Template Report, pulling directly from TikTok's own tables)
  // can find all of them, not just the first. These extra rows carry no
  // campaign/adgroup data of their own.
  const extraAccountIds = (brand.tiktokAdAccountIds ?? []).filter((id) => id !== externalId);
  for (const extraId of extraAccountIds) {
    await db
      .insert(tiktokAccounts)
      .values({ clientId, surface: 'paid', externalId: extraId, displayName: brand.name, status: 'active' })
      .onConflictDoUpdate({
        target: [tiktokAccounts.surface, tiktokAccounts.externalId],
        set: { clientId, displayName: brand.name, status: 'active' },
      });
  }

  // 3c. Remove campaigns duplicated onto this client's other accounts by an
  // earlier ingest layout, so client totals are not double-counted.
  await pruneDuplicateCampaigns(db, clientId, accountId);

  // 4. Upsert Campaigns
  const campaignDTOs = parsed.campaigns.map((c) => ({
    externalId: c.externalId,
    name: c.name,
    objective: inferObjective(c.name),
    status: EntityStatus.Active,
    dailyBudget: null,
  }));
  const campaignIdMap = await upsertCampaigns(db, accountId, campaignDTOs);

  // 5. Upsert Adgroups
  const adgroupDTOs = parsed.adgroups.map((a) => ({
    externalId: a.externalId,
    campaignExternalId: a.campaignExternalId,
    name: a.name,
    status: EntityStatus.Active,
  }));
  const adgroupIdMap = await upsertAdgroups(db, campaignIdMap, adgroupDTOs);

  // 6. Upsert Paid Hourly Metrics
  const hourlyMetrics: PaidHourlyMetricDTO[] = parsed.buckets.map((b) => ({
    date: b.date,
    hour: b.hour,
    campaignExternalId: b.campaignExternalId,
    adgroupExternalId: b.adgroupExternalId,
    spend: b.spend,
    impressions: Math.round(b.impressions),
    clicks: Math.round(b.clicks),
    reach: Math.round(b.reach),
    videoViews: Math.round(b.videoViews),
    videoWatched6s: Math.round(b.videoWatched6s),
    engagedView15s: Math.round(b.engagedView15s),
    engagements: Math.round(b.engagements),
    likes: Math.round(b.likes),
    comments: Math.round(b.comments),
    shares: Math.round(b.shares),
    follows: Math.round(b.follows),
    profileVisits: Math.round(b.profileVisits),
    conversions: Math.round(b.conversions),
    conversionValue: b.conversionValue,
    spanHours: b.spanHours,
  }));
  const hourlyIngested = await upsertPaidHourlyMetrics(db, campaignIdMap, adgroupIdMap, hourlyMetrics);

  // 7. Upsert Paid Daily Metrics (rollups for campaign overview)
  const dailyAcc = new Map<string, PaidMetricDTO>();
  for (const b of parsed.buckets) {
    if (b.adgroupExternalId !== null) continue;
    const key = `${b.date} ${b.campaignExternalId}`;
    const row = dailyAcc.get(key) ?? {
      date: b.date,
      campaignExternalId: b.campaignExternalId,
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      conversionValue: 0,
      videoViews: 0,
    };
    row.spend += b.spend;
    row.impressions += Math.round(b.impressions);
    row.clicks += Math.round(b.clicks);
    row.videoViews += Math.round(b.videoViews);
    row.conversions += Math.round(b.conversions);
    row.conversionValue += b.conversionValue;
    dailyAcc.set(key, row);
  }
  const dailyIngested = await upsertPaidMetrics(db, campaignIdMap, [...dailyAcc.values()]);

  // 7b. The shared warehouse — the same Robot Pintar tables every Standard
  // brand reads. A Premium brand is no longer confined to its own curated
  // `*_daily_performance` table.
  //
  // That table is a curated slice, not a superset, and how far it lags varies
  // per brand: Kanzler's held 16 campaigns to 25 Aug while the warehouse had 83
  // through 6 Sep, yet Laneige's holds 287 campaign-days the warehouse never
  // sees. So this is a union of both, never a swap of one for the other.
  //
  // The curated table wins on overlap, because it carries true hourly
  // granularity the warehouse cannot offer; the warehouse contributes every
  // campaign-day the curated table lacks. De-duplication is per campaign-DAY:
  // excluding whole campaigns would have discarded Kanzler's January-to-
  // September warehouse history for the very campaigns its table happens to
  // mention for two weeks in August.
  const coveredCampaignDays = new Set(
    parsed.buckets.map((b) => campaignDayKey(b.campaignExternalId, b.date)),
  );
  const adAccountIds = brand.tiktokAdAccountIds?.length
    ? brand.tiktokAdAccountIds
    : brand.tiktokAdAccountId
      ? [brand.tiktokAdAccountId]
      : [];

  const warehouse = postgresPool
    ? await ingestWarehouseCampaigns(db, postgresPool, accountId, adAccountIds, coveredCampaignDays)
    : EMPTY_INGEST;
  const gmvMax = postgresPool
    ? await ingestGmvMaxCampaigns(db, postgresPool, accountId, adAccountIds, coveredCampaignDays)
    : EMPTY_INGEST;

  // 8. Record Sync Run
  const dates = [...new Set([...parsed.dates, ...warehouse.dates, ...gmvMax.dates])].sort();
  const windowStart = dates[0] ?? new Date().toISOString().slice(0, 10);
  const windowEnd = dates[dates.length - 1] ?? windowStart;

  const totalHourly = hourlyIngested + warehouse.hourlyIngested + gmvMax.hourlyIngested;
  const totalDaily = dailyIngested + warehouse.dailyIngested + gmvMax.dailyIngested;

  await db.insert(syncRuns).values({
    accountId,
    surface: 'paid',
    status: 'succeeded',
    windowStart,
    windowEnd,
    rowsIngested: totalHourly + totalDaily,
    finishedAt: new Date(),
  });

  return {
    hourlyIngested: totalHourly,
    dailyIngested: totalDaily,
    dateCount: dates.length,
  };
}

interface StandardCampaignRow {
  date_str: string;
  campaign_id: string;
  campaign_name: string;
  spend: string | number;
  impressions: string | number;
  clicks: string | number;
  conversions: string | number;
  conversion_value: string | number;
}

/**
 * A GMV Max / LIVE GMV Max campaign-day. This surface reports cost, orders and
 * gross revenue only — it has no impression, click or video-view column.
 */
interface GmvMaxCampaignRow {
  date_str: string;
  campaign_id: string;
  campaign_name: string;
  promotion_type: string;
  operation_status: string | null;
  spend: string | number;
  conversions: string | number;
  conversion_value: string | number;
}

/**
 * Drop campaign rows stranded on a client's *other* paid accounts.
 *
 * A Premium brand can be built from several real ad accounts (Kanzler's five),
 * so its client owns several `tiktok_accounts` rows. Only one of them — the
 * `accountId` this sync writes to — is meant to hold campaigns; the rest exist
 * purely so a caller can find the client's full real-account footprint, and are
 * documented as carrying "no campaign/adgroup data of their own".
 *
 * Earlier versions of this ingest attached campaigns per-account, and because
 * every write here is an upsert that never retracts anything, those rows simply
 * stayed. The result was a client whose totals silently counted the same
 * campaign twice: Kanzler read Rp 10.3B against a warehouse truth of Rp 5.1B,
 * with 80 campaigns duplicated across four dead accounts.
 *
 * Only true duplicates are removed — a campaign is dropped solely when the same
 * `externalId` already exists under the account being written to. Anything
 * unique to another account is left alone, so a future layout that legitimately
 * spreads campaigns across accounts loses nothing here. Metrics follow via
 * `ON DELETE CASCADE`.
 */
async function pruneDuplicateCampaigns(
  db: Database,
  clientId: string,
  accountId: string,
): Promise<void> {
  await db.execute(sql`
    DELETE FROM campaigns c
    USING tiktok_accounts a
    WHERE c.account_id = a.id
      AND a.client_id = ${clientId}::uuid
      AND c.account_id <> ${accountId}::uuid
      AND EXISTS (
        SELECT 1 FROM campaigns keep
        WHERE keep.account_id = ${accountId}::uuid
          AND keep.external_id = c.external_id
      )
  `);
}

/** Key identifying one campaign-day, for cross-source de-duplication. */
const campaignDayKey = (campaignExternalId: string, date: string): string =>
  `${campaignExternalId}|${date}`;

/**
 * A whole-day `paid_hourly_metrics` bucket.
 *
 * Both warehouse surfaces below report at day grain — neither
 * `tiktok_ads_campaign` nor `tiktok_ads_gmv_max_product_campaign` carries an
 * hourly breakdown — so each day lands as one bucket at `hour = 0` with
 * `spanHours = 24`. That is the schema's documented convention for a bucket
 * absorbing a whole day, and consumers already honour it: `hourly.ts` drops
 * `spanHours !== 1` from true-hour series and reports them as coverage notes,
 * while day- and window-grain sums include them.
 *
 * The hourly write is what makes warehouse data reachable at all: the report
 * brief (`repositories/daily-brief.ts`) and the entire Tempo Intelligence
 * Engine (`tempo-engine`'s `fetch_available_dates`, `fetch_paid_rollup`, every
 * `build_*_metric_frame`) read `paid_hourly_metrics` and never
 * `paid_daily_metrics`.
 */
const dayBucket = (r: {
  date: string;
  campaignExternalId: string;
  spend: number;
  impressions?: number;
  clicks?: number;
  conversions: number;
  conversionValue: number;
}): PaidHourlyMetricDTO => ({
  date: r.date,
  hour: 0,
  campaignExternalId: r.campaignExternalId,
  adgroupExternalId: null,
  spend: r.spend,
  impressions: r.impressions ?? 0,
  clicks: r.clicks ?? 0,
  reach: 0,
  videoViews: 0,
  videoWatched6s: 0,
  engagedView15s: 0,
  engagements: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  follows: 0,
  profileVisits: 0,
  conversions: r.conversions,
  conversionValue: r.conversionValue,
  spanHours: 24,
});

interface IngestResult {
  campaignCount: number;
  dailyIngested: number;
  hourlyIngested: number;
  dates: string[];
}

const EMPTY_INGEST: IngestResult = { campaignCount: 0, dailyIngested: 0, hourlyIngested: 0, dates: [] };

/**
 * Regular-ads (TTAM) campaign-days from the shared warehouse
 * (`tiktok_ads_campaign`), for any brand — Premium or Standard.
 *
 * Every brand reads this table so that all of them sit on the same Robot Pintar
 * data. A Premium brand used to be limited to its own hand-curated
 * `*_daily_performance` table, which is a curated slice and can lag badly:
 * Kanzler's covered 16 campaigns to 25 Aug while the warehouse held 83
 * campaigns through 6 Sep, so its dashboard sat ten days stale with the fresher
 * rows sitting right there unread.
 *
 * `excludeCampaignDays` is what keeps the union honest. The curated table wins
 * for the campaign-days it covers, because it carries true hourly granularity
 * the warehouse cannot offer; the warehouse fills in every campaign-day the
 * curated table lacks. De-duplication is per campaign-DAY, not per campaign —
 * excluding a whole campaign would have thrown away January-to-September
 * warehouse history for the 16 campaigns Kanzler's table happens to mention for
 * two weeks in August.
 */
async function ingestWarehouseCampaigns(
  db: Database,
  postgresPool: pg.Pool,
  accountId: string,
  adAccountIds: readonly string[],
  excludeCampaignDays: ReadonlySet<string> = new Set(),
): Promise<IngestResult> {
  const ids = adAccountIds.filter(Boolean);
  if (ids.length === 0) return EMPTY_INGEST;

  const res = await postgresPool.query<StandardCampaignRow>(
    `SELECT
       date::text as date_str,
       campaign_id,
       COALESCE(NULLIF(campaign_name, ''), campaign_id) as campaign_name,
       SUM(COALESCE(spend, 0)) as spend,
       SUM(COALESCE(impressions, 0)) as impressions,
       SUM(COALESCE(clicks, 0)) as clicks,
       SUM(COALESCE(total_purchase, 0)) as conversions,
       SUM(COALESCE(total_purchase_value, 0)) as conversion_value
     FROM tiktok_ads_campaign
     WHERE ad_account_id = ANY($1) AND spend > 0
     GROUP BY date, campaign_id, campaign_name
     ORDER BY date;`,
    [ids],
  );

  const rows = res.rows.filter((r) => !excludeCampaignDays.has(campaignDayKey(r.campaign_id, r.date_str)));
  if (rows.length === 0) return EMPTY_INGEST;

  const uniqueCampaigns = new Map<string, CampaignDTO>();
  for (const r of rows) {
    uniqueCampaigns.set(r.campaign_id, {
      externalId: r.campaign_id,
      name: r.campaign_name,
      objective: inferObjective(r.campaign_name),
      status: EntityStatus.Active,
      dailyBudget: null,
    });
  }
  const campaignIdMap = await upsertCampaigns(db, accountId, Array.from(uniqueCampaigns.values()));

  const metrics = rows.map((r) => ({
    date: r.date_str,
    campaignExternalId: r.campaign_id,
    spend: Number(r.spend) || 0,
    impressions: Math.round(Number(r.impressions) || 0),
    clicks: Math.round(Number(r.clicks) || 0),
    conversions: Math.round(Number(r.conversions) || 0),
    conversionValue: Number(r.conversion_value) || 0,
    videoViews: 0,
  }));

  const dailyIngested = await upsertPaidMetrics(db, campaignIdMap, metrics);
  const hourlyIngested = await upsertPaidHourlyMetrics(db, campaignIdMap, new Map(), metrics.map(dayBucket));

  return {
    campaignCount: uniqueCampaigns.size,
    dailyIngested,
    hourlyIngested,
    dates: Array.from(new Set(rows.map((r) => r.date_str))).sort(),
  };
}

/**
 * GMV Max and LIVE GMV Max campaign-days, for any brand — Premium or Standard.
 *
 * These deliver through their own reporting surface,
 * `tiktok_ads_gmv_max_product_campaign`, keyed by `promotion_type` ('PRODUCT'
 * for GMV Max, 'LIVE' for Live GMV Max). They never appear in
 * `tiktok_ads_campaign` with spend — they land there as skeleton rows with
 * every metric zeroed, which that table's `spend > 0` filter drops. A brand
 * running GMV Max exclusively (Chocomory, and 53 other accounts) therefore
 * ingested nothing at all and rendered as an empty client.
 *
 * The GMV Max surface reports cost, orders and gross revenue only — there is no
 * impression, click or view column to map, so those stay 0 rather than being
 * invented.
 */
async function ingestGmvMaxCampaigns(
  db: Database,
  postgresPool: pg.Pool,
  accountId: string,
  adAccountIds: readonly string[],
  excludeCampaignDays: ReadonlySet<string> = new Set(),
): Promise<IngestResult> {
  const ids = adAccountIds.filter(Boolean);
  if (ids.length === 0) return EMPTY_INGEST;

  const res = await postgresPool.query<GmvMaxCampaignRow>(
    `SELECT
       date::text as date_str,
       campaign_id,
       COALESCE(NULLIF(campaign_name, ''), campaign_id) as campaign_name,
       COALESCE(promotion_type, 'PRODUCT') as promotion_type,
       operation_status,
       SUM(COALESCE(cost, 0)) as spend,
       SUM(COALESCE(orders, 0)) as conversions,
       SUM(COALESCE(gross_revenue, 0)) as conversion_value
     FROM tiktok_ads_gmv_max_product_campaign
     WHERE ad_account_id = ANY($1)
     GROUP BY date, campaign_id, campaign_name, promotion_type, operation_status
     ORDER BY date;`,
    [ids],
  );

  const rows = res.rows.filter((r) => !excludeCampaignDays.has(campaignDayKey(r.campaign_id, r.date_str)));
  if (rows.length === 0) return EMPTY_INGEST;

  // GMV Max is a sales objective whatever the campaign is called — passing the
  // name to `inferObjective` would default "Growing SKU Campaign" to video
  // views, which misreads the campaign entirely.
  const uniqueCampaigns = new Map<string, CampaignDTO>();
  for (const r of rows) {
    uniqueCampaigns.set(r.campaign_id, {
      externalId: r.campaign_id,
      name: r.campaign_name,
      objective: CampaignObjective.ProductSales,
      status: r.operation_status === 'ENABLE' ? EntityStatus.Active : EntityStatus.Paused,
      dailyBudget: null,
    });
  }
  const campaignIdMap = await upsertCampaigns(db, accountId, Array.from(uniqueCampaigns.values()));

  const metrics = rows.map((r) => ({
    date: r.date_str,
    campaignExternalId: r.campaign_id,
    spend: Number(r.spend) || 0,
    impressions: 0,
    clicks: 0,
    conversions: Math.round(Number(r.conversions) || 0),
    conversionValue: Number(r.conversion_value) || 0,
    videoViews: 0,
  }));

  const dailyIngested = await upsertPaidMetrics(db, campaignIdMap, metrics);
  const hourlyIngested = await upsertPaidHourlyMetrics(db, campaignIdMap, new Map(), metrics.map(dayBucket));

  return {
    campaignCount: uniqueCampaigns.size,
    dailyIngested,
    hourlyIngested,
    dates: Array.from(new Set(rows.map((r) => r.date_str))).sort(),
  };
}

/**
 * Ingest daily campaign performance for standard Buzzohero brands (GMV Brief).
 */
export async function syncStandardBrandToDomain(
  db: Database,
  brand: DiscoveredBrand,
  postgresPool: pg.Pool | null,
): Promise<{ dailyIngested: number; campaignCount: number }> {
  // 1. Ensure Agency
  const [agency] = await db
    .insert(agencies)
    .values({ name: 'Buzzo Media', slug: 'buzzo-media' })
    .onConflictDoUpdate({ target: agencies.slug, set: { name: 'Buzzo Media' } })
    .returning({ id: agencies.id });
  const agencyId = agency!.id;

  // 2. Ensure Client
  const [client] = await db
    .insert(clients)
    .values({
      agencyId,
      name: brand.name,
      slug: brand.slug,
      brandColor: brand.brandColor,
      currency: brand.currency,
      timezone: brand.timezone,
      northStar: brand.northStar,
      tier: brand.tier,
    })
    .onConflictDoUpdate({
      target: [clients.agencyId, clients.slug],
      set: {
        name: brand.name,
        brandColor: brand.brandColor,
        currency: brand.currency,
        timezone: brand.timezone,
        northStar: brand.northStar,
        tier: brand.tier,
      },
    })
    .returning({ id: clients.id });
  const clientId = client!.id;

  // 3. Ensure TikTok Account
  const externalId = brand.tiktokAdAccountId || `${brand.slug}-tiktok-ads`;
  const [account] = await db
    .insert(tiktokAccounts)
    .values({
      clientId,
      surface: 'paid',
      externalId,
      displayName: brand.name,
      status: 'active',
    })
    .onConflictDoUpdate({
      target: [tiktokAccounts.surface, tiktokAccounts.externalId],
      set: { clientId, displayName: brand.name, status: 'active' },
    })
    .returning({ id: tiktokAccounts.id });
  const accountId = account!.id;

  if (!postgresPool || !brand.tiktokAdAccountId) {
    return { dailyIngested: 0, campaignCount: 0 };
  }

  // Both warehouse surfaces, exactly as a Premium brand now reads them — the
  // regular-ads table and the GMV Max / LIVE GMV Max table. No exclusions here:
  // a Standard brand has no curated `*_daily_performance` table of its own, so
  // nothing is already covered.
  const adAccountIds = [brand.tiktokAdAccountId];
  try {
    const warehouse = await ingestWarehouseCampaigns(db, postgresPool, accountId, adAccountIds);
    const gmvMax = await ingestGmvMaxCampaigns(db, postgresPool, accountId, adAccountIds);

    if (warehouse.dailyIngested === 0 && gmvMax.dailyIngested === 0) {
      return { dailyIngested: 0, campaignCount: 0 };
    }

    const dailyIngested = warehouse.dailyIngested + gmvMax.dailyIngested;
    const allDates = [...warehouse.dates, ...gmvMax.dates].sort();
    const windowStart = allDates[0] ?? new Date().toISOString().slice(0, 10);
    const windowEnd = allDates[allDates.length - 1] ?? windowStart;

    await db.insert(syncRuns).values({
      accountId,
      surface: 'paid',
      status: 'succeeded',
      windowStart,
      windowEnd,
      rowsIngested: dailyIngested,
      finishedAt: new Date(),
    });

    return { dailyIngested, campaignCount: warehouse.campaignCount + gmvMax.campaignCount };
  } catch (err) {
    console.warn(`[Sync] Warning syncing standard brand "${brand.name}":`, err);
    return { dailyIngested: 0, campaignCount: 0 };
  }
}

/**
 * End-to-end scalable data pipeline:
 * 1. Auto-discovers all Buzzohero brands from PostgreSQL (Premium with hourly tables vs Standard GMV Brief).
 * 2. Ingests, sanitizes, and filters non-zero rows into `brand_hourly_tempo`.
 * 3. Automatically provisions and updates `clients`, `campaigns`, `adgroups`, `paid_hourly_metrics`, and `paid_daily_metrics`.
 * 4. Falls back to offline sync if PostgreSQL is unavailable.
 */
export async function fetchSanitizeAndSeed(options: FetchSanitizeOptions = {}) {
  const host = process.env.DB_HOST;
  const port = Number(process.env.DB_PORT);
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;

  const handle = getDb();
  const db = handle.db;
  let pglite: PGlite | null = options.pglite ?? (options.pgliteDir ? null : (handle.pglite ?? null));
  let shouldClosePglite = false;
  let pgliteDir = '';

  if (!pglite) {
    pgliteDir = options.pgliteDir ?? resolvePgliteDir();
    mkdirSync(pgliteDir, { recursive: true });
    pglite = new PGlite(pgliteDir);
    shouldClosePglite = options.closeOnComplete ?? false;
  }

  /**
   * Whatever stopped PGlite from opening, or `null` if it opened fine.
   *
   * When a live PostgreSQL source is configured, PGlite is only a staging
   * mirror of the raw hourly rows (`brand_hourly_tempo`) — written below and
   * read back solely by the offline fallback. It must therefore never be able
   * to take the whole ingest down with it, and it used to: this data directory
   * started aborting inside `_pg_initdb` on 9 Sep, and because the open
   * happened here, before any real work, *every* sync path threw at startup —
   * the nightly `tempo-sanitizer-cron`, `pnpm db:sanitize`, and the web app's
   * `triggerAutoSyncIfStale`, which only `console.warn`s what it catches. The
   * dashboard went on serving 8 Sep figures for three weeks with the fresher
   * warehouse rows sitting right there unread, and nothing surfaced it.
   *
   * So a failure here degrades to "no staging mirror" and the live source
   * carries the sync on its own. It is only fatal when there is no live source
   * either — then PGlite was the data, not a cache, and the caller is told so
   * (see the discovery fallback below) rather than left with a silent no-op.
   */
  let pgliteError: unknown = null;

  // `new PGlite()` is lazy — a corrupt data directory surfaces on first use,
  // which makes this `exec`, not the constructor above, where it actually
  // fails.
  try {
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS brand_hourly_tempo (
        brand VARCHAR(32) NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        date DATE NOT NULL,
        adgroup_id VARCHAR(64) NOT NULL DEFAULT '',
        metrics VARCHAR(128) NOT NULL,
        campaign_name VARCHAR(512),
        adgroup_name VARCHAR(512),
        h00 NUMERIC, h01 NUMERIC, h02 NUMERIC, h03 NUMERIC, h04 NUMERIC, h05 NUMERIC,
        h06 NUMERIC, h07 NUMERIC, h08 NUMERIC, h09 NUMERIC, h10 NUMERIC, h11 NUMERIC,
        h12 NUMERIC, h13 NUMERIC, h14 NUMERIC, h15 NUMERIC, h16 NUMERIC, h17 NUMERIC,
        h18 NUMERIC, h19 NUMERIC, h20 NUMERIC, h21 NUMERIC, h22 NUMERIC, h23 NUMERIC, h24 NUMERIC,
        PRIMARY KEY (brand, campaign_id, date, adgroup_id, metrics)
      );
    `);
  } catch (err) {
    pgliteError = err;
    if (shouldClosePglite) await pglite.close().catch(() => {});
    pglite = null;
    shouldClosePglite = false;
    console.warn(
      `⚠️ Could not open the PGlite staging cache${pgliteDir ? ` at ${pgliteDir}` : ''} — continuing without it:`,
      err,
    );
  }

  let postgresPool: pg.Pool | null = null;
  let discoveredBrands: DiscoveredBrand[] = [];

  const hasPgConfig = Boolean(host && database && user);

  if (hasPgConfig) {
    try {
      postgresPool = new pg.Pool({ host, port, database, user, password });
      discoveredBrands = await discoverPostgresBrands(postgresPool);
    } catch (err) {
      console.warn('⚠️ Could not connect to external PostgreSQL to discover brand tables:', err);
      if (postgresPool) {
        await postgresPool.end().catch(() => {});
        postgresPool = null;
      }
    }
  }

  // If live PostgreSQL is unavailable or returned no tables, fall back to offline discovery
  if (discoveredBrands.length === 0) {
    if (!pglite) {
      // Nothing left to read: no live source produced brands and the staging
      // cache never opened. Throwing is the point — a silent `return` here is
      // indistinguishable from "already up to date", which is how three weeks
      // of staleness went unnoticed.
      if (postgresPool) await postgresPool.end().catch(() => {});
      throw new Error(
        'No brand source available: the live PostgreSQL source produced no brands and the PGlite ' +
          `staging cache could not be opened${pgliteDir ? ` (${pgliteDir})` : ''}. Repair or remove that ` +
          `data directory and retry. Cause: ${pgliteError instanceof Error ? pgliteError.message : String(pgliteError)}`,
      );
    }
    console.log('ℹ️ Running in offline/cached mode — discovering brands from local database...');
    discoveredBrands = await discoverSanitizedBrands(pglite);
  }

  if (discoveredBrands.length === 0) {
    console.warn('⚠️ No brand tables or sanitized data found to ingest.');
    if (options.closeOnComplete && pglite) {
      await pglite.close();
    }
    if (postgresPool) await postgresPool.end().catch(() => {});
    return;
  }

  const premiumBrands = discoveredBrands.filter((b) => b.tier === 'premium');
  const standardBrands = discoveredBrands.filter((b) => b.tier === 'standard');

  console.log('====================================================');
  console.log(`⚡ Auto-Discovered ${discoveredBrands.length} Buzzohero Brand(s):`);
  console.log(`   ⭐ Premium (Hourly Intraday): ${premiumBrands.length} brand(s)`);
  for (const b of premiumBrands) {
    console.log(`      • ${b.name} (${b.table ?? b.slug}, northStar: "${b.northStar}")`);
  }
  console.log(`   📊 Standard (GMV Brief): ${standardBrands.length} brand(s)`);
  console.log('====================================================');

  try {
    // 1. Process Premium Brands (Hourly Telemetry)
    for (const brand of premiumBrands) {
      console.log(`\n⭐ Processing Premium brand "${brand.name}" (${brand.table})...`);

      const allActiveRows: RawExportRow[] = [];

      if (postgresPool && brand.table) {
        // Fast direct fetch from PostgreSQL
        const queryRes = await postgresPool.query<{
          metrics: string;
          campaign_id: string;
          date_str: string;
          campaign_name: string;
          adgroup_id: string;
          adgroup_name: string;
          [k: string]: unknown;
        }>(
          `SELECT metrics, campaign_id, date::text as date_str, campaign_name, adgroup_id, adgroup_name, ${ALL_HOUR_COLUMNS.join(', ')} 
           FROM ${brand.table} 
           WHERE campaign_id <> 'ALL' AND adgroup_id <> 'ALL'`,
        );

        const rows = queryRes.rows;
        const totalFetched = rows.length;

        // Filter active (non-zero) rows
        for (const row of rows) {
          const isAllZero = HOUR_KEYS.every((hKey) => {
            const val = Number(row[hKey] || 0);
            return isNaN(val) || val === 0;
          });
          if (isAllZero) continue;

          allActiveRows.push({
            metrics: row.metrics ?? '',
            campaignId: row.campaign_id ?? '',
            date: row.date_str || toIsoDate(row.date),
            campaignName: row.campaign_name ?? '',
            adgroupId: row.adgroup_id ?? '',
            adgroupName: row.adgroup_name ?? '',
            hh: ALL_HOUR_COLUMNS.map((col) => String(row[col] ?? '0')),
          });
        }

        // Batch insert active rows into brand_hourly_tempo. Skipped when the
        // staging cache is unavailable — these rows came from the live source
        // and are already on their way into the domain tables below; mirroring
        // them is only what lets a later offline run replay this brand.
        if (allActiveRows.length > 0 && pglite) {
          await batchInsertSanitizedRows(pglite, brand.brandKey, allActiveRows);
        }

        console.log(
          `  ✓ Sanitized: ${totalFetched} raw rows -> ${allActiveRows.length} active rows (dropped ${totalFetched - allActiveRows.length} zero rows).`,
        );
      } else if (pglite) {
        // Read directly from cached brand_hourly_tempo
        const cachedRes = await pglite.query<{
          metrics: string;
          campaign_id: string;
          date_str: string;
          campaign_name: string;
          adgroup_id: string;
          adgroup_name: string;
          [k: string]: unknown;
        }>(
          `SELECT metrics, campaign_id, date::text as date_str, campaign_name, adgroup_id, adgroup_name, ${ALL_HOUR_COLUMNS.join(', ')} 
           FROM brand_hourly_tempo 
           WHERE brand = $1 AND campaign_id <> 'ALL' AND adgroup_id <> 'ALL';`,
          [brand.brandKey],
        );

        for (const row of cachedRes.rows) {
          allActiveRows.push({
            metrics: row.metrics ?? '',
            campaignId: row.campaign_id ?? '',
            date: row.date_str || toIsoDate(row.date),
            campaignName: row.campaign_name ?? '',
            adgroupId: row.adgroup_id ?? '',
            adgroupName: row.adgroup_name ?? '',
            hh: ALL_HOUR_COLUMNS.map((col) => String(row[col] ?? '0')),
          });
        }

        console.log(`  ✓ Loaded ${allActiveRows.length} active rows from local database.`);
      } else {
        // No live table for this brand and no staging cache to replay it from.
        // Its warehouse campaign-days below are unaffected, so carry on.
        console.warn(
          `  ⚠️ No hourly source for "${brand.name}" — the live table is unavailable and the staging cache is not open.`,
        );
      }

      // Sync active rows into domain tables for web application
      if (allActiveRows.length > 0) {
        const stats = await syncBrandToDomain(db, brand, allActiveRows, postgresPool);
        console.log(
          `  🚀 Synced to website: ${stats.dateCount} dates, ${stats.hourlyIngested} hourly points, ${stats.dailyIngested} daily rows.`,
        );
      }
    }

    // 2. Process Standard Brands (GMV Brief)
    console.log(`\n📊 Processing ${standardBrands.length} Standard Buzzohero brands (GMV Brief)...`);
    let syncedStandardCount = 0;
    for (const brand of standardBrands) {
      const stats = await syncStandardBrandToDomain(db, brand, postgresPool);
      if (stats.dailyIngested > 0) {
        syncedStandardCount += 1;
      }
    }
    console.log(`  ✓ Successfully provisioned ${standardBrands.length} brands (${syncedStandardCount} with active campaign facts).`);

    console.log('\n🎉 All Buzzohero brands and metrics are fully synchronized and available on the website!');
  } finally {
    if (postgresPool) {
      await postgresPool.end();
    }
    if (shouldClosePglite && pglite) {
      await pglite.close();
    }
  }
}
