import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../client.js';
import { schema, agencies, clients, templateReportRuns } from '../schema.js';
import { issueReportLink, resolveReportLink, revokeReportLink } from './report-link.js';
import {
  claimTemplateReportRun,
  completeTemplateReportRun,
  countRunningTemplateReportRuns,
  failTemplateReportRun,
  latestCompletedTemplateReportRun,
  latestTemplateReportRun,
  type TemplateReportRunKey,
} from './template-report-run.js';

/**
 * Shared report links and the Template Report ledger against real migrations.
 * Both lean on partial unique indexes — one live link per client, one running
 * generation per window — which are exactly what a mock would not exercise.
 */

const migrationsFolder = resolve(import.meta.dirname, '../../migrations');

let db: Database;
let clientId: string;
let otherClientId: string;

const key = (over: Partial<TemplateReportRunKey> = {}): TemplateReportRunKey => ({
  clientId,
  template: 'shop',
  benchmarkMode: 'industry',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  ...over,
});

beforeAll(async () => {
  const pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as Database;
  await migrate(drizzle(pg, { schema }), { migrationsFolder });

  const [agency] = await db.insert(agencies).values({ name: 'Buzzo', slug: 'buzzo' }).returning({ id: agencies.id });
  const inserted = await db
    .insert(clients)
    .values([
      { agencyId: agency!.id, name: 'Sovella', slug: 'sovella', northStar: 'shop' },
      { agencyId: agency!.id, name: 'Other', slug: 'other', northStar: 'vtr' },
    ])
    .returning({ id: clients.id });
  clientId = inserted[0]!.id;
  otherClientId = inserted[1]!.id;
});

describe('report links', () => {
  it('issues one stable, unguessable link per client', async () => {
    const first = await issueReportLink(db, clientId, 'portal:user:1');
    const again = await issueReportLink(db, clientId, 'portal:user:2');
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.link.token).toBe(first.link.token);
    expect(first.link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const other = await issueReportLink(db, otherClientId, null);
    expect(other.link.token).not.toBe(first.link.token);
  });

  it('resolves a live token to its client only', async () => {
    const { link } = await issueReportLink(db, clientId, null);
    expect((await resolveReportLink(db, link.token))?.slug).toBe('sovella');
    expect(await resolveReportLink(db, 'x'.repeat(43))).toBeNull();
  });

  it('settles a race to the same token', async () => {
    await revokeReportLink(db, clientId);
    const [a, b] = await Promise.all([issueReportLink(db, clientId, null), issueReportLink(db, clientId, null)]);
    expect(a.link.token).toBe(b.link.token);
  });

  it('revoking kills the token and the next request issues a new one', async () => {
    const { link } = await issueReportLink(db, clientId, null);
    expect(await revokeReportLink(db, clientId)).toBe(1);
    expect(await revokeReportLink(db, clientId)).toBe(0);
    expect(await resolveReportLink(db, link.token)).toBeNull();

    const next = await issueReportLink(db, clientId, null);
    expect(next.created).toBe(true);
    expect(next.link.token).not.toBe(link.token);
  });
});

describe('template report ledger', () => {
  it('lets exactly one request generate a window at a time', async () => {
    const first = await claimTemplateReportRun(db, key());
    const second = await claimTemplateReportRun(db, key());
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    // A different window, template or benchmark is a different key.
    expect(await claimTemplateReportRun(db, key({ periodEnd: '2026-09-29' }))).toBeTruthy();
    expect(await countRunningTemplateReportRuns(db, clientId)).toBe(2);

    await completeTemplateReportRun(db, first!, { artifactPath: '/tmp/a.html', artifactBytes: 10 });
    expect((await latestTemplateReportRun(db, key()))?.status).toBe('completed');
    // Once it lands, the window can be claimed again (a later refresh).
    expect(await claimTemplateReportRun(db, key())).toBeTruthy();
  });

  it('serves a completed run only within its freshness window, unless settled', async () => {
    const k = key({ periodStart: '2026-08-01', periodEnd: '2026-08-31' });
    const id = await claimTemplateReportRun(db, k);
    await completeTemplateReportRun(db, id!, { artifactPath: '/tmp/b.html', artifactBytes: 10 });
    await db
      .update(templateReportRuns)
      .set({ startedAt: new Date(Date.now() - 48 * 3_600_000) })
      .where(eq(templateReportRuns.id, id!));

    expect(await latestCompletedTemplateReportRun(db, k, 24)).toBeNull();
    expect((await latestCompletedTemplateReportRun(db, k, null))?.id).toBe(id);
  });

  it('records a failure and frees the key', async () => {
    const k = key({ periodStart: '2026-07-01', periodEnd: '2026-07-31' });
    const id = await claimTemplateReportRun(db, k);
    await failTemplateReportRun(db, id!, 'LM Studio unreachable');
    const latest = await latestTemplateReportRun(db, k);
    expect(latest?.status).toBe('failed');
    expect(latest?.error).toBe('LM Studio unreachable');
    expect(await claimTemplateReportRun(db, k)).toBeTruthy();
  });

  it('reclaims a run abandoned by a dead process', async () => {
    const k = key({ periodStart: '2026-06-01', periodEnd: '2026-06-30' });
    const id = await claimTemplateReportRun(db, k);
    await db
      .update(templateReportRuns)
      .set({ startedAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(templateReportRuns.id, id!));

    const fresh = await claimTemplateReportRun(db, k);
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(id);
    const [old] = await db.select().from(templateReportRuns).where(eq(templateReportRuns.id, id!));
    expect(old?.status).toBe('failed');
  });
});
