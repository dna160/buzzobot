import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { schema } from '../schema.js';
import { resolvePgliteDir } from '../client.js';

/**
 * Apply pending migrations to whichever backend is configured. Uses the
 * driver-specific migrator so the same generated SQL runs on Postgres or the
 * embedded PGlite database.
 */
const migrationsFolder = resolve(import.meta.dirname, '../../migrations');

async function main() {
  const url = process.env.DATABASE_URL;

  if (url) {
    const client = postgres(url, { max: 1 });
    const db = drizzlePostgres(client, { schema });
    await migratePostgres(db, { migrationsFolder });
    await client.end();
    console.log('✓ Migrations applied (postgres)');
    return;
  }

  const client = new PGlite(resolvePgliteDir());
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  await client.close();
  console.log('✓ Migrations applied (pglite)');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
