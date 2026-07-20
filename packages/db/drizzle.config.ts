import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config. Migrations are dialect-portable SQL applied to either
 * embedded PGlite (local/demo) or Postgres (prod). The URL here is only used
 * by `drizzle-kit studio`/`push`; migration generation reads the schema alone.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/tempo',
  },
  strict: true,
  verbose: true,
});
