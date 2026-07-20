import { parseArgs } from 'node:util';
import { createTikTokProvider } from '@tempo/tiktok';
import { rangePreset, toIsoDate, type DateRange } from '@tempo/core';
import { ensureDemoTenant, getDb, ingestAccount } from '@tempo/db';

/**
 * Tempo ingestion CLI — runs backfills / on-demand syncs against the configured
 * provider (fixtures by default, live TikTok when credentials are set). This is
 * the same pipeline the seed and the (future, Phase 2) scheduler invoke.
 *
 * Usage:
 *   pnpm ingest --preset 30d
 *   pnpm ingest --start 2026-06-01 --end 2026-06-30
 *   pnpm ingest --bootstrap        # also (idempotently) provision the demo tenant
 */
async function main() {
  const { values } = parseArgs({
    options: {
      preset: { type: 'string', default: '30d' },
      start: { type: 'string' },
      end: { type: 'string' },
      bootstrap: { type: 'boolean', default: false },
      today: { type: 'string' },
    },
  });

  const { db, backend } = getDb();
  const provider = createTikTokProvider();

  const range: DateRange =
    values.start && values.end
      ? { start: values.start, end: values.end }
      : rangePreset(
          (values.preset ?? '30d') as '7d' | '28d' | '30d' | '90d',
          values.today ?? toIsoDate(new Date()),
        );

  console.log(
    `[tempo-ingest] provider=${provider.name} backend=${backend} window=${range.start}..${range.end}`,
  );

  if (values.bootstrap) {
    const tenant = await ensureDemoTenant(db, provider);
    console.log(`[tempo-ingest] tenant ready: client=${tenant.clientSlug}`);
  }

  const accounts = await provider.listAccounts();
  if (accounts.length === 0) {
    console.warn('[tempo-ingest] no connected accounts to sync (run with --bootstrap in demo mode)');
    process.exit(0);
  }

  let total = 0;
  let failures = 0;
  for (const account of accounts) {
    const result = await ingestAccount(db, provider, account, range);
    total += result.rowsIngested;
    if (result.status === 'succeeded') {
      console.log(`[tempo-ingest] ✓ ${account.surface}:${account.displayName} — ${result.rowsIngested} rows`);
    } else {
      failures += 1;
      console.error(`[tempo-ingest] ✗ ${account.surface}:${account.displayName} — ${result.error}`);
    }
  }

  console.log(`[tempo-ingest] done: ${total} rows, ${failures} failed account(s)`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[tempo-ingest] fatal:', err);
  process.exit(1);
});
