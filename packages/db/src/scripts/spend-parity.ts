import { getDb } from '../client.js';
import { createSourcePool } from '../ingest/template-report-data.js';
import { checkSpendParity, defaultParityWindow, DEFAULT_PARITY_TOLERANCE } from '../ingest/spend-parity.js';

/**
 * `pnpm db:spend-parity [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--client slug] [--tolerance 0.001]`
 *
 * Read-only. Compares Tempo's campaign-rollup spend with the warehouse's
 * `tiktok_ads_analytics` per client and exits 1 if any client is off by more
 * than the tolerance. See `ingest/spend-parity.ts` for the definitions.
 */

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

const rp = (v: number) => `Rp${Math.round(v).toLocaleString('en-US')}`;

async function main() {
  const pool = createSourcePool();
  if (!pool) {
    console.error('DB_HOST / DB_NAME / DB_USER are not set — no warehouse to compare against.');
    process.exit(2);
  }
  const fallback = defaultParityWindow();
  const window = { from: arg('from') ?? fallback.from, to: arg('to') ?? fallback.to };
  const tolerance = Number(arg('tolerance') ?? DEFAULT_PARITY_TOLERANCE);
  const only = arg('client');

  const handle = getDb();
  try {
    const rows = (await checkSpendParity(handle.db, pool, window, tolerance)).filter((r) => !only || r.slug === only);
    console.log(`Spend parity ${window.from} … ${window.to} (tolerance ${(tolerance * 100).toFixed(2)}%)`);
    console.table(
      rows
        .sort((a, b) => Number(a.ok) - Number(b.ok) || b.sourceGross - a.sourceGross)
        .map((r) => ({
          client: r.slug,
          tempo: rp(r.tempo),
          'source (cost+gmv)': rp(r.sourceGross),
          diff: r.diffPct == null ? '—' : `${(r.diffPct * 100).toFixed(2)}%`,
          'portal Cost (cash)': rp(r.portalCost),
          credits: rp(r.credits),
          usdDays: r.usdDays,
          ok: r.ok ? '✓' : '✗',
        })),
    );
    const failed = rows.filter((r) => !r.ok);
    console.log(`${rows.length - failed.length}/${rows.length} clients match.`);
    process.exitCode = failed.length > 0 ? 1 : 0;
  } finally {
    await pool.end();
    await handle.close();
  }
}

main().catch((err) => {
  console.error('Spend parity failed:', err);
  process.exit(2);
});
