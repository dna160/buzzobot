/**
 * The one in-process lock every ingest pass in the web server takes: the full
 * auto-sync (`triggerAutoSyncIfStale`) and the targeted `POST /api/clients/sync`
 * (`syncBrandsById` / `removeBrandsById`). Two passes writing the same
 * `clients` / `tiktok_accounts` / campaign rows at once is what this prevents.
 *
 * Kept on `globalThis`, not in a module-level `let`, because Next.js may
 * evaluate this module more than once in one process (Fast Refresh, separate
 * route bundles) and a lock that each copy holds privately locks nothing.
 *
 * Scope: one process. The nightly `scheduler.ts` and `pnpm db:sanitize` run in
 * processes of their own and do not take it.
 */

interface LockState {
  /** Settles when the current holder releases; `null` when the lock is free. */
  current: Promise<void> | null;
}

const globalForLock = globalThis as unknown as { __tempo_sync_lock?: LockState };
const state: LockState = (globalForLock.__tempo_sync_lock ??= { current: null });

/** Releases the lock. Calling it more than once is harmless. */
export type ReleaseSyncLock = () => void;

export function isSyncLockHeld(): boolean {
  return state.current !== null;
}

/** Take the lock if it is free, else `null`. Synchronous — nothing can slip in between check and take. */
export function tryAcquireSyncLock(): ReleaseSyncLock | null {
  if (state.current) return null;
  let resolve!: () => void;
  const held = new Promise<void>((r) => {
    resolve = r;
  });
  state.current = held;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (state.current === held) state.current = null;
    resolve();
  };
}

/**
 * Wait up to `timeoutMs` for the lock, then take it. `null` if it was still
 * held when the time ran out.
 */
export async function acquireSyncLock(timeoutMs: number): Promise<ReleaseSyncLock | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const release = tryAcquireSyncLock();
    if (release) return release;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      state.current,
      new Promise<void>((r) => {
        timer = setTimeout(r, remaining);
      }),
    ]);
    clearTimeout(timer);
    // Loop: another waiter may have taken it first.
  }
}
