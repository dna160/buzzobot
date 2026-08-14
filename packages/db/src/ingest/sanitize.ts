import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { resolvePgliteDir } from '../client.js';

// Hours to check: h00 through h23
const HOUR_KEYS = Array.from({ length: 24 }, (_, i) => `h${String(i).padStart(2, '0')}`);

export interface FetchSanitizeOptions {
  pgliteDir?: string;
  closeOnComplete?: boolean;
}

export async function fetchSanitizeAndSeed(options: FetchSanitizeOptions = {}) {
  const host = process.env.DB_HOST;
  const port = Number(process.env.DB_PORT);
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;

  const postgresPool = new pg.Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : { host, port, database, user, password }
  );

  const dbDir = options.pgliteDir ?? resolvePgliteDir();
  mkdirSync(dbDir, { recursive: true });
  const pglite = new PGlite(dbDir);

  console.log('⚡ Fetching raw brand data from PostgreSQL...');

  try {
    // Ensure table exists in PGlite
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS brand_hourly_tempo (
        brand VARCHAR(32) NOT NULL,
        campaign_id VARCHAR(64) NOT NULL,
        date DATE NOT NULL,
        adgroup_id VARCHAR(64) NOT NULL DEFAULT '',
        metrics VARCHAR(128) NOT NULL,
        campaign_name VARCHAR(512),
        adgroup_name VARCHAR(512),
        h00 NUMERIC, h01 NUMERIC, h02 NUMERIC, h03 NUMERIC, h04 NUMERIC, h05 NUMERIC,
        h06 NUMERIC, h07 NUMERIC, h08 NUMERIC, h09 NUMERIC, h10 NUMERIC, h11 NUMERIC,
        h12 NUMERIC, h13 NUMERIC, h14 NUMERIC, h15 NUMERIC, h16 NUMERIC, h17 NUMERIC,
        h18 NUMERIC, h19 NUMERIC, h20 NUMERIC, h21 NUMERIC, h22 NUMERIC, h23 NUMERIC, h24 NUMERIC,
        PRIMARY KEY (brand, campaign_id, date, adgroup_id, metrics)
      );
    `);

    // 🔍 Step 1: Auto-discover all brand tables matching '%_daily_performance' in PostgreSQL
    const tablesQuery = await postgresPool.query<{ table_name: string }>(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name LIKE '%_daily_performance'
      ORDER BY table_name;
    `);

    // Fallback if Postgres schema search returns no tables
    const brandMap: Record<string, string> = {
      bardi_jakarta_daily_performance: 'bardi',
    };

    const targetBrands = tablesQuery.rows.length > 0
      ? tablesQuery.rows.map((r) => ({
          table: r.table_name,
          brand: brandMap[r.table_name] ?? r.table_name.replace(/_daily_performance$/, ''),
        }))
      : [
          { brand: 'laneige', table: 'laneige_daily_performance' },
          { brand: 'cimory', table: 'cimory_daily_performance' },
          { brand: 'treasury', table: 'treasury_daily_performance' },
          { brand: 'bardi', table: 'bardi_jakarta_daily_performance' },
        ];

    console.log(`Discovered ${targetBrands.length} target brand tables: ${targetBrands.map(b => `${b.brand} (${b.table})`).join(', ')}`);

    for (const { brand, table } of targetBrands) {
      console.log(`Processing ${brand} (${table})...`);

      let offset = 0;
      const PAGE_SIZE = 2500;
      let totalFetched = 0;
      let totalActive = 0;

      while (true) {
        // 📥 Step 1: Fetch raw data in pages to prevent Node heap memory limits
        const pageResult = await postgresPool.query(
          `SELECT * FROM ${table} ORDER BY campaign_id, date LIMIT ${PAGE_SIZE} OFFSET ${offset}`
        );
        const rows = pageResult.rows;
        if (rows.length === 0) break;

        totalFetched += rows.length;

        // Filter active (non-zero) rows in current page
        const activeChunk = rows.filter((row) => {
          const isAllZero = HOUR_KEYS.every((hKey) => {
            const val = Number(row[hKey] || 0);
            return isNaN(val) || val === 0;
          });
          return !isAllZero;
        });

        // 🧹 Step 2: Sanitize & Seed active rows in current page into PGlite
        if (activeChunk.length > 0) {
          totalActive += activeChunk.length;
          await pglite.transaction(async (tx) => {
            for (const row of activeChunk) {
              const dateStr =
                row.date instanceof Date
                  ? row.date.toISOString().slice(0, 10)
                  : String(row.date).slice(0, 10);

              await tx.query(
                `INSERT INTO brand_hourly_tempo (
                  brand, campaign_id, date, adgroup_id, metrics, campaign_name, adgroup_name,
                  h00, h01, h02, h03, h04, h05, h06, h07, h08, h09, h10, h11,
                  h12, h13, h14, h15, h16, h17, h18, h19, h20, h21, h22, h23, h24
                 ) VALUES (
                  $1, $2, $3, $4, $5, $6, $7,
                  $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                  $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32
                 ) ON CONFLICT (brand, campaign_id, date, adgroup_id, metrics) DO NOTHING;`,
                [
                  brand,
                  row.campaign_id,
                  dateStr,
                  row.adgroup_id || '',
                  row.metrics,
                  row.campaign_name || '',
                  row.adgroup_name || '',
                  ...HOUR_KEYS.map((hKey) => Number(row[hKey] || 0)),
                  Number(row.h24 || 0),
                ],
              );
            }
          });
        }

        offset += rows.length;
      }

      console.log(
        `✓ ${brand}: Processed ${totalFetched} raw rows -> kept ${totalActive} active rows (dropped ${totalFetched - totalActive} zero rows).`,
      );
    }

    console.log('🎉 PGlite is now fully seeded with sanitized data!');
  } finally {
    await postgresPool.end();
    if (options.closeOnComplete) {
      await pglite.close();
    }
  }
}
