import { eq } from 'drizzle-orm';
import type { DateRange } from '@tempo/core';
import type { AccountDTO, TikTokDataProvider } from '@tempo/tiktok';
import type { Database } from '../client.js';
import { syncRuns } from '../schema.js';
import {
  findAccountId,
  upsertAdgroups,
  upsertCampaigns,
  upsertOrganicMetrics,
  upsertPaidHourlyMetrics,
  upsertPaidMetrics,
  upsertVideos,
} from '../repositories/writes.js';

export interface IngestResult {
  surface: AccountDTO['surface'];
  externalId: string;
  rowsIngested: number;
  status: 'succeeded' | 'failed';
  error?: string;
}

/**
 * Ingest one account for a date window. Fetches dimension entities
 * (campaigns/videos) and their daily facts from the provider, writes them
 * idempotently, and records a sync_run for observability. A failure is captured
 * on the run row rather than thrown, so a multi-account sync is resilient.
 */
export async function ingestAccount(
  db: Database,
  provider: TikTokDataProvider,
  account: AccountDTO,
  range: DateRange,
  opts: { isBackfill?: boolean } = {},
): Promise<IngestResult> {
  const accountId = await findAccountId(db, account.surface, account.externalId);
  if (!accountId) {
    return {
      surface: account.surface,
      externalId: account.externalId,
      rowsIngested: 0,
      status: 'failed',
      error: `Account ${account.surface}:${account.externalId} is not connected`,
    };
  }

  const [run] = await db
    .insert(syncRuns)
    .values({
      accountId,
      surface: account.surface,
      status: 'running',
      windowStart: range.start,
      windowEnd: range.end,
      isBackfill: opts.isBackfill ?? false,
    })
    .returning({ id: syncRuns.id });

  try {
    let rowsIngested = 0;

    if (account.surface === 'paid') {
      const campaigns = await provider.listCampaigns(account.externalId);
      const idMap = await upsertCampaigns(db, accountId, campaigns);
      const metrics = await provider.getPaidDailyMetrics(account.externalId, range);
      rowsIngested = await upsertPaidMetrics(db, idMap, metrics);

      // Intraday facts, when the provider is backed by an hourly source.
      // Feature-detected so daily-only providers (live, fixture) are untouched.
      if (provider.listAdgroups && provider.getPaidHourlyMetrics) {
        const adgroupMap = await upsertAdgroups(db, idMap, await provider.listAdgroups(account.externalId));
        const hourly = await provider.getPaidHourlyMetrics(account.externalId, range);
        rowsIngested += await upsertPaidHourlyMetrics(db, idMap, adgroupMap, hourly);
      }
    } else {
      const videos = await provider.listVideos(account.externalId);
      const idMap = await upsertVideos(db, accountId, videos);
      const metrics = await provider.getOrganicDailyMetrics(account.externalId, range);
      rowsIngested = await upsertOrganicMetrics(db, idMap, metrics);
    }

    if (run) {
      await db
        .update(syncRuns)
        .set({ status: 'succeeded', rowsIngested, finishedAt: new Date() })
        .where(eqId(run.id));
    }

    return { surface: account.surface, externalId: account.externalId, rowsIngested, status: 'succeeded' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await db
        .update(syncRuns)
        .set({ status: 'failed', error: message, finishedAt: new Date() })
        .where(eqId(run.id));
    }
    return {
      surface: account.surface,
      externalId: account.externalId,
      rowsIngested: 0,
      status: 'failed',
      error: message,
    };
  }
}

const eqId = (id: string) => eq(syncRuns.id, id);
