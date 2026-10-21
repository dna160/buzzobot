import { resolve } from 'node:path';
import type pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../client.js';
import { agencies, campaigns, clients, paidDailyMetrics, paidHourlyMetrics, schema, tiktokAccounts } from '../schema.js';
import { gmvMaxAccountTotalExternalId } from './gmv-max-residual.js';
import { ingestGmvMaxAccountTotals } from './sanitize.js';
import { compareSpend, fetchTempoSpend } from './spend-parity.js';

/**
 * The GMV Max account-total step against real migrations (PGlite) and a fake
 * warehouse. What matters is what the unit tests on the pure function cannot
 * see: the rows actually land where every Tempo reader looks
 * (`paid_hourly_metrics` campaign rollup), a re-run does not double them, and a
 * day the campaign table later covers is taken back out.
 */

const migrationsFolder = resolve(import.meta.dirname, '../../migrations');
const ADV = '6926791720868839425';

let db: Database;
let accountId: string;

interface Warehouse {
  analytics: { ad_account_id: string; date_str: string; gmv_max_cost: number; currency: string }[];
  campaign: { ad_account_id: string; date_str: string; cost: number }[];
}

/** Answers the two queries the step makes; anything else is a test bug. */
const fakePool = (w: Warehouse) =>
  ({
    query: async (text: string) => {
      if (text.includes('tiktok_ads_analytics')) return { rows: w.analytics };
      if (text.includes('tiktok_ads_gmv_max_product_campaign')) return { rows: w.campaign };
      throw new Error(`unexpected query: ${text}`);
    },
  }) as unknown as pg.Pool;

const totals = async () => {
  const [campaign] = await db
    .select({ id: campaigns.id, name: campaigns.name, objective: campaigns.objective })
    .from(campaigns)
    .where(and(eq(campaigns.accountId, accountId), eq(campaigns.externalId, gmvMaxAccountTotalExternalId(ADV))));
  if (!campaign) return { campaign: null, hourly: [], daily: [] };
  const hourly = await db
    .select({ date: paidHourlyMetrics.date, hour: paidHourlyMetrics.hour, spend: paidHourlyMetrics.spend, spanHours: paidHourlyMetrics.spanHours })
    .from(paidHourlyMetrics)
    .where(and(eq(paidHourlyMetrics.campaignId, campaign.id), isNull(paidHourlyMetrics.adgroupId)));
  const daily = await db
    .select({ date: paidDailyMetrics.date, spend: paidDailyMetrics.spend })
    .from(paidDailyMetrics)
    .where(eq(paidDailyMetrics.campaignId, campaign.id));
  const byDate = <T extends { date: string }>(rows: T[]) => rows.sort((a, b) => a.date.localeCompare(b.date));
  return { campaign, hourly: byDate(hourly), daily: byDate(daily) };
};

beforeAll(async () => {
  const pglite = new PGlite();
  db = drizzle(pglite, { schema }) as unknown as Database;
  await migrate(drizzle(pglite, { schema }), { migrationsFolder });

  const [agency] = await db.insert(agencies).values({ name: 'Buzzo', slug: 'buzzo' }).returning({ id: agencies.id });
  const [client] = await db
    .insert(clients)
    .values({ agencyId: agency!.id, name: 'BARDI', slug: 'bardi-tiktok', northStar: 'shop', currency: 'IDR' })
    .returning({ id: clients.id });
  const [account] = await db
    .insert(tiktokAccounts)
    .values({ clientId: client!.id, surface: 'paid', externalId: ADV, displayName: 'BARDI', status: 'active' })
    .returning({ id: tiktokAccounts.id });
  accountId = account!.id;
});

describe('ingestGmvMaxAccountTotals', () => {
  const warehouse: Warehouse = {
    analytics: [
      { ad_account_id: ADV, date_str: '2026-10-01', gmv_max_cost: 1_400_000, currency: 'IDR' },
      { ad_account_id: ADV, date_str: '2026-10-02', gmv_max_cost: 1_200_000, currency: 'IDR' },
      { ad_account_id: ADV, date_str: '2026-10-03', gmv_max_cost: 900_000, currency: 'IDR' },
    ],
    campaign: [],
  };

  it('books each uncovered day as a whole-day campaign-rollup bucket', async () => {
    const r = await ingestGmvMaxAccountTotals(db, fakePool(warehouse), accountId, [ADV]);
    expect(r.dates).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);

    const t = await totals();
    expect(t.campaign).toMatchObject({ objective: 'product_sales' });
    expect(t.hourly.map((h) => [h.date, h.hour, h.spanHours, h.spend])).toEqual([
      ['2026-10-01', 0, 24, 1_400_000],
      ['2026-10-02', 0, 24, 1_200_000],
      ['2026-10-03', 0, 24, 900_000],
    ]);
    expect(t.daily.map((d) => d.spend)).toEqual([1_400_000, 1_200_000, 900_000]);
  });

  it('is idempotent: a re-run leaves the same rows', async () => {
    await ingestGmvMaxAccountTotals(db, fakePool(warehouse), accountId, [ADV]);
    const t = await totals();
    expect(t.hourly).toHaveLength(3);
    expect(t.daily).toHaveLength(3);
  });

  it('shrinks or removes a day once the campaign table reports it', async () => {
    await ingestGmvMaxAccountTotals(
      db,
      fakePool({
        ...warehouse,
        campaign: [
          { ad_account_id: ADV, date_str: '2026-10-01', cost: 1_400_000 }, // fully covered now
          { ad_account_id: ADV, date_str: '2026-10-02', cost: 700_000 }, // half covered
        ],
      }),
      accountId,
      [ADV],
    );
    const t = await totals();
    expect(t.hourly.map((h) => [h.date, h.spend])).toEqual([
      ['2026-10-02', 500_000],
      ['2026-10-03', 900_000],
    ]);
    expect(t.daily.map((d) => [d.date, d.spend])).toEqual([
      ['2026-10-02', 500_000],
      ['2026-10-03', 900_000],
    ]);
  });

  it('clears every account-total row when analytics no longer has a remainder', async () => {
    await ingestGmvMaxAccountTotals(db, fakePool({ analytics: [], campaign: [] }), accountId, [ADV]);
    const t = await totals();
    expect(t.hourly).toEqual([]);
    expect(t.daily).toEqual([]);
  });

  it('makes Tempo spend pass the parity check against the same warehouse', async () => {
    await ingestGmvMaxAccountTotals(db, fakePool(warehouse), accountId, [ADV]);
    const tempo = await fetchTempoSpend(db, { from: '2026-10-01', to: '2026-10-03' });
    const [row] = compareSpend(tempo, new Map([[ADV, { cost: 0, cash: 0, gmvMax: 3_500_000, usdDays: 0 }]]));
    expect(row).toMatchObject({ slug: 'bardi-tiktok', tempo: 3_500_000, ok: true });
  });
});
