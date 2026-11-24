import { describe, expect, it } from 'vitest';
import { acquireSyncLock, isSyncLockHeld, tryAcquireSyncLock } from './sync-lock.js';

describe('sync lock', () => {
  it('is exclusive until released, and releasing twice is harmless', () => {
    const release = tryAcquireSyncLock();
    expect(release).not.toBeNull();
    expect(isSyncLockHeld()).toBe(true);
    expect(tryAcquireSyncLock()).toBeNull();
    release!();
    release!();
    expect(isSyncLockHeld()).toBe(false);
  });

  it('a waiter gets the lock as soon as the holder releases', async () => {
    const holder = tryAcquireSyncLock()!;
    setTimeout(holder, 20);
    const release = await acquireSyncLock(1_000);
    expect(release).not.toBeNull();
    release!();
  });

  it('a waiter gives up after its timeout while the lock is still held', async () => {
    const holder = tryAcquireSyncLock()!;
    const started = Date.now();
    expect(await acquireSyncLock(30)).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    holder();
  });

  it('two waiters never both hold it', async () => {
    const holder = tryAcquireSyncLock()!;
    const a = acquireSyncLock(1_000);
    const b = acquireSyncLock(50);
    holder();
    const ra = await a;
    expect(ra).not.toBeNull();
    expect(await b).toBeNull();
    ra!();
  });
});
