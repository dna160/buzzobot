import { and, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { tiktokAccounts } from '../schema.js';

/**
 * Every real (numeric) paid TikTok ad account id linked to a client, plus
 * whether a synthetic `${slug}-tiktok-ads` sentinel is also on record. A
 * hand-curated Premium brand (a `_daily_performance` table built from
 * several real accounts, e.g. Kanzler's 5) can have more than one real id —
 * a caller that only reads the first, like the old `getPaidTiktokAdAccountId`,
 * silently undercounts that brand's real activity.
 */
export async function getPaidTiktokAdAccountIds(db: Database, clientId: string): Promise<string[]> {
  const rows = await db
    .select({ externalId: tiktokAccounts.externalId })
    .from(tiktokAccounts)
    .where(and(eq(tiktokAccounts.clientId, clientId), eq(tiktokAccounts.surface, 'paid')));
  return rows.map((r) => r.externalId).filter((id) => /^\d+$/.test(id));
}

/** The client's first real paid TikTok ad account id, or null if none is on record. */
export async function getPaidTiktokAdAccountId(db: Database, clientId: string): Promise<string | null> {
  const ids = await getPaidTiktokAdAccountIds(db, clientId);
  return ids[0] ?? null;
}
