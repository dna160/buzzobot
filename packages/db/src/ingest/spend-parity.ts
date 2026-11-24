import type pg from 'pg';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { campaigns, clients, paidHourlyMetrics, tiktokAccounts } from '../schema.js';

/**
 * Does Tempo's spend agree with the warehouse it was copied from?
 *
 * Every Tempo surface that reports spend — the Brief Deck, the hourly view and
 * all of tempo-engine — reads `paid_hourly_metrics` campaign-rollup rows. The
 * portal reads `tiktok_ads_analytics`, one row per ad account per day. The two
 * diverged silently once already: GMV Max spend that only analytics carried
 * never reached Tempo, so BARDI read Rp11.1M against the portal's Rp43.3M and
 * Kalibre read nothing at all. This check is what catches the next one.
 *
 * Definitions (measured, not assumed — see docs/phases/strategy-report/P0_DISCOVERY.md §5):
 *  - `sourceGross` = Σ `cost + gmv_max_cost`. Tempo's auction spend equals
 *    `tiktok_ads_analytics.cost` exactly for every client checked, credits
 *    included, so this is the figure Tempo must match.
 *  - `portalCost` = Σ `cost_cash + gmv_max_cost`, the portal's displayed Cost.
 *    It leaves out spend paid with ad credits.
 *  - `credits` = `sourceGross − portalCost`. Reported, never a failure: the gap
 *    is a definition difference (gross vs cash), not missing data.
 *
 * USD analytics rows are excluded from every figure, as the portal does for
 * Rupiah totals; `usdDays` says when that happened.
 */

export interface ClientSpend {
  clientId: string;
  slug: string;
  adAccountIds: string[];
  tempo: number;
}

export interface SourceSpend {
  cost: number;
  cash: number;
  gmvMax: number;
  usdDays: number;
}

export interface SpendParityRow {
  slug: string;
  adAccountIds: string[];
  tempo: number;
  sourceGross: number;
  portalCost: number;
  credits: number;
  /** (tempo − sourceGross) ÷ sourceGross; null when the source is 0. */
  diffPct: number | null;
  usdDays: number;
  ok: boolean;
}

export const DEFAULT_PARITY_TOLERANCE = 0.001;

/** Pure comparison, so the pass/fail rule is unit-testable without a database. */
export function compareSpend(
  tempo: readonly ClientSpend[],
  source: ReadonlyMap<string, SourceSpend>,
  tolerance = DEFAULT_PARITY_TOLERANCE,
): SpendParityRow[] {
  return tempo.map((c) => {
    const s = c.adAccountIds.reduce<SourceSpend>(
      (acc, id) => {
        const r = source.get(id);
        return r
          ? { cost: acc.cost + r.cost, cash: acc.cash + r.cash, gmvMax: acc.gmvMax + r.gmvMax, usdDays: acc.usdDays + r.usdDays }
          : acc;
      },
      { cost: 0, cash: 0, gmvMax: 0, usdDays: 0 },
    );
    const sourceGross = s.cost + s.gmvMax;
    const portalCost = s.cash + s.gmvMax;
    const diff = c.tempo - sourceGross;
    // Absolute floor of Rp1 so two zeros, or float dust on a zero source, pass.
    const ok = Math.abs(diff) <= Math.max(1, tolerance * sourceGross);
    return {
      slug: c.slug,
      adAccountIds: c.adAccountIds,
      tempo: c.tempo,
      sourceGross,
      portalCost,
      credits: sourceGross - portalCost,
      diffPct: sourceGross > 0 ? diff / sourceGross : null,
      usdDays: s.usdDays,
      ok,
    };
  });
}

export interface ParityWindow {
  from: string;
  to: string;
}

/** Tempo spend per client over [from, to], from campaign-rollup rows only. */
export async function fetchTempoSpend(db: Database, window: ParityWindow): Promise<ClientSpend[]> {
  const accounts = await db
    .select({ clientId: clients.id, slug: clients.slug, externalId: tiktokAccounts.externalId })
    .from(clients)
    .innerJoin(tiktokAccounts, and(eq(tiktokAccounts.clientId, clients.id), eq(tiktokAccounts.surface, 'paid')));

  const spend = await db
    .select({ clientId: tiktokAccounts.clientId, spend: sql<string>`coalesce(sum(${paidHourlyMetrics.spend}), 0)` })
    .from(paidHourlyMetrics)
    .innerJoin(campaigns, eq(paidHourlyMetrics.campaignId, campaigns.id))
    .innerJoin(tiktokAccounts, eq(campaigns.accountId, tiktokAccounts.id))
    .where(
      and(
        isNull(paidHourlyMetrics.adgroupId),
        gte(paidHourlyMetrics.date, window.from),
        lte(paidHourlyMetrics.date, window.to),
      ),
    )
    .groupBy(tiktokAccounts.clientId);
  const spendByClient = new Map(spend.map((r) => [r.clientId, Number(r.spend) || 0]));

  const byClient = new Map<string, ClientSpend>();
  for (const a of accounts) {
    const c = byClient.get(a.clientId) ?? { clientId: a.clientId, slug: a.slug, adAccountIds: [], tempo: spendByClient.get(a.clientId) ?? 0 };
    c.adAccountIds.push(a.externalId);
    byClient.set(a.clientId, c);
  }
  return [...byClient.values()];
}

/** Warehouse spend per ad account over [from, to]. */
export async function fetchSourceSpend(
  pool: pg.Pool,
  adAccountIds: readonly string[],
  window: ParityWindow,
): Promise<Map<string, SourceSpend>> {
  const res = await pool.query<{ ad_account_id: string; cost: string; cash: string; gmv: string; usd_days: string }>(
    `SELECT ad_account_id,
            SUM(CASE WHEN upper(coalesce(currency, '')) = 'USD' THEN 0 ELSE coalesce(cost, 0) END) AS cost,
            SUM(CASE WHEN upper(coalesce(currency, '')) = 'USD' THEN 0 ELSE coalesce(cost_cash, 0) END) AS cash,
            SUM(CASE WHEN upper(coalesce(currency, '')) = 'USD' THEN 0 ELSE coalesce(gmv_max_cost, 0) END) AS gmv,
            COUNT(*) FILTER (WHERE upper(coalesce(currency, '')) = 'USD') AS usd_days
     FROM tiktok_ads_analytics
     WHERE ad_account_id = ANY($1) AND date BETWEEN $2 AND $3
     GROUP BY ad_account_id;`,
    [adAccountIds, window.from, window.to],
  );
  return new Map(
    res.rows.map((r) => [
      r.ad_account_id,
      { cost: Number(r.cost) || 0, cash: Number(r.cash) || 0, gmvMax: Number(r.gmv) || 0, usdDays: Number(r.usd_days) || 0 },
    ]),
  );
}

/**
 * The full check. Clients with no spend on either side in the window are left
 * out — they are demo tenants or dormant brands, not evidence.
 */
export async function checkSpendParity(
  db: Database,
  pool: pg.Pool,
  window: ParityWindow,
  tolerance = DEFAULT_PARITY_TOLERANCE,
): Promise<SpendParityRow[]> {
  const tempo = await fetchTempoSpend(db, window);
  const source = await fetchSourceSpend(pool, [...new Set(tempo.flatMap((c) => c.adAccountIds))], window);
  return compareSpend(tempo, source, tolerance).filter((r) => r.tempo !== 0 || r.sourceGross !== 0);
}

/** Default window: 28 days ending 3 days ago (UTC), past the warehouse's settling lag. */
export function defaultParityWindow(today = new Date()): ParityWindow {
  const shift = (days: number) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  return { from: shift(30), to: shift(3) };
}
