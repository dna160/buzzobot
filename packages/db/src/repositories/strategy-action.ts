import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../client.js';
import { strategyActions } from '../schema.js';

/**
 * The Strategy Report's action loop (PRD §5.6): what a run proposed, what the
 * AM accepted, and — from P5 — what the next run measured.
 *
 * `actionJson` is the engine's `ActionItem` stored as proposed. This module
 * never edits it: the target a decision is measured against must be the one
 * the Target Solver produced, not a later re-phrasing.
 */

export type StrategyActionStatus = 'proposed' | 'running' | 'worked' | 'weak' | 'failed' | 'snoozed';

export interface StrategyActionRow {
  id: string;
  clientId: string;
  runId: string;
  actionJson: unknown;
  status: StrategyActionStatus;
  acceptedBy: string | null;
  startedAt: string | null;
  measuredValue: number | null;
  categoryDelta: number | null;
  measuredRunId: string | null;
  measuredAt: Date | null;
  createdAt: Date;
}

/** Record the ≤ 3 actions a run proposed. */
export async function insertProposedActions(
  db: Database,
  clientId: string,
  runId: string,
  actions: readonly unknown[],
): Promise<string[]> {
  if (actions.length === 0) return [];
  const rows = await db
    .insert(strategyActions)
    .values(actions.map((actionJson) => ({ clientId, runId, actionJson, status: 'proposed' })))
    .returning({ id: strategyActions.id });
  return rows.map((r) => r.id);
}

/** Newest first. `limit` 6 is what the report's T9 table shows. */
export async function listStrategyActions(
  db: Database,
  clientId: string,
  { limit = 20, statuses }: { limit?: number; statuses?: readonly StrategyActionStatus[] } = {},
): Promise<StrategyActionRow[]> {
  const where = statuses?.length
    ? and(eq(strategyActions.clientId, clientId), inArray(strategyActions.status, [...statuses]))
    : eq(strategyActions.clientId, clientId);
  const rows = await db
    .select()
    .from(strategyActions)
    .where(where)
    .orderBy(desc(strategyActions.createdAt))
    .limit(limit);
  return rows as StrategyActionRow[];
}

/**
 * Move an action to `next` only if it is currently in one of `from`. The
 * status test is in the UPDATE itself, so two clicks racing cannot both win;
 * the loser gets `null`.
 */
async function transition(
  db: Database,
  clientId: string,
  id: string,
  from: readonly StrategyActionStatus[],
  set: Partial<typeof strategyActions.$inferInsert> & { status: StrategyActionStatus },
): Promise<StrategyActionRow | null> {
  const [row] = await db
    .update(strategyActions)
    .set(set)
    .where(
      and(eq(strategyActions.id, id), eq(strategyActions.clientId, clientId), inArray(strategyActions.status, [...from])),
    )
    .returning();
  return (row as StrategyActionRow | undefined) ?? null;
}

/** proposed | snoozed → running. `startedAt` is the day the clock on its kill signal starts. */
export function acceptStrategyAction(
  db: Database,
  clientId: string,
  id: string,
  { acceptedBy, startedAt }: { acceptedBy: string | null; startedAt: string },
): Promise<StrategyActionRow | null> {
  return transition(db, clientId, id, ['proposed', 'snoozed'], { status: 'running', acceptedBy, startedAt });
}

/** proposed → snoozed ("Not now"). It can still be accepted later. */
export function snoozeStrategyAction(db: Database, clientId: string, id: string): Promise<StrategyActionRow | null> {
  return transition(db, clientId, id, ['proposed'], { status: 'snoozed' });
}
