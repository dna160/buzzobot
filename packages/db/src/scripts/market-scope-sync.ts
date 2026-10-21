import { getDb } from '../client.js';
import { createSourcePool } from '../ingest/template-report-data.js';
import { syncMarketScope, verifyMarketScopeMirror } from '../ingest/market-scope-sync.js';

/**
 * `pnpm db:market-scope [--verify-only] [--backfill-days 400] [--account <ttms id>] [--from YYYY-MM-DD --to YYYY-MM-DD]`
 *
 * Mirrors the portal's TTMS tables into `market_scope_*` (the same step the
 * sanitizer runs), then checks row counts per account, table and day against
 * the portal — the Strategy Report P1 exit check. `--verify-only` skips the
 * write. Exits 1 when any count differs.
 */

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

async function main() {
  const pool = createSourcePool();
  if (!pool) {
    console.error('DB_HOST / DB_NAME / DB_USER are not set — no portal database to mirror from.');
    process.exit(2);
  }
  const handle = getDb();
  try {
    if (!process.argv.includes('--verify-only')) {
      const account = arg('account');
      const days = arg('backfill-days');
      const res = await syncMarketScope(handle.db, pool, {
        ...(days ? { backfillDays: Number(days) } : {}),
        ...(account ? { onlyAccounts: [account] } : {}),
      });
      console.table(
        res.accounts.map((a) => ({
          ttms: a.brandName,
          client: a.clientSlug,
          primary: a.isPrimary ? '✓' : '',
          window: a.from ? `${a.from} … ${a.to}` : '—',
          audience: a.audienceRows,
          insights: a.insightRows,
          rankings: a.rankingRows,
        })),
      );
      if (res.unlinked.length) console.table(res.unlinked);
    }

    const to = arg('to') ?? new Date().toISOString().slice(0, 10);
    const from = arg('from') ?? '2024-01-01';
    const mismatches = await verifyMarketScopeMirror(handle.db, pool, { from, to });
    if (mismatches.length === 0) {
      console.log(`Mirror verified ${from} … ${to}: row counts match the portal for every account, table and day.`);
    } else {
      console.log(`${mismatches.length} account-day(s) differ from the portal:`);
      console.table(mismatches.slice(0, 50));
    }
    process.exitCode = mismatches.length > 0 ? 1 : 0;
  } finally {
    await pool.end();
    await handle.close();
  }
}

main().catch((err) => {
  console.error('Market Scope mirror failed:', err);
  process.exit(2);
});
