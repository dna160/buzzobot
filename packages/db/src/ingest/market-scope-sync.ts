import type pg from 'pg';
import { and, eq, max, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  clients,
  marketScopeAccounts,
  marketScopeAudienceDaily,
  marketScopeInsightsDaily,
  marketScopeRankingsDaily,
  tiktokAccounts,
} from '../schema.js';

/**
 * Mirror the portal's TikTok Market Scope tables into Tempo (Strategy Report
 * PRD §6.3).
 *
 * The portal's `npm run ttms:sync` already calls the TTMS API daily and writes
 * `ttms_accounts`, `ttms_audience_daily`, `ttms_insight_daily` and
 * `ttms_ranking_daily` into the warehouse this sanitizer reads (PRD D1: no
 * direct API ingestion in v1). This copies them into `market_scope_*` so
 * tempo-engine keeps reading only Tempo's own DB.
 *
 * - Only TTMS accounts linked to a Tempo client are mirrored. The link is the
 *   ad account: `ttms_accounts.advertiser_ids` ∩ the client's paid
 *   `tiktok_accounts.external_id`. 11 of the 15 accessible accounts linked on
 *   2026-10-21 (P0_DISCOVERY.md §4).
 * - Incremental: each run re-copies from `MAX(date) − overlapDays` so revised
 *   recent days are refreshed; a first run backfills `backfillDays` up to the
 *   source's settled day. Every write is an upsert on the natural key.
 * - Nothing is deleted. An account that loses portal access keeps its history,
 *   as it does in the portal.
 */

export interface MarketScopeSyncOptions {
  /** First-run history depth. PRD Appendix B: `MARKET_SCOPE_BACKFILL_DAYS`, default 400. */
  backfillDays?: number;
  /** Days re-copied behind the newest mirrored day, so late revisions land. */
  overlapDays?: number;
  /** Restrict to these TTMS account ids (debugging / one-off backfills). */
  onlyAccounts?: readonly string[];
}

export interface MarketScopeAccountResult {
  ttmsAccountId: string;
  brandName: string;
  clientSlug: string;
  isPrimary: boolean;
  from: string | null;
  to: string | null;
  audienceRows: number;
  insightRows: number;
  rankingRows: number;
}

export interface MarketScopeSyncResult {
  accounts: MarketScopeAccountResult[];
  /** Accessible TTMS accounts no Tempo client could be linked to, and why. */
  unlinked: { ttmsAccountId: string; brandName: string; reason: string }[];
}

// ─── Normalisation ───────────────────────────────────────────────────────────

const STAGE: Record<string, string> = {
  ACC: 'acc',
  AWARENESS: 'awareness',
  CONSIDERATION: 'consideration',
  CONVERSION: 'conversion',
};

const CONTENT_TYPE: Record<string, string> = {
  ALL: 'all',
  PAID_CONTENT: 'paid',
  NON_PAID_CONTENT: 'non_paid',
  ADS: 'ads',
  CREATOR_CONTENT_BOOSTED: 'creator_boosted',
  CREATOR_CONTENT_ORGANIC: 'creator_organic',
  BRAND_GENERATED_CONTENT_BOOSTED: 'bgc_boosted',
  BRAND_GENERATED_CONTENT_ORGANIC: 'bgc_organic',
  USER_GENERATED_CONTENT_BOOSTED: 'ugc_boosted',
  USER_GENERATED_CONTENT_ORGANIC: 'ugc_organic',
};

export const normalizeStage = (s: string): string | null => STAGE[s.trim().toUpperCase()] ?? null;
export const normalizeContentType = (c: string): string | null => CONTENT_TYPE[c.trim().toUpperCase()] ?? null;
export const normalizeMetric = (m: string): string => m.trim().toLowerCase();

/** `numeric` arrives as a string; keep "not provided" as null, never 0. */
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ─── Linking ─────────────────────────────────────────────────────────────────

/**
 * The portal's `ttmsNameMatches` rule — one alphanumeric name contains the
 * other — plus a 3-character floor, so a two-letter slug cannot "contain-match"
 * half the category.
 */
export function ttmsNameMatches(a: string, b: string): boolean {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const x = key(a);
  const y = key(b);
  if (x.length < 3 || y.length < 3) return false;
  return x.includes(y) || y.includes(x);
}

export interface SourceTtmsAccount {
  ttmsAccountId: string;
  brandName: string;
  advertiserIds: string[];
}

export interface TempoPaidClient {
  clientId: string;
  slug: string;
  name: string;
  adAccountIds: string[];
}

export interface MarketScopeLink {
  ttmsAccountId: string;
  clientId: string;
  isPrimary: boolean;
}

/**
 * Which Tempo client each TTMS account belongs to, and which of a client's
 * accounts is its primary one.
 *
 * An advertiser can list several TTMS accounts (Purbasari's ad account also
 * lists Senka), so one client may get several. The primary is the one whose
 * TikTok name matches the client's name or slug; a client with a single
 * account gets it by default. With several and no single name match, none is
 * primary and the AM picks in `strategy_specs`. An account whose advertisers
 * reach several clients goes to the one it name-matches, or stays unlinked.
 */
export function linkMarketScopeAccounts(
  accounts: readonly SourceTtmsAccount[],
  tempo: readonly TempoPaidClient[],
): { links: MarketScopeLink[]; unlinked: { ttmsAccountId: string; brandName: string; reason: string }[] } {
  const named = (a: SourceTtmsAccount, c: TempoPaidClient) =>
    ttmsNameMatches(a.brandName, c.name) || ttmsNameMatches(a.brandName, c.slug);

  const links: Omit<MarketScopeLink, 'isPrimary'>[] = [];
  const unlinked: { ttmsAccountId: string; brandName: string; reason: string }[] = [];
  for (const a of accounts) {
    const candidates = tempo.filter((c) => c.adAccountIds.some((id) => a.advertiserIds.includes(id)));
    if (candidates.length === 0) {
      unlinked.push({
        ttmsAccountId: a.ttmsAccountId,
        brandName: a.brandName,
        reason: a.advertiserIds.length ? 'no Tempo client has its ad account' : 'no linked ad account',
      });
      continue;
    }
    const pick = candidates.length === 1 ? candidates : candidates.filter((c) => named(a, c));
    if (pick.length !== 1) {
      unlinked.push({
        ttmsAccountId: a.ttmsAccountId,
        brandName: a.brandName,
        reason: `ad account shared by ${candidates.length} clients (${candidates.map((c) => c.slug).join(', ')})`,
      });
      continue;
    }
    links.push({ ttmsAccountId: a.ttmsAccountId, clientId: pick[0]!.clientId });
  }

  const byClient = new Map<string, Omit<MarketScopeLink, 'isPrimary'>[]>();
  for (const l of links) byClient.set(l.clientId, [...(byClient.get(l.clientId) ?? []), l]);
  const primary = new Set<string>();
  for (const [clientId, ls] of byClient) {
    if (ls.length === 1) {
      primary.add(ls[0]!.ttmsAccountId);
      continue;
    }
    const client = tempo.find((c) => c.clientId === clientId)!;
    const matches = ls.filter((l) => named(accounts.find((a) => a.ttmsAccountId === l.ttmsAccountId)!, client));
    if (matches.length === 1) primary.add(matches[0]!.ttmsAccountId);
  }
  return { links: links.map((l) => ({ ...l, isPrimary: primary.has(l.ttmsAccountId) })), unlinked };
}

// ─── Sync ────────────────────────────────────────────────────────────────────

const shiftDays = (ymd: string, days: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const CHUNK = 1000;

async function upsertChunks<T>(rows: readonly T[], write: (chunk: T[]) => Promise<unknown>): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) await write(rows.slice(i, i + CHUNK));
  return rows.length;
}

/** Drizzle property name for a snake_case column. */
const prop = (col: string) => col.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * `SET col = excluded.col` for every listed column. Drizzle keys `set` by the
 * table's JS property names and drops unknown keys without complaint, so the
 * keys here must be `brandTotal`, not `brand_total` — the integration test
 * asserts a re-sync really overwrites.
 */
const excluded = (cols: readonly string[]) =>
  Object.fromEntries(cols.map((c) => [prop(c), sql.raw(`excluded."${c}"`)]));

const AUDIENCE_VALUE_COLUMNS = [
  'brand_total', 'brand_new', 'brand_outflow', 'brand_ranking', 'total_brand_count',
  'bench_total_top5', 'bench_total_top10', 'bench_total_top25', 'bench_total_top50',
  'bench_new_top5', 'bench_new_top10', 'bench_new_top25', 'bench_new_top50',
  'bench_outflow_top5', 'bench_outflow_top10', 'bench_outflow_top25', 'bench_outflow_top50',
] as const;
const INSIGHT_VALUE_COLUMNS = [
  'brand_value', 'brand_share',
  'bench_value_top5', 'bench_value_top10', 'bench_value_top25', 'bench_value_top50',
  'bench_share_top5', 'bench_share_top10', 'bench_share_top25', 'bench_share_top50',
] as const;

export async function syncMarketScope(
  db: Database,
  pool: pg.Pool,
  {
    backfillDays = Number(process.env.MARKET_SCOPE_BACKFILL_DAYS) || 400,
    overlapDays = 14,
    onlyAccounts,
  }: MarketScopeSyncOptions = {},
): Promise<MarketScopeSyncResult> {
  const src = await pool.query<{
    ttms_account_id: string;
    brand_name: string;
    industry: string | null;
    region_code: string | null;
    plan: string | null;
    is_lite: boolean;
    unavailable_metrics: string[] | null;
    advertiser_ids: string[] | null;
    last_data_date: string | null;
  }>(
    `SELECT ttms_account_id, brand_name, NULLIF(industry, '') AS industry, region_code, NULLIF(plan, '') AS plan,
            is_lite, unavailable_metrics, advertiser_ids, last_data_date::text AS last_data_date
     FROM ttms_accounts
     WHERE accessible
     ORDER BY ttms_account_id;`,
  );
  const accounts = src.rows.filter((r) => !onlyAccounts || onlyAccounts.includes(r.ttms_account_id));

  const paid = await db
    .select({ clientId: clients.id, slug: clients.slug, name: clients.name, externalId: tiktokAccounts.externalId })
    .from(clients)
    .innerJoin(tiktokAccounts, and(eq(tiktokAccounts.clientId, clients.id), eq(tiktokAccounts.surface, 'paid')));
  const tempo = new Map<string, TempoPaidClient>();
  for (const p of paid) {
    const c = tempo.get(p.clientId) ?? { clientId: p.clientId, slug: p.slug, name: p.name, adAccountIds: [] };
    c.adAccountIds.push(p.externalId);
    tempo.set(p.clientId, c);
  }

  const { links, unlinked } = linkMarketScopeAccounts(
    accounts.map((a) => ({ ttmsAccountId: a.ttms_account_id, brandName: a.brand_name, advertiserIds: a.advertiser_ids ?? [] })),
    [...tempo.values()],
  );

  const results: MarketScopeAccountResult[] = [];
  for (const link of links) {
    const a = accounts.find((x) => x.ttms_account_id === link.ttmsAccountId)!;
    await db
      .insert(marketScopeAccounts)
      .values({
        ttmsAccountId: a.ttms_account_id,
        clientId: link.clientId,
        brandName: a.brand_name,
        vertical: a.industry,
        regionCode: a.region_code,
        plan: a.plan,
        isLite: a.is_lite,
        unavailableMetrics: a.unavailable_metrics ?? [],
        linkedAdvertiserIds: a.advertiser_ids ?? [],
        isPrimary: link.isPrimary,
        lastDataDate: a.last_data_date,
      })
      .onConflictDoUpdate({
        target: marketScopeAccounts.ttmsAccountId,
        set: {
          ...excluded([
            'client_id', 'brand_name', 'vertical', 'region_code', 'plan', 'is_lite',
            'unavailable_metrics', 'linked_advertiser_ids', 'is_primary', 'last_data_date',
          ]),
          syncedAt: sql`now()`,
        },
      });

    const result: MarketScopeAccountResult = {
      ttmsAccountId: a.ttms_account_id,
      brandName: a.brand_name,
      clientSlug: tempo.get(link.clientId)!.slug,
      isPrimary: link.isPrimary,
      from: null,
      to: null,
      audienceRows: 0,
      insightRows: 0,
      rankingRows: 0,
    };
    results.push(result);
    if (!a.last_data_date) continue;

    const [mirrored] = await db
      .select({ newest: max(marketScopeAudienceDaily.date) })
      .from(marketScopeAudienceDaily)
      .where(eq(marketScopeAudienceDaily.ttmsAccountId, a.ttms_account_id));
    const to = a.last_data_date;
    const from = mirrored?.newest ? shiftDays(mirrored.newest, -overlapDays) : shiftDays(to, -(backfillDays - 1));
    result.from = from;
    result.to = to;
    const window = [a.ttms_account_id, from, to];

    const audience = await pool.query<Record<string, unknown>>(
      `SELECT date::text AS date, stage, ${AUDIENCE_VALUE_COLUMNS.join(', ')}
       FROM ttms_audience_daily WHERE ttms_account_id = $1 AND date BETWEEN $2 AND $3;`,
      window,
    );
    const audienceRows = audience.rows.flatMap((r) => {
      const stage = normalizeStage(String(r.stage));
      if (!stage) return [];
      return [
        Object.fromEntries([
          ['ttmsAccountId', a.ttms_account_id],
          ['date', String(r.date)],
          ['stage', stage],
          ...AUDIENCE_VALUE_COLUMNS.map((c) => [prop(c), num(r[c])]),
        ]) as typeof marketScopeAudienceDaily.$inferInsert,
      ];
    });
    result.audienceRows = await upsertChunks(audienceRows, (chunk) =>
      db
        .insert(marketScopeAudienceDaily)
        .values(chunk)
        .onConflictDoUpdate({
          target: [marketScopeAudienceDaily.ttmsAccountId, marketScopeAudienceDaily.date, marketScopeAudienceDaily.stage],
          set: excluded(AUDIENCE_VALUE_COLUMNS),
        }),
    );

    const insights = await pool.query<Record<string, unknown>>(
      `SELECT date::text AS date, metric, content_type, brand_value, brand_share,
              bench_top5 AS bench_value_top5, bench_top10 AS bench_value_top10,
              bench_top25 AS bench_value_top25, bench_top50 AS bench_value_top50,
              bench_share_top5, bench_share_top10, bench_share_top25, bench_share_top50
       FROM ttms_insight_daily WHERE ttms_account_id = $1 AND date BETWEEN $2 AND $3;`,
      window,
    );
    const insightRows = insights.rows.flatMap((r) => {
      const contentType = normalizeContentType(String(r.content_type));
      if (!contentType) return [];
      return [
        Object.fromEntries([
          ['ttmsAccountId', a.ttms_account_id],
          ['date', String(r.date)],
          ['metric', normalizeMetric(String(r.metric))],
          ['contentType', contentType],
          ...INSIGHT_VALUE_COLUMNS.map((c) => [prop(c), num(r[c])]),
        ]) as typeof marketScopeInsightsDaily.$inferInsert,
      ];
    });
    result.insightRows = await upsertChunks(insightRows, (chunk) =>
      db
        .insert(marketScopeInsightsDaily)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            marketScopeInsightsDaily.ttmsAccountId,
            marketScopeInsightsDaily.date,
            marketScopeInsightsDaily.metric,
            marketScopeInsightsDaily.contentType,
          ],
          set: excluded(INSIGHT_VALUE_COLUMNS),
        }),
    );

    const rankings = await pool.query<{ date: string; stage: string; brand: string; ranking: number }>(
      `SELECT date::text AS date, stage, brand, ranking
       FROM ttms_ranking_daily WHERE ttms_account_id = $1 AND date BETWEEN $2 AND $3;`,
      window,
    );
    const rankingRows = rankings.rows.flatMap((r) => {
      const stage = normalizeStage(r.stage);
      return stage
        ? [{ ttmsAccountId: a.ttms_account_id, date: r.date, stage, brand: r.brand, ranking: Number(r.ranking) }]
        : [];
    });
    result.rankingRows = await upsertChunks(rankingRows, (chunk) =>
      db
        .insert(marketScopeRankingsDaily)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            marketScopeRankingsDaily.ttmsAccountId,
            marketScopeRankingsDaily.date,
            marketScopeRankingsDaily.stage,
            marketScopeRankingsDaily.brand,
          ],
          set: excluded(['ranking']),
        }),
    );
  }

  return { accounts: results, unlinked };
}

// ─── Verification (PRD §12 P1: "row counts match the portal per account per day") ──

export interface MirrorCountMismatch {
  ttmsAccountId: string;
  table: 'audience' | 'insights' | 'rankings';
  date: string;
  source: number;
  mirror: number;
}

const TABLES = [
  { key: 'audience', source: 'ttms_audience_daily', mirror: 'market_scope_audience_daily' },
  { key: 'insights', source: 'ttms_insight_daily', mirror: 'market_scope_insights_daily' },
  { key: 'rankings', source: 'ttms_ranking_daily', mirror: 'market_scope_rankings_daily' },
] as const;

/**
 * Per account, table and day, compare row counts between the portal and the
 * mirror over [from, to]. Only mirrored accounts are compared, and only from
 * each account's oldest mirrored day, so a deliberately bounded backfill is not
 * reported as missing history.
 */
export async function verifyMarketScopeMirror(
  db: Database,
  pool: pg.Pool,
  window: { from: string; to: string },
): Promise<MirrorCountMismatch[]> {
  const mirrored = await db.select({ id: marketScopeAccounts.ttmsAccountId }).from(marketScopeAccounts);
  const ids = mirrored.map((m) => m.id);
  if (ids.length === 0) return [];

  const mismatches: MirrorCountMismatch[] = [];
  for (const t of TABLES) {
    const source = await pool.query<{ id: string; date: string; n: string }>(
      `SELECT ttms_account_id AS id, date::text AS date, COUNT(*) AS n FROM ${t.source}
       WHERE ttms_account_id = ANY($1) AND date BETWEEN $2 AND $3 GROUP BY 1, 2;`,
      [ids, window.from, window.to],
    );
    const mirror = await db.execute<{ id: string; date: string; n: string; oldest: string }>(sql`
      SELECT ttms_account_id AS id, date::text AS date, COUNT(*)::text AS n,
             (MIN(date) OVER (PARTITION BY ttms_account_id))::text AS oldest
      FROM ${sql.raw(t.mirror)}
      WHERE date BETWEEN ${window.from} AND ${window.to}
      GROUP BY ttms_account_id, date
    `);
    const mirrorRows = (Array.isArray(mirror) ? mirror : (mirror as { rows: typeof mirror }).rows) as unknown as {
      id: string;
      date: string;
      n: string;
      oldest: string;
    }[];
    const counts = new Map(mirrorRows.map((r) => [`${r.id}|${r.date}`, Number(r.n)]));
    const oldest = new Map(mirrorRows.map((r) => [r.id, r.oldest]));
    const seen = new Set<string>();
    for (const s of source.rows) {
      const k = `${s.id}|${s.date}`;
      seen.add(k);
      const start = oldest.get(s.id);
      if (!start || s.date < start) continue;
      const m = counts.get(k) ?? 0;
      if (m !== Number(s.n)) mismatches.push({ ttmsAccountId: s.id, table: t.key, date: s.date, source: Number(s.n), mirror: m });
    }
    for (const r of mirrorRows) {
      if (!seen.has(`${r.id}|${r.date}`)) {
        mismatches.push({ ttmsAccountId: r.id, table: t.key, date: r.date, source: 0, mirror: Number(r.n) });
      }
    }
  }
  return mismatches.sort((a, b) => a.ttmsAccountId.localeCompare(b.ttmsAccountId) || a.date.localeCompare(b.date));
}
