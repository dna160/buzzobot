import { eq, and, notInArray } from 'drizzle-orm';
import type { Database } from '../client.js';
import { brandIndustryTags } from '../schema.js';

/**
 * Real Buzzohero accounts tagged with an industry (see `schema.ts`'s
 * `brandIndustryTags` doc comment) — a one-time Claude categorization pass,
 * not a runtime LLM call, and not string-matching. This is Tempo's own
 * enrichment table, keyed by the real `tiktokAdAccountId`.
 */

export interface BrandIndustryTagInput {
  tiktokAdAccountId: string;
  name: string;
  industry: string;
  confidence: 'high' | 'medium';
}

/** Bulk upsert — safe to re-run the categorization pass; re-tagging an account replaces its row. */
export async function upsertBrandIndustryTags(db: Database, rows: BrandIndustryTagInput[]): Promise<void> {
  for (const row of rows) {
    await db
      .insert(brandIndustryTags)
      .values({ ...row, source: 'claude-categorized' })
      .onConflictDoUpdate({
        target: brandIndustryTags.tiktokAdAccountId,
        set: { name: row.name, industry: row.industry, confidence: row.confidence },
      });
  }
}

/** This account's industry code, if it's been categorized. */
export async function getBrandIndustry(db: Database, tiktokAdAccountId: string): Promise<string | null> {
  const [row] = await db
    .select({ industry: brandIndustryTags.industry })
    .from(brandIndustryTags)
    .where(eq(brandIndustryTags.tiktokAdAccountId, tiktokAdAccountId))
    .limit(1);
  return row?.industry ?? null;
}

/** Every other real account tagged with this industry — the real peer candidate pool for one benchmark run. */
export async function listPeersByIndustry(
  db: Database,
  industry: string,
  excludeAccountIds: string[],
): Promise<Array<{ tiktokAdAccountId: string; name: string }>> {
  const rows = await db
    .select({ tiktokAdAccountId: brandIndustryTags.tiktokAdAccountId, name: brandIndustryTags.name })
    .from(brandIndustryTags)
    .where(
      excludeAccountIds.length > 0
        ? and(eq(brandIndustryTags.industry, industry), notInArray(brandIndustryTags.tiktokAdAccountId, excludeAccountIds))
        : eq(brandIndustryTags.industry, industry),
    );
  return rows;
}

/** Every distinct industry code currently in use — for a UI dropdown or sanity-checking coverage. */
export async function listTaggedIndustries(db: Database): Promise<string[]> {
  const rows = await db.selectDistinct({ industry: brandIndustryTags.industry }).from(brandIndustryTags);
  return rows.map((r) => r.industry);
}

/** Wipes every tag — for re-running the categorization pass from scratch. */
export async function clearBrandIndustryTags(db: Database): Promise<void> {
  await db.delete(brandIndustryTags);
}
