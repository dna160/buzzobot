import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../client.js';
import { schema, agencies, clients } from '../schema.js';
import {
  completeReportRun,
  failReportRun,
  getReportRun,
  latestCompletedRun,
  readArtifact,
  recentReportRuns,
  startReportRun,
  writeArtifact,
  type ReportRunKey,
} from './report-run.js';

/**
 * The pre-generation ledger against a real Postgres (PGlite) and real
 * migrations. The cache key and the freshness rule are the two places a bug
 * costs a client a stale deck, so both are exercised directly — one of them
 * already caught a real one: an async run records an empty window and has to
 * fill it in when it completes, or its artifact can never be found again.
 */

const migrationsFolder = resolve(import.meta.dirname, '../../migrations');

let db: Database;
let clientId: string;

const key = (over: Partial<ReportRunKey> = {}): ReportRunKey => ({
  clientId,
  objective: 'gmv',
  periodStart: '2026-08-10',
  periodEnd: '2026-08-16',
  tier: 'full',
  ...over,
});

beforeAll(async () => {
  const pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as Database;
  await migrate(drizzle(pg, { schema }), { migrationsFolder });

  const [agency] = await db
    .insert(agencies)
    .values({ name: 'Buzzo', slug: 'buzzo' })
    .returning({ id: agencies.id });
  const [client] = await db
    .insert(clients)
    .values({ agencyId: agency!.id, name: 'Sovella', slug: 'sovella', northStar: 'shop' })
    .returning({ id: clients.id });
  clientId = client!.id;
});

describe('report run ledger', () => {
  it('records a run and finds it once completed', async () => {
    const id = await startReportRun(db, key(), 'run_abc');
    expect(await latestCompletedRun(db, key())).toBeNull(); // still running

    await completeReportRun(db, id, { artifactPath: '/tmp/x.pdf', artifactBytes: 1234 });

    const found = await latestCompletedRun(db, key());
    expect(found?.id).toBe(id);
    expect(found?.runId).toBe('run_abc');
    expect(found?.artifactBytes).toBe(1234);
  });

  it('never returns a run from a different window, objective, or tier', async () => {
    const id = await startReportRun(db, key({ objective: 'awareness' }), 'run_aware');
    await completeReportRun(db, id, { artifactPath: '/tmp/a.pdf' });

    expect(await latestCompletedRun(db, key({ objective: 'awareness' }))).not.toBeNull();
    expect(await latestCompletedRun(db, key({ periodEnd: '2026-08-17' }))).toBeNull();
    expect(await latestCompletedRun(db, key({ tier: 'instant' }))).toBeNull();
  });

  it('fills in the window an async run did not know when it started', async () => {
    // The portal's full-run flow records the row before reading the rollup.
    const id = await startReportRun(
      db,
      { clientId, objective: 'install', tier: 'full' },
      'run_async',
    );
    await completeReportRun(db, id, {
      artifactPath: '/tmp/i.pdf',
      periodStart: '2026-08-10',
      periodEnd: '2026-08-16',
    });

    // Findable under the key the download will actually look up.
    expect((await latestCompletedRun(db, key({ objective: 'install' })))?.id).toBe(id);
    // ...and a run still in flight is never servable, because its window is null.
    const inFlight = await startReportRun(db, { clientId, objective: 'install', tier: 'full' });
    expect(await getReportRun(db, inFlight)).toMatchObject({ periodStart: null, status: 'running' });
  });

  it('treats an artifact older than the freshness window as absent', async () => {
    const id = await startReportRun(db, key({ objective: 'awareness' }), 'run_stale');
    await completeReportRun(db, id, { artifactPath: '/tmp/s.pdf' });

    // Zero hours of tolerance: even a run recorded a moment ago is too old.
    expect(await latestCompletedRun(db, key({ objective: 'awareness' }), 0)).toBeNull();
  });

  it('records a failure with its reason instead of a silent gap', async () => {
    const id = await startReportRun(db, key({ objective: 'awareness', tier: 'instant' }));
    await failReportRun(db, id, 'engine unreachable');

    const row = await getReportRun(db, id);
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('engine unreachable');
    expect(row?.finishedAt).not.toBeNull();
    // A failed run is never served as a deck.
    expect(await latestCompletedRun(db, key({ objective: 'awareness', tier: 'instant' }))).toBeNull();
  });

  it('lists recent runs newest first for the health card', async () => {
    const runs = await recentReportRuns(db, 5);
    expect(runs.length).toBeGreaterThan(0);
    const times = runs.map((r) => r.startedAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});

describe('artifact storage', () => {
  it('round-trips a rendered deck', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tempo-decks-'));
    const bytes = Buffer.from('%PDF-1.4 fake');

    const stored = await writeArtifact('deck.pdf', bytes, dir);
    expect(stored.bytes).toBe(bytes.byteLength);
    expect(await readArtifact(stored.path)).toEqual(bytes);
  });

  it('returns null for an artifact that is gone rather than throwing', async () => {
    // A cleaned volume must degrade to "regenerate", not to a 500.
    expect(await readArtifact('/nonexistent/deck.pdf')).toBeNull();
    expect(await readArtifact(null)).toBeNull();
  });
});
