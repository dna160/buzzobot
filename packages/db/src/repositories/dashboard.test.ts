import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { FixtureTikTokProvider } from '@tempo/tiktok';
import { rangePreset } from '@tempo/core';
import type { Database } from '../client.js';
import { schema } from '../schema.js';
import { ensureDemoTenant } from '../ingest/bootstrap.js';
import { ingestAccount } from '../ingest/pipeline.js';
import { getClientBySlug, getDashboard } from './dashboard.js';

/**
 * End-to-end persistence test: spin up an in-memory PGlite, apply the real
 * migrations, run the real ingestion pipeline against fixtures, then read the
 * dashboard read-model back — exercising schema, upserts, and rollups together.
 */
const migrationsFolder = resolve(import.meta.dirname, '../../migrations');
const TODAY = '2026-07-19';

let db: Database;

beforeAll(async () => {
  const client = new PGlite(); // in-memory
  db = drizzle(client, { schema }) as unknown as Database;
  await migrate(drizzle(client, { schema }), { migrationsFolder });

  const provider = new FixtureTikTokProvider();
  await ensureDemoTenant(db, provider);
  const range = rangePreset('90d', TODAY);
  for (const account of await provider.listAccounts()) {
    await ingestAccount(db, provider, account, range);
  }
});

describe('getDashboard', () => {
  it('rolls up paid and organic facts into KPIs', async () => {
    const client = await getClientBySlug(db, 'aurora-skincare');
    expect(client).not.toBeNull();

    const range = rangePreset('30d', TODAY);
    const data = await getDashboard(db, client!, range);

    expect(data.hasPaid).toBe(true);
    expect(data.hasOrganic).toBe(true);
    expect(data.paidKpis).toHaveLength(4);
    expect(data.organicKpis).toHaveLength(4);

    const spend = data.paidKpis.find((k) => k.key === 'spend');
    expect(spend?.value).toBeGreaterThan(0);
    expect(spend?.sparkline.length).toBe(data.timeseries.length);

    const roas = data.paidKpis.find((k) => k.key === 'roas');
    expect(roas?.value).toBeGreaterThan(0);
  });

  it('ranks campaigns by spend and keeps the paused one at zero', async () => {
    const client = await getClientBySlug(db, 'aurora-skincare');
    const data = await getDashboard(db, client!, rangePreset('30d', TODAY));

    expect(data.campaigns.length).toBeGreaterThan(0);
    // Sorted descending by spend.
    for (let i = 1; i < data.campaigns.length; i += 1) {
      expect(data.campaigns[i - 1]!.spend).toBeGreaterThanOrEqual(data.campaigns[i]!.spend);
    }
    const paused = data.campaigns.find((c) => c.name.includes('Lead Gen'));
    expect(paused?.spend).toBe(0);
  });

  it('returns top videos sorted by views (max 10)', async () => {
    const client = await getClientBySlug(db, 'aurora-skincare');
    const data = await getDashboard(db, client!, rangePreset('30d', TODAY));

    expect(data.topVideos.length).toBeGreaterThan(0);
    expect(data.topVideos.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < data.topVideos.length; i += 1) {
      expect(data.topVideos[i - 1]!.views).toBeGreaterThanOrEqual(data.topVideos[i]!.views);
    }
  });

  it('is idempotent: re-ingesting does not duplicate rows', async () => {
    const client = await getClientBySlug(db, 'aurora-skincare');
    const before = await getDashboard(db, client!, rangePreset('30d', TODAY));

    const provider = new FixtureTikTokProvider();
    const range = rangePreset('90d', TODAY);
    for (const account of await provider.listAccounts()) {
      await ingestAccount(db, provider, account, range);
    }

    const after = await getDashboard(db, client!, rangePreset('30d', TODAY));
    // Same spend total — upserts refreshed rows rather than duplicating them.
    const spendBefore = before.paidKpis.find((k) => k.key === 'spend')!.value;
    const spendAfter = after.paidKpis.find((k) => k.key === 'spend')!.value;
    expect(spendAfter).toBeCloseTo(spendBefore, 2);
  });
});
