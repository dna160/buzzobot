import { fetchSanitizeAndSeed } from './sanitize.js';

let isSyncing = false;
let lastSyncTime = 0;
let backgroundIntervalStarted = false;

export interface AutoSyncOptions {
  /** Minimum age in milliseconds before triggering a new sync. Default: 60,000ms (1 minute). */
  maxAgeMs?: number;
  /** Whether to await completion (blocking) or run asynchronously in background. Default: false. */
  blocking?: boolean;
}

/**
 * Automatically detects if new brand data is available in PostgreSQL and syncs it.
 * Safe to call on web requests without blocking or throwing errors.
 */
export async function triggerAutoSyncIfStale(options: AutoSyncOptions = {}): Promise<boolean> {
  const maxAgeMs = options.maxAgeMs ?? 60_000;
  const now = Date.now();

  // If no DB_HOST is configured or if sync is already active, skip
  if (!process.env.DB_HOST) return false;
  if (isSyncing) return false;
  if (now - lastSyncTime < maxAgeMs) return false;

  // Start the background interval once in this runtime process
  if (!backgroundIntervalStarted) {
    backgroundIntervalStarted = true;
    const intervalMs = Number(process.env.AUTO_SYNC_INTERVAL_MS) || 30 * 60 * 1000; // default 30 minutes
    const timer = setInterval(() => {
      triggerAutoSyncIfStale({ maxAgeMs: intervalMs - 1000, blocking: false }).catch(() => {});
    }, intervalMs);
    // unref so timer doesn't prevent graceful exit in CLI scripts
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  const runSync = async () => {
    isSyncing = true;
    try {
      // `fetchSanitizeAndSeed` opens its own PGlite instance whenever the
      // active `getDb()` backend isn't already PGlite (true here — this repo
      // runs Postgres via DATABASE_URL) and only closes it when told to. With
      // `false` here, every single auto-sync tick — the 30-min interval below
      // *and* every `clients.list` query more than 60s after the last sync —
      // leaked one more open PGlite instance (real OS file handles to
      // `postgres.data`) for the lifetime of the process, eventually crashing
      // the dev server with EMFILE. `true` closes it every time instead.
      await fetchSanitizeAndSeed({ closeOnComplete: true });
      lastSyncTime = Date.now();
    } catch (err) {
      console.warn('[tempo-auto-sync] Automatic background sync error:', err);
    } finally {
      isSyncing = false;
    }
  };

  if (options.blocking) {
    await runSync();
    return true;
  } else {
    // Fire and forget in background
    runSync().catch(() => {});
    return true;
  }
}
