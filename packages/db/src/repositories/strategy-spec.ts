import { asc, desc, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { marketScopeAccounts, marketScopeLinks, strategySpecs } from '../schema.js';

/**
 * Storage for per-client Strategy Report specs (PRD §6.4, §9.5).
 *
 * Schema-agnostic like `report-spec.ts`: this module stores the flat row and
 * `@tempo/reports` (`parseStrategySpec`) owns what a valid spec is, so the
 * editor and the report never check against two different definitions.
 */

export interface StrategySpecRow {
  ttmsAccountId: string | null;
  reportClassOverride: string | null;
  goalKind: string | null;
  goalStage: string | null;
  goalMetric: string | null;
  goalValue: number | null;
  goalDeadline: string | null;
  creatorFeeMonthly: number | null;
  bgcCostMonthly: number | null;
}

export interface StoredStrategySpec extends StrategySpecRow {
  clientId: string;
  updatedBy: string | null;
  updatedAt: Date;
}

export async function getStrategySpec(db: Database, clientId: string): Promise<StoredStrategySpec | null> {
  const [row] = await db.select().from(strategySpecs).where(eq(strategySpecs.clientId, clientId)).limit(1);
  return row ?? null;
}

/** One row per client — saving twice replaces. */
export async function upsertStrategySpec(
  db: Database,
  clientId: string,
  row: StrategySpecRow,
  updatedBy: string | null = null,
): Promise<void> {
  const values = { ...row, updatedBy, updatedAt: new Date() };
  await db
    .insert(strategySpecs)
    .values({ clientId, ...values })
    .onConflictDoUpdate({ target: strategySpecs.clientId, set: values });
}

/** Back to defaults: inferred class, no goal, no fees. */
export async function deleteStrategySpec(db: Database, clientId: string): Promise<void> {
  await db.delete(strategySpecs).where(eq(strategySpecs.clientId, clientId));
}

export interface MarketScopeAccountSummary {
  ttmsAccountId: string;
  brandName: string;
  vertical: string | null;
  isLite: boolean;
  isPrimary: boolean;
  unavailableMetrics: string[];
  lastDataDate: string | null;
  syncedAt: Date;
}

/**
 * The window a Strategy Report run for this client will cover, without
 * calling the engine: the same rule as `strategy_read.py` — the report's TTMS
 * account (the spec's choice, else the primary), `as_of` = its settled day,
 * clamped to `endDate`. The route keys its warm cache on this. Null when the
 * client has no mirrored account, which is also the engine's 404.
 */
export async function resolveStrategyWindow(
  db: Database,
  clientId: string,
  { endDate, days = 28 }: { endDate?: string; days?: number } = {},
): Promise<{ ttmsAccountId: string; asOf: string; periodStart: string; periodEnd: string } | null> {
  const spec = await getStrategySpec(db, clientId);
  const accounts = await listMarketScopeAccounts(db, clientId);
  const account = accounts.find((a) => a.ttmsAccountId === spec?.ttmsAccountId) ?? accounts[0];
  if (!account?.lastDataDate) return null;
  const asOf = endDate && endDate < account.lastDataDate ? endDate : account.lastDataDate;
  const start = new Date(`${asOf}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { ttmsAccountId: account.ttmsAccountId, asOf, periodStart: start.toISOString().slice(0, 10), periodEnd: asOf };
}

/** Clients served by at least one mirrored TTMS account — who the weekly cron makes a Strategy Report for. */
export async function listMarketScopeClientIds(db: Database): Promise<Set<string>> {
  const rows = await db.selectDistinct({ clientId: marketScopeLinks.clientId }).from(marketScopeLinks);
  return new Set(rows.map((r) => r.clientId));
}

/**
 * A client's mirrored TTMS accounts, primary first — the spec editor's account
 * picker. An account shared by several clients (one brand, several ad
 * accounts) appears for each of them, with that client's own primary flag.
 */
export async function listMarketScopeAccounts(db: Database, clientId: string): Promise<MarketScopeAccountSummary[]> {
  return db
    .select({
      ttmsAccountId: marketScopeAccounts.ttmsAccountId,
      brandName: marketScopeAccounts.brandName,
      vertical: marketScopeAccounts.vertical,
      isLite: marketScopeAccounts.isLite,
      isPrimary: marketScopeLinks.isPrimary,
      unavailableMetrics: marketScopeAccounts.unavailableMetrics,
      lastDataDate: marketScopeAccounts.lastDataDate,
      syncedAt: marketScopeAccounts.syncedAt,
    })
    .from(marketScopeLinks)
    .innerJoin(marketScopeAccounts, eq(marketScopeAccounts.ttmsAccountId, marketScopeLinks.ttmsAccountId))
    .where(eq(marketScopeLinks.clientId, clientId))
    .orderBy(desc(marketScopeLinks.isPrimary), asc(marketScopeAccounts.brandName));
}
