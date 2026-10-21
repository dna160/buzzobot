import { resolve } from 'node:path';
import type pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../client.js';
import {
  agencies,
  clients,
  marketScopeAccounts,
  marketScopeAudienceDaily,
  marketScopeInsightsDaily,
  marketScopeRankingsDaily,
  schema,
  tiktokAccounts,
} from '../schema.js';
import {
  linkMarketScopeAccounts,
  normalizeContentType,
  normalizeStage,
  syncMarketScope,
  ttmsNameMatches,
  verifyMarketScopeMirror,
} from './market-scope-sync.js';

describe('linkMarketScopeAccounts', () => {
  const client = (slug: string, name: string, ...ads: string[]) => ({ clientId: slug, slug, name, adAccountIds: ads });

  it('links through the ad account and makes a lone account primary', () => {
    const r = linkMarketScopeAccounts(
      [{ ttmsAccountId: 't1', brandName: 'BARDI Smart Home', advertiserIds: ['adv-bardi'] }],
      [client('bardi-tiktok', 'BARDI', 'adv-bardi')],
    );
    expect(r.links).toEqual([{ ttmsAccountId: 't1', clientId: 'bardi-tiktok', isPrimary: true }]);
  });

  it('gives a client both accounts its advertiser lists, primary by name (Purbasari / Senka)', () => {
    const r = linkMarketScopeAccounts(
      [
        { ttmsAccountId: 'p', brandName: 'Purbasari', advertiserIds: ['adv-pur'] },
        { ttmsAccountId: 's', brandName: 'Senka', advertiserIds: ['adv-pur'] },
      ],
      [client('purbasari-id', 'Purbasari ID', 'adv-pur')],
    );
    expect(r.links).toEqual([
      { ttmsAccountId: 'p', clientId: 'purbasari-id', isPrimary: true },
      { ttmsAccountId: 's', clientId: 'purbasari-id', isPrimary: false },
    ]);
  });

  it('reports why an account stays unlinked', () => {
    const r = linkMarketScopeAccounts(
      [
        { ttmsAccountId: 'fino', brandName: 'Fino', advertiserIds: [] },
        { ttmsAccountId: 'astra', brandName: 'Astra Foto', advertiserIds: ['adv-x'] },
        { ttmsAccountId: 'dup', brandName: 'Nobody', advertiserIds: ['adv-shared'] },
      ],
      [client('alpha-co', 'Alpha', 'adv-shared'), client('beta-co', 'Beta', 'adv-shared')],
    );
    expect(r.links).toEqual([]);
    expect(r.unlinked.map((u) => [u.ttmsAccountId, u.reason])).toEqual([
      ['fino', 'no linked ad account'],
      ['astra', 'no Tempo client has its ad account'],
      ['dup', 'ad account shared by 2 clients (alpha-co, beta-co)'],
    ]);
  });

  it('settles an ad account shared by two clients by name', () => {
    const r = linkMarketScopeAccounts(
      [{ ttmsAccountId: 't', brandName: 'Beta Official Shop', advertiserIds: ['adv-shared'] }],
      [client('alpha-co', 'Alpha', 'adv-shared'), client('beta-co', 'Beta', 'adv-shared')],
    );
    expect(r.links).toEqual([{ ttmsAccountId: 't', clientId: 'beta-co', isPrimary: true }]);
  });
});

describe('normalisation', () => {
  it('maps the portal vocabulary and rejects anything unknown', () => {
    expect(normalizeStage('CONSIDERATION')).toBe('consideration');
    expect(normalizeStage('TOTAL_ACC')).toBeNull();
    expect(normalizeContentType('BRAND_GENERATED_CONTENT_ORGANIC')).toBe('bgc_organic');
    expect(normalizeContentType('NON_PAID_CONTENT')).toBe('non_paid');
    expect(normalizeContentType('SOMETHING_NEW')).toBeNull();
    expect(ttmsNameMatches('Kalibre Official Shop', 'kalibre')).toBe(true);
    expect(ttmsNameMatches('Senka', 'Purbasari ID')).toBe(false);
    expect(ttmsNameMatches('Nobody', 'b')).toBe(false); // too short to mean anything
  });
});

// ─── Integration: real migrations (PGlite) against an in-memory portal ──────

const migrationsFolder = resolve(import.meta.dirname, '../../migrations');
const BARDI = '7522417104012722196';
const ADV = '6926791720868839425';

interface Portal {
  accounts: Record<string, unknown>[];
  audience: Record<string, unknown>[];
  insight: Record<string, unknown>[];
  ranking: Record<string, unknown>[];
}

const day = (i: number) => {
  const d = new Date('2026-09-21T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
};

/** Answers exactly the queries the mirror makes; anything else is a test bug. */
const fakePool = (p: Portal) => {
  const inWindow = (r: Record<string, unknown>, params: unknown[]) =>
    r.ttms_account_id === params[0] && String(r.date) >= String(params[1]) && String(r.date) <= String(params[2]);
  const counts = (rows: Record<string, unknown>[], params: unknown[]) => {
    const ids = params[0] as string[];
    const n = new Map<string, { id: string; date: string; n: string }>();
    for (const r of rows) {
      if (!ids.includes(String(r.ttms_account_id)) || String(r.date) < String(params[1]) || String(r.date) > String(params[2])) continue;
      const k = `${r.ttms_account_id}|${r.date}`;
      const c = n.get(k) ?? { id: String(r.ttms_account_id), date: String(r.date), n: '0' };
      c.n = String(Number(c.n) + 1);
      n.set(k, c);
    }
    return [...n.values()];
  };
  const table = (text: string) =>
    text.includes('ttms_audience_daily') ? p.audience : text.includes('ttms_insight_daily') ? p.insight : p.ranking;
  return {
    query: async (text: string, params: unknown[] = []) => {
      if (text.includes('FROM ttms_accounts')) return { rows: p.accounts };
      if (text.includes('COUNT(*)')) return { rows: counts(table(text), params) };
      if (text.includes('FROM ttms_insight_daily')) {
        return {
          rows: p.insight
            .filter((r) => inWindow(r, params))
            .map(({ bench_top5, bench_top10, bench_top25, bench_top50, ...r }) => ({
              ...r,
              bench_value_top5: bench_top5,
              bench_value_top10: bench_top10,
              bench_value_top25: bench_top25,
              bench_value_top50: bench_top50,
            })),
        };
      }
      if (text.includes('FROM ttms_audience_daily') || text.includes('FROM ttms_ranking_daily')) {
        return { rows: table(text).filter((r) => inWindow(r, params)) };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  } as unknown as pg.Pool;
};

const portal: Portal = {
  accounts: [
    {
      ttms_account_id: BARDI, brand_name: 'BARDI Smart Home', industry: 'Consumer Electronics', region_code: 'ID',
      plan: 'TTS Purchase(Lite)', is_lite: true, unavailable_metrics: ['SEARCH_VOLUME', 'NSR'],
      advertiser_ids: [ADV], last_data_date: day(19),
    },
    {
      ttms_account_id: 'fino', brand_name: 'Fino', industry: null, region_code: null, plan: null,
      is_lite: true, unavailable_metrics: [], advertiser_ids: [], last_data_date: day(19),
    },
  ],
  audience: [],
  insight: [],
  ranking: [],
};
for (let i = 0; i < 20; i += 1) {
  for (const stage of ['ACC', 'AWARENESS', 'CONSIDERATION', 'CONVERSION']) {
    portal.audience.push({
      ttms_account_id: BARDI, date: day(i), stage,
      brand_total: String(100_000 + i), brand_new: '500', brand_outflow: '400', brand_ranking: 38, total_brand_count: 64,
      // Early history has no benchmark: it must stay null, never 0.
      bench_total_top5: i < 3 ? null : '900000', bench_total_top10: i < 3 ? null : '700000',
      bench_total_top25: null, bench_total_top50: null,
      bench_new_top5: null, bench_new_top10: '9000', bench_new_top25: null, bench_new_top50: null,
      bench_outflow_top5: null, bench_outflow_top10: '8000', bench_outflow_top25: null, bench_outflow_top50: null,
    });
  }
  for (const ct of ['ALL', 'PAID_CONTENT', 'NON_PAID_CONTENT', 'USER_GENERATED_CONTENT_ORGANIC', 'BRAND_NEW_TYPE']) {
    portal.insight.push({
      ttms_account_id: BARDI, date: day(i), metric: 'IMPRESSIONS', content_type: ct,
      brand_value: '1000', brand_share: '0.0024',
      bench_top5: null, bench_top10: '50000', bench_top25: null, bench_top50: null,
      bench_share_top5: null, bench_share_top10: '0.05', bench_share_top25: null, bench_share_top50: null,
    });
  }
  portal.ranking.push(
    { ttms_account_id: BARDI, date: day(i), stage: 'CONSIDERATION', brand: 'BARDI Smart Home', ranking: 38 },
    { ttms_account_id: BARDI, date: day(i), stage: 'CONSIDERATION', brand: 'Competitor C', ranking: i < 10 ? 13 : 9 },
  );
}

let db: Database;

beforeAll(async () => {
  const pglite = new PGlite();
  db = drizzle(pglite, { schema }) as unknown as Database;
  await migrate(drizzle(pglite, { schema }), { migrationsFolder });
  const [agency] = await db.insert(agencies).values({ name: 'Buzzo', slug: 'buzzo' }).returning({ id: agencies.id });
  const [client] = await db
    .insert(clients)
    .values({ agencyId: agency!.id, name: 'BARDI', slug: 'bardi-tiktok', northStar: 'shop', currency: 'IDR' })
    .returning({ id: clients.id });
  await db.insert(tiktokAccounts).values({ clientId: client!.id, surface: 'paid', externalId: ADV, displayName: 'BARDI' });
});

describe('syncMarketScope (PGlite)', () => {
  it('backfills a linked account up to its settled day, bounded by backfillDays', async () => {
    const r = await syncMarketScope(db, fakePool(portal), { backfillDays: 10 });
    expect(r.unlinked.map((u) => u.ttmsAccountId)).toEqual(['fino']);
    expect(r.accounts).toEqual([
      expect.objectContaining({ ttmsAccountId: BARDI, clientSlug: 'bardi-tiktok', isPrimary: true, from: day(10), to: day(19) }),
    ]);
    // 10 days × 4 stages; 10 days × 4 known content types (the unknown one is skipped); 10 days × 2 brands.
    expect(r.accounts[0]).toMatchObject({ audienceRows: 40, insightRows: 40, rankingRows: 20 });

    const [account] = await db.select().from(marketScopeAccounts);
    expect(account).toMatchObject({ brandName: 'BARDI Smart Home', vertical: 'Consumer Electronics', isLite: true });
    expect(account!.unavailableMetrics).toEqual(['SEARCH_VOLUME', 'NSR']);
  });

  it('stores normalised names and keeps missing benchmarks null', async () => {
    const [row] = await db
      .select()
      .from(marketScopeAudienceDaily)
      .where(and(eq(marketScopeAudienceDaily.date, day(10)), eq(marketScopeAudienceDaily.stage, 'consideration')));
    expect(row).toMatchObject({ brandTotal: 100_010, brandRanking: 38, benchTotalTop10: 700_000, benchTotalTop25: null });

    const types = await db.selectDistinct({ ct: marketScopeInsightsDaily.contentType }).from(marketScopeInsightsDaily);
    expect(types.map((t) => t.ct).sort()).toEqual(['all', 'non_paid', 'paid', 'ugc_organic']);
    const [ins] = await db.select().from(marketScopeInsightsDaily).limit(1);
    expect(ins).toMatchObject({ metric: 'impressions', brandShare: 0.0024, benchValueTop10: 50_000, benchValueTop5: null });
  });

  it('re-copies the overlap on the next run and really overwrites revised values', async () => {
    const revised: Portal = {
      ...portal,
      audience: portal.audience.map((r) => (r.date === day(18) ? { ...r, brand_total: '123456' } : r)),
      ranking: portal.ranking.map((r) => (r.date === day(19) && r.brand === 'Competitor C' ? { ...r, ranking: 4 } : r)),
    };
    const r = await syncMarketScope(db, fakePool(revised), { backfillDays: 10, overlapDays: 3 });
    expect(r.accounts[0]).toMatchObject({ from: day(16), to: day(19), audienceRows: 16 });

    const [aud] = await db
      .select({ v: marketScopeAudienceDaily.brandTotal })
      .from(marketScopeAudienceDaily)
      .where(and(eq(marketScopeAudienceDaily.date, day(18)), eq(marketScopeAudienceDaily.stage, 'acc')));
    expect(aud!.v).toBe(123_456);
    const [rank] = await db
      .select({ v: marketScopeRankingsDaily.ranking })
      .from(marketScopeRankingsDaily)
      .where(and(eq(marketScopeRankingsDaily.date, day(19)), eq(marketScopeRankingsDaily.brand, 'Competitor C')));
    expect(rank!.v).toBe(4);
  });

  it('verifies row counts per day against the portal, ignoring history before the backfill', async () => {
    const pool = fakePool(portal);
    // Insights differ by design: the unknown content type is never mirrored.
    const before = await verifyMarketScopeMirror(db, pool, { from: day(0), to: day(19) });
    expect(new Set(before.map((m) => m.table))).toEqual(new Set(['insights']));
    expect(before.every((m) => m.source === 5 && m.mirror === 4 && m.date >= day(10))).toBe(true);

    await db
      .delete(marketScopeRankingsDaily)
      .where(and(eq(marketScopeRankingsDaily.date, day(12)), eq(marketScopeRankingsDaily.brand, 'Competitor C')));
    const after = await verifyMarketScopeMirror(db, pool, { from: day(0), to: day(19) });
    expect(after.filter((m) => m.table === 'rankings')).toEqual([
      { ttmsAccountId: BARDI, table: 'rankings', date: day(12), source: 2, mirror: 1 },
    ]);
  });
});
