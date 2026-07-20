import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from './schema.js';

/**
 * The database handle used everywhere. We standardize the *type* on the
 * postgres-js shape; the PGlite driver implements the same query API and is
 * cast to it, so repositories are written once and run against either backend.
 */
export type Database = PostgresJsDatabase<typeof schema>;

export type DbBackend = 'postgres' | 'pglite';

export interface DbHandle {
  db: Database;
  backend: DbBackend;
  /** Close underlying connections/resources. */
  close: () => Promise<void>;
}

/**
 * Walk up from a starting dir to the monorepo root (identified by
 * pnpm-workspace.yaml) so a relative PGLITE_DATA_DIR resolves to the same
 * absolute location regardless of which package's script invoked us.
 */
const findWorkspaceRoot = (start: string = process.cwd()): string => {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
};

/** Absolute path to the embedded PGlite data directory (shared by all tools). */
export const resolvePgliteDir = (): string => {
  const configured = process.env.PGLITE_DATA_DIR ?? '.pglite/tempo';
  const dir = isAbsolute(configured) ? configured : resolve(findWorkspaceRoot(), configured);
  // PGlite's node fs only creates the leaf dir, so ensure the full path exists.
  mkdirSync(dir, { recursive: true });
  return dir;
};

let cached: DbHandle | null = null;

/**
 * Get the shared database handle. Backend selection is automatic:
 *  - DATABASE_URL present → Postgres (production/staging).
 *  - otherwise → embedded PGlite persisted to disk (local/demo/CI).
 *
 * The handle is memoized per process so Next.js route handlers and background
 * scripts don't each open a new pool.
 */
export const getDb = (): DbHandle => {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url, { max: 10, prepare: false });
    const db = drizzlePostgres(client, { schema });
    cached = {
      db,
      backend: 'postgres',
      close: async () => {
        await client.end({ timeout: 5 });
      },
    };
    return cached;
  }

  const dataDir = resolvePgliteDir();
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema }) as unknown as Database;
  cached = {
    db,
    backend: 'pglite',
    close: async () => {
      await client.close();
    },
  };
  return cached;
};

/** Reset the memoized handle. Primarily for tests. */
export const __resetDbForTests = () => {
  cached = null;
};
