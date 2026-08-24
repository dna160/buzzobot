import { eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { appSettings } from '../schema.js';

/**
 * Generic operator-settings store. Values are opaque JSON documents here; the
 * caller owns their shape and validation. Kept deliberately untyped so this
 * package needs no dependency on the packages whose config it happens to hold.
 */

/**
 * Stable keys for the settings this app stores.
 *
 * Empty since Brief Deck M7: the only key was the report-narrative (LLM)
 * connection, and narration moved to tempo-engine, which owns its own model
 * configuration. The store itself is kept — it is generic, and an operator
 * setting that needs a home will want it rather than a new table.
 */
export const SETTINGS_KEYS = {} as const;

/** Read a setting, JSON-parsed. Returns null when absent or unparseable. */
export async function getSetting<T = unknown>(db: Database, key: string): Promise<T | null> {
  const rows = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);

  const raw = rows[0]?.value;
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A corrupt row should not take down the caller; treat it as unset so the
    // consumer falls back to its own defaults (e.g. .env for the LLM config).
    return null;
  }
}

/** Upsert a setting as a JSON document, bumping updated_at. */
export async function setSetting(db: Database, key: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  await db
    .insert(appSettings)
    .values({ key, value: serialized, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: serialized, updatedAt: new Date() },
    });
}
