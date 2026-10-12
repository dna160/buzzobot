import type pg from 'pg';

/**
 * Candidate accounts for the "populate benchmarks from industry peers"
 * feature. There is no industry/category taxonomy anywhere in the real
 * source database — `brands` has no such column (confirmed by inspecting
 * `information_schema.columns`) — so the only signal available is each
 * account's own name. Matching real names against LLM-suggested keywords
 * (done by the caller) is what stands in for a real taxonomy; this function
 * only supplies the real, verified candidate pool to match against.
 */
export interface CandidateBrandAccount {
  id: number;
  name: string;
  tiktokAdAccountId: string;
}

/** Every active brand account with a real TikTok ad account attached — the full real candidate pool. */
export async function listCandidateBrandAccounts(pool: pg.Pool): Promise<CandidateBrandAccount[]> {
  const { rows } = await pool.query<{ id: number; name: string; tiktok_ad_account_id: string }>(`
    SELECT id, name, tiktok_ad_account_id
    FROM brands
    WHERE deleted_at IS NULL AND tiktok_ad_account_id IS NOT NULL AND status = 'active'
    ORDER BY name;
  `);
  return rows.map((r) => ({ id: r.id, name: r.name, tiktokAdAccountId: r.tiktok_ad_account_id }));
}
