import { createTikTokProvider } from '@tempo/tiktok';
import { rangePreset } from '@tempo/core';
import { getDb } from '../client.js';
import { ensureDemoTenant } from '../ingest/bootstrap.js';
import { ingestAccount } from '../ingest/pipeline.js';

/**
 * Seed the database with a fully-populated demo tenant. Runs the real
 * ingestion pipeline against whichever provider is configured (fixtures by
 * default), so the seeded data is produced by exactly the code path production
 * uses — not a separate mock.
 */

// Anchor the demo window to a fixed "today" so seeded data is stable.
const DEMO_TODAY = '2026-07-19';

async function main() {
  const { db, backend } = getDb();
  const provider = createTikTokProvider();
  console.log(`Seeding via provider="${provider.name}" backend="${backend}"...`);

  const tenant = await ensureDemoTenant(db, provider);
  const accounts = await provider.listAccounts();
  // A bounded source (a CSV export) knows its own window; otherwise fall back
  // to the fixed demo window so fixture seeds stay deterministic.
  const range = (await provider.describeRange?.()) ?? rangePreset('90d', DEMO_TODAY);
  console.log(`  window ${range.start} → ${range.end}`);

  let total = 0;
  for (const account of accounts) {
    const result = await ingestAccount(db, provider, account, range, { isBackfill: true });
    total += result.rowsIngested;
    const label = `${account.surface}:${account.displayName}`;
    if (result.status === 'succeeded') {
      console.log(`  ✓ ${label} — ${result.rowsIngested} daily rows`);
    } else {
      console.error(`  ✗ ${label} — ${result.error}`);
    }
  }

  console.log(`✓ Seed complete. Client "${tenant.clientSlug}", ${total} metric rows.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
