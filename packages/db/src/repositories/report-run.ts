import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { Database } from '../client.js';
import { reportRuns } from '../schema.js';

/**
 * The deck pre-generation ledger (Brief Deck PRD §5).
 *
 * The weekly cron renders a full-tier deck per client × objective ahead of
 * Monday and records it here; the route serves that artifact rather than
 * spending minutes regenerating while someone waits. Every live generation is
 * recorded too, which is what lets the engine health card answer "did the last
 * run work" from the surface's own data.
 *
 * Artifacts are files, not rows — same reasoning as thumbnails. A PDF is an
 * opaque blob nothing queries, and putting megabytes in Postgres to avoid a
 * directory is a trade nobody wins.
 */

export type ReportRunStatus = 'running' | 'completed' | 'failed';
export type ReportRunTier = 'instant' | 'full';

export interface ReportRunRow {
  id: string;
  clientId: string;
  objective: string;
  /** Null while a run is in flight and its window is not yet known. */
  periodStart: string | null;
  periodEnd: string | null;
  tier: string;
  runId: string | null;
  status: string;
  artifactPath: string | null;
  artifactBytes: number | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** A lookup always knows the window it wants — that is what makes it a key. */
export interface ReportRunKey {
  clientId: string;
  objective: string;
  periodStart: string;
  periodEnd: string;
  tier: ReportRunTier;
}

/** What a run is recorded with. The window may not be known yet (async runs). */
export interface ReportRunSeed {
  clientId: string;
  objective: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  tier: ReportRunTier;
}

/** Where rendered decks are stored. Override per deployment. */
export const artifactDir = (): string =>
  process.env.TEMPO_ARTIFACT_DIR ?? '.tempo-media/decks';

/**
 * How long a pre-generated deck may be served before it is regenerated.
 *
 * A deck covers a fixed window, but the *data* in that window keeps arriving —
 * yesterday's numbers are re-ingested, late conversions land. Serving a
 * three-day-old artifact for today's request would quietly contradict the
 * dashboard, so an artifact is only "the Monday deck" for about a day.
 */
export const artifactMaxAgeHours = (): number =>
  Number(process.env.DECK_ARTIFACT_MAX_AGE_HOURS ?? 24);

export async function startReportRun(
  db: Database,
  seed: ReportRunSeed,
  runId?: string | null,
): Promise<string> {
  const [row] = await db
    .insert(reportRuns)
    .values({
      clientId: seed.clientId,
      objective: seed.objective,
      tier: seed.tier,
      periodStart: seed.periodStart || null,
      periodEnd: seed.periodEnd || null,
      runId: runId ?? null,
      status: 'running',
    })
    .returning({ id: reportRuns.id });
  return row!.id;
}

export async function completeReportRun(
  db: Database,
  id: string,
  result: {
    runId?: string | null;
    artifactPath?: string | null;
    artifactBytes?: number | null;
    /**
     * The window the deck actually covers. An async run is recorded before the
     * rollup is read, so its row starts with an empty period and fills it in
     * here — without this the artifact could never match the cache key it is
     * stored under, and every "pre-generated" deck would regenerate.
     */
    periodStart?: string;
    periodEnd?: string;
  },
): Promise<void> {
  await db
    .update(reportRuns)
    .set({
      status: 'completed',
      finishedAt: new Date(),
      ...(result.runId !== undefined ? { runId: result.runId } : {}),
      ...(result.periodStart ? { periodStart: result.periodStart } : {}),
      ...(result.periodEnd ? { periodEnd: result.periodEnd } : {}),
      artifactPath: result.artifactPath ?? null,
      artifactBytes: result.artifactBytes ?? null,
    })
    .where(eq(reportRuns.id, id));
}

export async function failReportRun(db: Database, id: string, error: string): Promise<void> {
  await db
    .update(reportRuns)
    .set({ status: 'failed', finishedAt: new Date(), error: error.slice(0, 1000) })
    .where(eq(reportRuns.id, id));
}

/**
 * The freshest completed run for this exact key, or null.
 *
 * "Fresh" is deliberately a time window rather than a version comparison: the
 * surface has no cheap way to know whether the underlying facts moved since the
 * artifact was rendered, and guessing wrong means serving a client a number the
 * dashboard no longer shows.
 */
export async function latestCompletedRun(
  db: Database,
  key: ReportRunKey,
  maxAgeHours = artifactMaxAgeHours(),
): Promise<ReportRunRow | null> {
  const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000);
  const [row] = await db
    .select()
    .from(reportRuns)
    .where(
      and(
        eq(reportRuns.clientId, key.clientId),
        eq(reportRuns.objective, key.objective),
        eq(reportRuns.periodStart, key.periodStart),
        eq(reportRuns.periodEnd, key.periodEnd),
        eq(reportRuns.tier, key.tier),
        eq(reportRuns.status, 'completed'),
        gte(reportRuns.startedAt, cutoff),
      ),
    )
    .orderBy(desc(reportRuns.startedAt))
    .limit(1);
  return (row as ReportRunRow | undefined) ?? null;
}

/** Recent runs across all clients — the health card's "did it work" list. */
export async function recentReportRuns(db: Database, limit = 10): Promise<ReportRunRow[]> {
  const rows = await db
    .select()
    .from(reportRuns)
    .orderBy(desc(reportRuns.startedAt))
    .limit(limit);
  return rows as ReportRunRow[];
}

/** One run by id — used by the portal's poll to find what it started. */
export async function getReportRun(db: Database, id: string): Promise<ReportRunRow | null> {
  const [row] = await db.select().from(reportRuns).where(eq(reportRuns.id, id)).limit(1);
  return (row as ReportRunRow | undefined) ?? null;
}

export async function writeArtifact(
  filename: string,
  bytes: Uint8Array,
  dir = artifactDir(),
): Promise<{ path: string; bytes: number }> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, filename);
  await writeFile(path, bytes);
  return { path, bytes: bytes.byteLength };
}

/** Read a stored artifact back, or null if it is gone (a cleaned volume, say). */
export async function readArtifact(path: string | null | undefined): Promise<Buffer | null> {
  if (!path) return null;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}
