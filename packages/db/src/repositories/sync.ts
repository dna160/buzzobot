import { desc, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { syncRuns, tiktokAccounts } from '../schema.js';

/** Most recent sync runs for a client's accounts — powers the "freshness" UI. */
export async function recentSyncRuns(db: Database, clientId: string, limit = 10) {
  return db
    .select({
      id: syncRuns.id,
      surface: syncRuns.surface,
      status: syncRuns.status,
      windowStart: syncRuns.windowStart,
      windowEnd: syncRuns.windowEnd,
      rowsIngested: syncRuns.rowsIngested,
      error: syncRuns.error,
      startedAt: syncRuns.startedAt,
      finishedAt: syncRuns.finishedAt,
    })
    .from(syncRuns)
    .innerJoin(tiktokAccounts, eq(syncRuns.accountId, tiktokAccounts.id))
    .where(eq(tiktokAccounts.clientId, clientId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(limit);
}
