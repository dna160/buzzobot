import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { schema } from '../schema.js';
import { resolvePgliteDir } from '../client.js';
import { fetchSanitizeAndSeed } from '../ingest/sanitize.js';

const migrationsFolder = resolve(import.meta.dirname, '../../migrations');

async function main() {
  const url = process.env.DATABASE_URL;

  // Apply migrations to target database
  if (url) {
    const client = postgres(url, { max: 1 });
    const db = drizzlePostgres(client, { schema });
    await migratePostgres(db, { migrationsFolder });
    await client.end();
  } else {
    const dbDir = resolvePgliteDir();
    const client = new PGlite(dbDir);
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder });
    await client.close();
  }

  // Run full multi-tier discovery and ingestion
  await fetchSanitizeAndSeed({ closeOnComplete: true });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Sanitize and seed failed:', err);
    process.exit(1);
  });
