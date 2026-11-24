import pg from 'pg';
import { ClientTier } from '@tempo/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Database } from '../client.js';
import { agencies, brandIndustryTags, clients, tiktokAccounts } from '../schema.js';
import { discoverPostgresBrands, formatBrandSlug, INGESTIBLE_BRAND_STATUSES } from './discovery.js';
import { syncStandardBrandToDomain } from './sanitize.js';
import { acquireSyncLock } from './sync-lock.js';

/**
 * Register or remove individual Standard brands on request, instead of waiting
 * for the nightly sanitize run or a full auto-sync pass. Backs
 * `POST /api/clients/sync`, which the Buzzohero portal calls right after its
 * "Sync Buzzohero BC" creates (or re-activates) brands.
 *
 * Registration goes through the same `discoverPostgresBrands` and
 * `syncStandardBrandToDomain` the full pass uses, so a client registered here
 * is the client the next nightly run would have made — same slug, colour,
 * currency, timezone, north star and tier — and that run's upsert finds it
 * already in place. Premium brands are never touched here: their curated
 * `*_daily_performance` tables belong to the full pass.
 */

/** The Buzzohero agency in the portal's `brands` table. */
const BUZZOHERO_AGENCY_ID = 1;
/** The agency `syncStandardBrandToDomain` files every Buzzohero client under. */
const TEMPO_AGENCY_SLUG = 'buzzo-media';

export interface BrandSyncRequest {
  /** `brands.id`s to register (or refresh) as Standard clients. */
  brandIds?: readonly number[];
  /** `brands.id`s whose Standard Tempo client should be deleted with everything under it. */
  removeBrandIds?: readonly number[];
  /** How long to wait for a running sync pass before giving up. */
  lockTimeoutMs?: number;
}

export interface BrandSyncResult {
  registered: Array<{ brand_id: number; slug: string; rows_ingested: number }>;
  removed: Array<{ brand_id: number; slug: string }>;
  skipped: Array<{ brand_id: number; reason: string }>;
}

export type BrandSyncOutcome = { status: 'done'; result: BrandSyncResult } | { status: 'busy' };

/** The live warehouse is not configured on this deployment (no `DB_HOST` etc.). */
export class WarehouseNotConfiguredError extends Error {
  constructor() {
    super('The Buzzohero warehouse (DB_HOST / DB_NAME / DB_USER) is not configured on this deployment.');
    this.name = 'WarehouseNotConfiguredError';
  }
}

interface BrandRow {
  id: number;
  agency_id: number | null;
  status: string | null;
  name: string;
  tempo_slug: string | null;
  tiktok_ad_account_id: string | null;
}

/** Same connection settings `fetchSanitizeAndSeed` reads. */
function warehousePoolFromEnv(): pg.Pool {
  const host = process.env.DB_HOST;
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  if (!host || !database || !user) throw new WarehouseNotConfiguredError();
  return new pg.Pool({
    host,
    port: Number(process.env.DB_PORT),
    database,
    user,
    password: process.env.DB_PASSWORD,
  });
}

/** The slug discovery gives a `brands` row: `tempo_slug`, else the name slugified. */
function brandSlug(row: Pick<BrandRow, 'name' | 'tempo_slug'>): string {
  return row.tempo_slug?.trim() || formatBrandSlug(row.name);
}

async function loadBrandRows(pool: pg.Pool, ids: readonly number[]): Promise<Map<number, BrandRow>> {
  const res = await pool.query<BrandRow>(
    `SELECT id, agency_id, status, name, tempo_slug, tiktok_ad_account_id
       FROM brands
      WHERE id = ANY($1::int[])`,
    [ids],
  );
  return new Map(res.rows.map((r) => [Number(r.id), r]));
}

/** Why a portal row can't be a Buzzohero client at all, or `null` if it can. */
function ineligibility(row: BrandRow | undefined): string | null {
  if (!row) return 'brand not found';
  if (Number(row.agency_id) !== BUZZOHERO_AGENCY_ID) return `not a Buzzohero brand (agency_id ${row.agency_id ?? 'null'})`;
  return null;
}

async function registerBrands(
  db: Database,
  pool: pg.Pool,
  ids: readonly number[],
  result: BrandSyncResult,
): Promise<void> {
  const rows = await loadBrandRows(pool, ids);
  const discovered = await discoverPostgresBrands(pool, { brandIds: ids });

  for (const id of ids) {
    const row = rows.get(id);
    const notOurs = ineligibility(row);
    if (notOurs) {
      result.skipped.push({ brand_id: id, reason: notOurs });
      continue;
    }
    if (!(INGESTIBLE_BRAND_STATUSES as readonly string[]).includes(row!.status ?? '')) {
      result.skipped.push({ brand_id: id, reason: `status "${row!.status ?? 'null'}" is not ingestible` });
      continue;
    }

    const entry = discovered.find((b) => b.brandIds?.includes(id));
    if (!entry) {
      // Eligible, yet discovery gave it no entry of its own: its slug is empty
      // or already taken by another brand that sorts first.
      const slug = brandSlug(row!);
      result.skipped.push({
        brand_id: id,
        reason: slug ? `slug "${slug}" is already used by another brand` : 'brand name gives an empty slug',
      });
      continue;
    }
    if (entry.tier !== ClientTier.Standard) {
      result.skipped.push({ brand_id: id, reason: 'premium brand, handled by the full sync' });
      continue;
    }

    try {
      const stats = await syncStandardBrandToDomain(db, entry, pool);
      result.registered.push({ brand_id: id, slug: entry.slug, rows_ingested: stats.dailyIngested });
    } catch (err) {
      result.skipped.push({ brand_id: id, reason: `registration failed: ${errorMessage(err)}` });
    }
  }
}

async function removeBrands(
  db: Database,
  pool: pg.Pool,
  ids: readonly number[],
  result: BrandSyncResult,
): Promise<void> {
  const rows = await loadBrandRows(pool, ids);

  for (const id of ids) {
    const row = rows.get(id);
    const notOurs = ineligibility(row);
    if (notOurs) {
      result.skipped.push({ brand_id: id, reason: notOurs });
      continue;
    }
    const slug = brandSlug(row!);
    if (!slug) {
      result.skipped.push({ brand_id: id, reason: 'brand name gives an empty slug' });
      continue;
    }

    const [client] = await db
      .select({ id: clients.id, tier: clients.tier })
      .from(clients)
      .innerJoin(agencies, eq(agencies.id, clients.agencyId))
      .where(and(eq(agencies.slug, TEMPO_AGENCY_SLUG), eq(clients.slug, slug)))
      .limit(1);
    if (!client) {
      result.skipped.push({ brand_id: id, reason: `no Tempo client with slug "${slug}"` });
      continue;
    }
    if (client.tier !== ClientTier.Standard) {
      result.skipped.push({ brand_id: id, reason: `"${slug}" is a ${client.tier} client; only standard clients can be removed here` });
      continue;
    }

    // The slug alone is not proof the client is this brand's — two portal rows
    // can slugify alike. A Standard client always owns the paid account
    // `syncStandardBrandToDomain` gave it; require that before deleting.
    const externalId = row!.tiktok_ad_account_id || `${slug}-tiktok-ads`;
    const accounts = await db
      .select({ id: tiktokAccounts.id, externalId: tiktokAccounts.externalId })
      .from(tiktokAccounts)
      .where(eq(tiktokAccounts.clientId, client.id));
    if (!accounts.some((a) => a.externalId === externalId)) {
      result.skipped.push({
        brand_id: id,
        reason: `client "${slug}" does not own this brand's ad account ${externalId}; not removed`,
      });
      continue;
    }

    try {
      await db.transaction(async (tx) => {
        // Every table hanging off `clients` (tiktok_accounts → campaigns →
        // daily/hourly facts, adgroups, sync_runs, videos; report_links,
        // report_specs/runs/benchmarks, template_report_runs, strategy_*,
        // market_scope_links) is declared ON DELETE CASCADE, so this one
        // delete takes all of it. A table added later without a cascade makes
        // it fail and roll back rather than leave orphans.
        await tx.delete(clients).where(eq(clients.id, client.id));
        // Industry tags are keyed by ad account, not client: drop them only
        // when no other Tempo account still uses that ad account.
        const ext = accounts.map((a) => a.externalId);
        await tx.delete(brandIndustryTags).where(
          and(
            inArray(brandIndustryTags.tiktokAdAccountId, ext),
            sql`NOT EXISTS (SELECT 1 FROM ${tiktokAccounts} WHERE ${tiktokAccounts.externalId} = ${brandIndustryTags.tiktokAdAccountId})`,
          ),
        );
      });
      result.removed.push({ brand_id: id, slug });
    } catch (err) {
      result.skipped.push({ brand_id: id, reason: `removal failed: ${errorMessage(err)}` });
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Register and/or remove the given brands, under the shared sync lock.
 *
 * Returns `busy` when a sync pass still held the lock after `lockTimeoutMs`.
 * Never starts a full pass. Throws `WarehouseNotConfiguredError` when there is
 * no warehouse to read the brands from.
 */
export async function syncBrandsById(request: BrandSyncRequest): Promise<BrandSyncOutcome> {
  const brandIds = request.brandIds ?? [];
  const removeBrandIds = request.removeBrandIds ?? [];

  // Fail on configuration before queueing behind a pass we could not help.
  const pool = warehousePoolFromEnv();
  try {
    const release = await acquireSyncLock(request.lockTimeoutMs ?? 50_000);
    if (!release) return { status: 'busy' };
    try {
      // The process-wide handle, as every route uses — never closed here.
      // `fetchSanitizeAndSeed` additionally opens a PGlite *staging* instance
      // for Premium hourly rows (the handle leak `auto-sync.ts` describes);
      // Standard brands never touch that cache, so none is opened.
      const { db } = getDb();
      const result: BrandSyncResult = { registered: [], removed: [], skipped: [] };
      if (brandIds.length > 0) await registerBrands(db, pool, brandIds, result);
      if (removeBrandIds.length > 0) await removeBrands(db, pool, removeBrandIds, result);
      return { status: 'done', result };
    } finally {
      release();
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

