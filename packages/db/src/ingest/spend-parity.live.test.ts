import { afterAll, describe, expect, it } from 'vitest';
import { getDb } from '../client.js';
import { createSourcePool } from './template-report-data.js';
import { checkSpendParity, defaultParityWindow } from './spend-parity.js';

/**
 * Live parity between Tempo's DB and the warehouse — the acceptance test for
 * the GMV Max fix. Opt-in (`SPEND_PARITY_LIVE=1`) because it needs both
 * `DATABASE_URL` and `DB_*`, and it only passes after a sanitizer run has
 * booked the account totals. Read-only. `pnpm db:spend-parity` prints the same
 * comparison as a table.
 */
const live = process.env.SPEND_PARITY_LIVE === '1' && Boolean(process.env.DB_HOST);

describe.skipIf(!live)('spend parity (live)', () => {
  const pool = live ? createSourcePool() : null;
  afterAll(async () => {
    await pool?.end();
    await getDb().close();
  });

  it('every client with warehouse spend matches it within 0.1%', async () => {
    const rows = await checkSpendParity(getDb().db, pool!, defaultParityWindow());
    const failed = rows.filter((r) => !r.ok).map((r) => `${r.slug}: tempo ${r.tempo} vs source ${r.sourceGross}`);
    expect(failed).toEqual([]);
  }, 120_000);
});
