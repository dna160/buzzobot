import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../client.js';
import { agencies, clients, marketScopeAccounts, marketScopeLinks, schema } from '../schema.js';
import {
  acceptStrategyAction,
  insertProposedActions,
  listStrategyActions,
  recordActionMeasurement,
  snoozeStrategyAction,
} from './strategy-action.js';
import {
  deleteStrategySpec,
  getStrategySpec,
  listMarketScopeAccounts,
  listMarketScopeClientIds,
  upsertStrategySpec,
  type StrategySpecRow,
} from './strategy-spec.js';

/**
 * Strategy specs and the action loop against real migrations (PGlite) —
 * including the check constraints, which are the last line of defence if a
 * caller skips `parseStrategySpec`.
 */

const migrationsFolder = resolve(import.meta.dirname, '../../migrations');
let db: Database;
let clientId: string;

const empty: StrategySpecRow = {
  ttmsAccountId: null,
  reportClassOverride: null,
  goalKind: null,
  goalStage: null,
  goalMetric: null,
  goalValue: null,
  goalDeadline: null,
  creatorFeeMonthly: null,
  bgcCostMonthly: null,
};

beforeAll(async () => {
  const pglite = new PGlite();
  db = drizzle(pglite, { schema }) as unknown as Database;
  await migrate(drizzle(pglite, { schema }), { migrationsFolder });
  const [agency] = await db.insert(agencies).values({ name: 'Buzzo', slug: 'buzzo' }).returning({ id: agencies.id });
  const [client] = await db
    .insert(clients)
    .values({ agencyId: agency!.id, name: 'Purbasari ID', slug: 'purbasari-id', northStar: 'shop' })
    .returning({ id: clients.id });
  clientId = client!.id;
  await db.insert(marketScopeAccounts).values([
    { ttmsAccountId: 'senka', brandName: 'Senka' },
    { ttmsAccountId: 'purbasari', brandName: 'Purbasari' },
  ]);
  await db.insert(marketScopeLinks).values([
    { ttmsAccountId: 'senka', clientId, isPrimary: false },
    { ttmsAccountId: 'purbasari', clientId, isPrimary: true },
  ]);
});

describe('strategy specs', () => {
  it('stores, replaces and resets one spec per client', async () => {
    expect(await getStrategySpec(db, clientId)).toBeNull();
    await upsertStrategySpec(db, clientId, { ...empty, reportClassOverride: 'brand' }, 'am:jo');
    await upsertStrategySpec(
      db,
      clientId,
      { ...empty, ttmsAccountId: 'senka', goalKind: 'rank', goalStage: 'consideration', goalValue: 25, goalDeadline: '2026-12-31' },
      'am:jo',
    );
    const stored = await getStrategySpec(db, clientId);
    expect(stored).toMatchObject({ ttmsAccountId: 'senka', reportClassOverride: null, goalValue: 25, updatedBy: 'am:jo' });
    await deleteStrategySpec(db, clientId);
    expect(await getStrategySpec(db, clientId)).toBeNull();
  });

  it('rejects values outside the vocabulary at the database too', async () => {
    await expect(upsertStrategySpec(db, clientId, { ...empty, goalKind: 'move_on_rate' })).rejects.toThrow();
    await expect(upsertStrategySpec(db, clientId, { ...empty, reportClassOverride: 'luxury' })).rejects.toThrow();
  });

  it('lists the client\'s TTMS accounts primary first', async () => {
    const accounts = await listMarketScopeAccounts(db, clientId);
    expect(accounts.map((a) => [a.ttmsAccountId, a.isPrimary])).toEqual([
      ['purbasari', true],
      ['senka', false],
    ]);
  });
});

describe('strategy actions', () => {
  it('records proposals and moves them proposed → running, never twice', async () => {
    const [a, b] = await insertProposedActions(db, clientId, 'run_1', [{ id: 'act_01' }, { id: 'act_02' }]);
    const accepted = await acceptStrategyAction(db, clientId, a!, { acceptedBy: 'am:jo', startedAt: '2026-10-21' });
    expect(accepted).toMatchObject({ status: 'running', acceptedBy: 'am:jo', startedAt: '2026-10-21', actionJson: { id: 'act_01' } });
    // A second click on the same action loses the race and changes nothing.
    expect(await acceptStrategyAction(db, clientId, a!, { acceptedBy: 'other', startedAt: '2026-10-22' })).toBeNull();

    expect(await snoozeStrategyAction(db, clientId, b!)).toMatchObject({ status: 'snoozed' });
    expect(await snoozeStrategyAction(db, clientId, b!)).toBeNull();
    expect(await acceptStrategyAction(db, clientId, b!, { acceptedBy: 'am:jo', startedAt: '2026-10-23' })).toMatchObject({
      status: 'running',
    });
  });

  it('will not act on another client\'s action', async () => {
    const [id] = await insertProposedActions(db, clientId, 'run_2', [{ id: 'act_03' }]);
    expect(await acceptStrategyAction(db, '00000000-0000-0000-0000-000000000000', id!, { acceptedBy: null, startedAt: '2026-10-21' })).toBeNull();
  });

  it('lists newest first and filters by status', async () => {
    const running = await listStrategyActions(db, clientId, { statuses: ['running'] });
    expect(running).toHaveLength(2);
    const all = await listStrategyActions(db, clientId, { limit: 6 });
    expect(all[0]!.runId).toBe('run_2');
  });
});

describe('closing the loop (P5)', () => {
  it('refreshes a running action, then closes it once with its verdict', async () => {
    const [id] = await insertProposedActions(db, clientId, 'run_m', [{ id: 'act_09' }]);
    // Not accepted yet: a measurement cannot judge a proposal.
    expect(await recordActionMeasurement(db, clientId, id!, { verdict: 'worked', measuredValue: 1, categoryDelta: 0, measuredRunId: 'r' })).toBeNull();
    await acceptStrategyAction(db, clientId, id!, { acceptedBy: 'am:jo', startedAt: '2026-10-01' });

    const still = await recordActionMeasurement(db, clientId, id!, { verdict: 'running', measuredValue: 0.05, categoryDelta: 0.01, measuredRunId: 'run_n' });
    expect(still).toMatchObject({ status: 'running', measuredValue: 0.05, categoryDelta: 0.01, measuredRunId: 'run_n' });
    expect(still!.measuredAt).toBeInstanceOf(Date);

    const closed = await recordActionMeasurement(db, clientId, id!, { verdict: 'weak', measuredValue: 0.06, categoryDelta: 0.02, measuredRunId: 'run_o' });
    expect(closed).toMatchObject({ status: 'weak', measuredValue: 0.06, measuredRunId: 'run_o' });
    // A later run (or a racing cron) cannot judge it again.
    expect(await recordActionMeasurement(db, clientId, id!, { verdict: 'failed', measuredValue: 0, categoryDelta: 0, measuredRunId: 'run_p' })).toBeNull();
  });

  it('lists the clients the weekly job makes a Strategy Report for', async () => {
    expect(await listMarketScopeClientIds(db)).toEqual(new Set([clientId]));
  });
});

describe('one Market Scope account, several clients (TCL)', () => {
  it('serves every client it is linked to, each with its own primary flag', async () => {
    const [agency] = await db.select({ id: agencies.id }).from(agencies).limit(1);
    const [tiktok, tokopedia] = await db
      .insert(clients)
      .values([
        { agencyId: agency!.id, name: 'TCL - TikTok ID', slug: 'tcl-tiktok-id', northStar: 'shop' },
        { agencyId: agency!.id, name: 'TCL - Tokopedia ID', slug: 'tcl-tokopedia-id', northStar: 'shop' },
      ])
      .returning({ id: clients.id });
    await db.insert(marketScopeAccounts).values({ ttmsAccountId: 'tcl', brandName: 'TCL' });
    await db.insert(marketScopeLinks).values([
      { ttmsAccountId: 'tcl', clientId: tiktok!.id, isPrimary: true },
      { ttmsAccountId: 'tcl', clientId: tokopedia!.id, isPrimary: true },
    ]);

    for (const id of [tiktok!.id, tokopedia!.id]) {
      expect(await listMarketScopeAccounts(db, id)).toEqual([expect.objectContaining({ ttmsAccountId: 'tcl', brandName: 'TCL', isPrimary: true })]);
    }
    expect(await listMarketScopeClientIds(db)).toEqual(new Set([clientId, tiktok!.id, tokopedia!.id]));
    // Either client may pin the shared account in its own spec.
    const spec = { ...empty, ttmsAccountId: 'tcl' };
    await upsertStrategySpec(db, tokopedia!.id, spec, 'am:jo');
    expect(await getStrategySpec(db, tokopedia!.id)).toMatchObject({ ttmsAccountId: 'tcl' });
  });
});
