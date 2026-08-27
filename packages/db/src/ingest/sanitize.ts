import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { EntityStatus } from '@tempo/core';
import {
  inferObjective,
  pivotHourlyRows,
  type HourBucket,
  type PaidHourlyMetricDTO,
  type PaidMetricDTO,
  type RawExportRow,
} from '@tempo/tiktok';
import { getDb, resolvePgliteDir, type Database } from '../client.js';
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

  // 8. Record Sync Run
  const dates = parsed.dates;
  const windowStart = dates[0] ?? new Date().toISOString().slice(0, 10);
  const windowEnd = dates[dates.length - 1] ?? windowStart;

  await db.insert(syncRuns).values({
    accountId,
    surface: 'paid',
    status: 'succeeded',
    windowStart,
    windowEnd,
    rowsIngested: hourlyIngested + dailyIngested,
    finishedAt: new Date(),
  });

  return {
    hourlyIngested,
    dailyIngested,
    dateCount: dates.length,
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

  // Fetch campaign rows from tiktok_ads_campaign for this brand
  try {
    const campaignRes = await postgresPool.query<{
      date_str: string;
      campaign_id: string;
      campaign_name: string;
      spend: string | number;
      impressions: string | number;
      clicks: string | number;
      conversions: string | number;
      conversion_value: string | number;
    }>(
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
       WHERE ad_account_id = $1 AND spend > 0
       GROUP BY date, campaign_id, campaign_name
       ORDER BY date;`,
      [brand.tiktokAdAccountId],
    );

    const rows = campaignRes.rows;
    if (rows.length === 0) return { dailyIngested: 0, campaignCount: 0 };

    // Unique campaigns
    const uniqueCampaigns = new Map<string, string>();
    for (const r of rows) {
      uniqueCampaigns.set(r.campaign_id, r.campaign_name);
    }

    const campaignDTOs = Array.from(uniqueCampaigns.entries()).map(([extId, name]) => ({
      externalId: extId,
      name,
      objective: inferObjective(name),
      status: EntityStatus.Active,
      dailyBudget: null,
    }));

    const campaignIdMap = await upsertCampaigns(db, accountId, campaignDTOs);

    const dailyMetrics: PaidMetricDTO[] = rows.map((r) => ({
      date: r.date_str,
      campaignExternalId: r.campaign_id,
      spend: Number(r.spend) || 0,
      impressions: Math.round(Number(r.impressions) || 0),
      clicks: Math.round(Number(r.clicks) || 0),
      conversions: Math.round(Number(r.conversions) || 0),
      conversionValue: Number(r.conversion_value) || 0,
      videoViews: 0,
    }));

    const dailyIngested = await upsertPaidMetrics(db, campaignIdMap, dailyMetrics);

    const windowStart = rows[0]?.date_str ?? new Date().toISOString().slice(0, 10);
    const windowEnd = rows[rows.length - 1]?.date_str ?? windowStart;

    await db.insert(syncRuns).values({
      accountId,
      surface: 'paid',
      status: 'succeeded',
      windowStart,
      windowEnd,
      rowsIngested: dailyIngested,
      finishedAt: new Date(),
    });

    return { dailyIngested, campaignCount: uniqueCampaigns.size };
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
  let pglite = options.pglite ?? (options.pgliteDir ? undefined : handle.pglite);
  let shouldClosePglite = false;

  if (!pglite) {
    const dbDir = options.pgliteDir ?? resolvePgliteDir();
    mkdirSync(dbDir, { recursive: true });
    pglite = new PGlite(dbDir);
    shouldClosePglite = options.closeOnComplete ?? false;
  }

  // Ensure table exists in PGlite
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
    console.log('ℹ️ Running in offline/cached mode — discovering brands from local database...');
    discoveredBrands = await discoverSanitizedBrands(pglite);
  }

  if (discoveredBrands.length === 0) {
    console.warn('⚠️ No brand tables or sanitized data found to ingest.');
    if (options.closeOnComplete) {
      await pglite.close();
    }
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

        // Batch insert active rows into brand_hourly_tempo
        if (allActiveRows.length > 0) {
          await batchInsertSanitizedRows(pglite, brand.brandKey, allActiveRows);
        }

        console.log(
          `  ✓ Sanitized: ${totalFetched} raw rows -> ${allActiveRows.length} active rows (dropped ${totalFetched - allActiveRows.length} zero rows).`,
        );
      } else {
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
      }

      // Sync active rows into domain tables for web application
      if (allActiveRows.length > 0) {
        const stats = await syncBrandToDomain(db, brand, allActiveRows);
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
