import { syncBrandsById, WarehouseNotConfiguredError } from '@tempo/db';
import { authenticateApiKey } from '@/lib/api-auth';

/**
 * POST /api/clients/sync
 *   body: { brand_ids?: number[], remove_brand_ids?: number[] }   (portal `brands.id`s)
 *   → { registered: [{ brand_id, slug, rows_ingested }], removed: [{ brand_id, slug }],
 *       skipped: [{ brand_id, reason }] }
 *
 * Called by the Buzzohero portal right after "Sync Buzzohero BC" creates or
 * re-activates brands, so they show up here at once instead of after the
 * nightly run. `brand_ids` registers Standard brands exactly as the full sync
 * would; `remove_brand_ids` deletes a Standard client and everything under it
 * (test-brand cleanup). Premium brands are left to the full sync.
 *
 * Shares the in-process sync lock with the auto-sync: while a pass is running
 * this waits for it, then answers 503 `{ "error": "busy" }`. It never starts a
 * full pass itself.
 *
 * API key only (`authenticateApiKey`), like `/api/report-links`: this app's
 * own UI never calls it, and it deletes data, so the same-origin shortcut in
 * `authenticate()` — headers any non-browser client can set — must not apply.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_IDS_PER_LIST = 50;
/**
 * How long to queue behind a running pass. Under the portal's 60 s timeout so
 * the 503 actually reaches it, with room left for the work itself.
 */
const LOCK_TIMEOUT_MS = 45_000;

type IdList = { ok: true; ids: number[] } | { ok: false; error: string };

function parseIds(value: unknown, field: string): IdList {
  if (value === undefined || value === null) return { ok: true, ids: [] };
  if (!Array.isArray(value)) return { ok: false, error: `${field} must be an array of brand ids` };
  if (!value.every((v) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0)) {
    return { ok: false, error: `${field} must contain positive integers only` };
  }
  const ids = [...new Set(value as number[])];
  if (ids.length > MAX_IDS_PER_LIST) {
    return { ok: false, error: `${field} may hold at most ${MAX_IDS_PER_LIST} ids` };
  }
  return { ok: true, ids };
}

const noStore = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const auth = authenticateApiKey(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status ?? 401 });
  const keyId = auth.caller?.kind === 'api-key' ? auth.caller.keyId : 'unknown';

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'body must be a JSON object' }, { status: 400, headers: noStore });
  }
  const register = parseIds(body.brand_ids, 'brand_ids');
  if (!register.ok) return Response.json({ error: register.error }, { status: 400, headers: noStore });
  const remove = parseIds(body.remove_brand_ids, 'remove_brand_ids');
  if (!remove.ok) return Response.json({ error: remove.error }, { status: 400, headers: noStore });
  if (register.ids.length === 0 && remove.ids.length === 0) {
    return Response.json(
      { error: 'send a non-empty brand_ids or remove_brand_ids' },
      { status: 400, headers: noStore },
    );
  }
  const both = register.ids.filter((id) => remove.ids.includes(id));
  if (both.length > 0) {
    return Response.json(
      { error: `ids in both brand_ids and remove_brand_ids: ${both.join(', ')}` },
      { status: 400, headers: noStore },
    );
  }

  const started = Date.now();
  const ids = `register=[${register.ids.join(',')}] remove=[${remove.ids.join(',')}]`;
  try {
    const outcome = await syncBrandsById({
      brandIds: register.ids,
      removeBrandIds: remove.ids,
      lockTimeoutMs: LOCK_TIMEOUT_MS,
    });
    if (outcome.status === 'busy') {
      console.log(`[clients-sync] caller=${keyId} ${ids} → busy after ${Date.now() - started}ms`);
      return Response.json({ error: 'busy' }, { status: 503, headers: { ...noStore, 'Retry-After': '60' } });
    }
    const { result } = outcome;
    console.log(
      `[clients-sync] caller=${keyId} ${ids} → registered=${result.registered.length} ` +
        `removed=${result.removed.length} skipped=${result.skipped.length} in ${Date.now() - started}ms`,
    );
    return Response.json(result, { status: 200, headers: noStore });
  } catch (err) {
    if (err instanceof WarehouseNotConfiguredError) {
      console.log(`[clients-sync] caller=${keyId} ${ids} → warehouse not configured`);
      return Response.json({ error: err.message }, { status: 503, headers: noStore });
    }
    console.error(`[clients-sync] caller=${keyId} ${ids} → failed after ${Date.now() - started}ms:`, err);
    return Response.json({ error: 'sync failed' }, { status: 500, headers: noStore });
  }
}
