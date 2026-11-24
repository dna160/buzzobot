import { and, count, desc, eq, gte, lt } from 'drizzle-orm';
import type { Database } from '../client.js';
import { templateReportRuns } from '../schema.js';

/**
 * The Template Report generation ledger — the cache behind `/r/:token`.
 *
 * A Template Report costs one to three minutes of LM Studio time, so a shared
 * link that regenerated on every open would be slow, would reword its prose on
 * every refresh, and would let anyone holding the link queue model runs at
 * will. Instead each (client, template, benchmark, window) is generated once,
 * its HTML stored as a file (same reasoning as `report-run.ts`: an opaque blob
 * nothing queries), and served from there while it is fresh.
 */

export interface TemplateReportRunKey {
  clientId: string;
  template: string;
  benchmarkMode: string;
  periodStart: string;
  /** Inclusive. */
  periodEnd: string;
}

export interface TemplateReportRunRow extends TemplateReportRunKey {
  id: string;
  status: string;
  artifactPath: string | null;
  artifactBytes: number | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/**
 * A `running` row older than this is a generation whose process died (a
 * restart mid-run) — the route's own `maxDuration` is 10 minutes, so nothing
 * legitimate is still going after 15.
 */
const STALE_RUN_MINUTES = 15;

function keyMatches(key: TemplateReportRunKey) {
  return [
    eq(templateReportRuns.clientId, key.clientId),
    eq(templateReportRuns.template, key.template),
    eq(templateReportRuns.benchmarkMode, key.benchmarkMode),
    eq(templateReportRuns.periodStart, key.periodStart),
    eq(templateReportRuns.periodEnd, key.periodEnd),
  ];
}

/** The newest completed run for this key, no older than `maxAgeHours` (null = any age). */
export async function latestCompletedTemplateReportRun(
  db: Database,
  key: TemplateReportRunKey,
  maxAgeHours: number | null,
): Promise<TemplateReportRunRow | null> {
  const conditions = [...keyMatches(key), eq(templateReportRuns.status, 'completed')];
  if (maxAgeHours !== null) {
    conditions.push(gte(templateReportRuns.startedAt, new Date(Date.now() - maxAgeHours * 3_600_000)));
  }
  const [row] = await db
    .select()
    .from(templateReportRuns)
    .where(and(...conditions))
    .orderBy(desc(templateReportRuns.startedAt))
    .limit(1);
  return (row as TemplateReportRunRow | undefined) ?? null;
}

/** The most recent run for this key whatever its status — what a poll reports on. */
export async function latestTemplateReportRun(
  db: Database,
  key: TemplateReportRunKey,
): Promise<TemplateReportRunRow | null> {
  const [row] = await db
    .select()
    .from(templateReportRuns)
    .where(and(...keyMatches(key)))
    .orderBy(desc(templateReportRuns.startedAt))
    .limit(1);
  return (row as TemplateReportRunRow | undefined) ?? null;
}

/**
 * Claim the right to generate this key. Returns the new run id, or null when a
 * run for the same key is already in flight — the caller then waits on that one
 * instead of starting a second (`template_report_runs_running_uq`).
 */
export async function claimTemplateReportRun(db: Database, key: TemplateReportRunKey): Promise<string | null> {
  await db
    .update(templateReportRuns)
    .set({ status: 'failed', finishedAt: new Date(), error: 'abandoned (no result within the run limit)' })
    .where(
      and(
        ...keyMatches(key),
        eq(templateReportRuns.status, 'running'),
        lt(templateReportRuns.startedAt, new Date(Date.now() - STALE_RUN_MINUTES * 60_000)),
      ),
    );

  const [row] = await db
    .insert(templateReportRuns)
    .values({ ...key, status: 'running' })
    .onConflictDoNothing()
    .returning({ id: templateReportRuns.id });
  return row?.id ?? null;
}

/** Runs currently generating for a client, across every key — the per-link concurrency cap. */
export async function countRunningTemplateReportRuns(db: Database, clientId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(templateReportRuns)
    .where(
      and(
        eq(templateReportRuns.clientId, clientId),
        eq(templateReportRuns.status, 'running'),
        gte(templateReportRuns.startedAt, new Date(Date.now() - STALE_RUN_MINUTES * 60_000)),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function completeTemplateReportRun(
  db: Database,
  id: string,
  artifact: { artifactPath: string; artifactBytes: number },
): Promise<void> {
  await db
    .update(templateReportRuns)
    .set({ status: 'completed', finishedAt: new Date(), ...artifact })
    .where(eq(templateReportRuns.id, id));
}

export async function failTemplateReportRun(db: Database, id: string, error: string): Promise<void> {
  await db
    .update(templateReportRuns)
    .set({ status: 'failed', finishedAt: new Date(), error: error.slice(0, 1000) })
    .where(eq(templateReportRuns.id, id));
}
