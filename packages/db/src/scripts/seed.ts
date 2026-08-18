import { createTikTokProvider, loadTikTokConfig } from '@tempo/tiktok';
import { rangePreset } from '@tempo/core';
import { getDb } from '../client.js';
import { ensureDemoTenant } from '../ingest/bootstrap.js';
import { ingestAccount } from '../ingest/pipeline.js';
import { fetchSanitizeAndSeed } from '../ingest/sanitize.js';

/**
 * Seed the database. In PostgreSQL / live mode, automatically discovers all brand
 * tables, sanitizes their hourly data, and ingests them into the domain model.
 * In fixture/csv mode, seeds the configured demo tenant.
 */

// Anchor the demo window to a fixed "today" so seeded data is stable.
const DEMO_TODAY = '2026-07-19';

async function main() {
  const config = loadTikTokConfig();
  const hasPgSource =
    config.provider === 'postgres' ||
    Boolean(process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER);

  if (hasPgSource) {
    console.log('🚀 Running auto-discovery and multi-brand seed pipeline...');
    await fetchSanitizeAndSeed({ closeOnComplete: false });
    process.exit(0);
  }

  const { db, backend } = getDb();
  const provider = createTikTokProvider();
  console.log(`Seeding via provider="${provider.name}" backend="${backend}"...`);

  const tenant = await ensureDemoTenant(db, provider);
  const accounts = await provider.listAccounts();
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
