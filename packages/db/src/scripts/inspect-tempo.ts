import { PGlite } from '@electric-sql/pglite';
import { resolvePgliteDir } from '../client.js';

async function main() {
  const dbDir = resolvePgliteDir();
  const pglite = new PGlite(dbDir);

  console.log(`🔍 Inspecting PGlite database at "${dbDir}"...`);

  // Check if table exists
  const tableCheck = await pglite.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'brand_hourly_tempo'
    );
  `);

  if (!tableCheck.rows[0]?.exists) {
    console.log('⚠️ Table "brand_hourly_tempo" does not exist yet. Run "pnpm db:sanitize" first.');
    await pglite.close();
    process.exit(0);
  }

  // Row counts per brand
  const counts = await pglite.query<{ brand: string; count: string }>(`
    SELECT brand, COUNT(*) as count 
    FROM brand_hourly_tempo 
    GROUP BY brand 
    ORDER BY brand;
  `);

  console.log('\n📊 Brand Row Counts in brand_hourly_tempo:');
  console.table(counts.rows.map((r) => ({ Brand: r.brand, 'Active Rows': Number(r.count).toLocaleString() })));

  // Total count
  const total = await pglite.query<{ total: string }>(`SELECT COUNT(*) as total FROM brand_hourly_tempo;`);
  console.log(`✨ Total Sanitized Rows: ${Number(total.rows[0]?.total || 0).toLocaleString()}`);

  // Sample rows preview
  const sample = await pglite.query(`
    SELECT brand, campaign_name, date, metrics, h00, h01, h02, h03, h12, h18, h23
    FROM brand_hourly_tempo 
    LIMIT 5;
  `);

  console.log('\n🔍 Sample Data Preview:');
  console.table(sample.rows);

  await pglite.close();
}

main().catch((err) => {
  console.error('Inspect failed:', err);
  process.exit(1);
});
