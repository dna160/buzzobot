import { and, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { reportBenchmarks } from '../schema.js';

/**
 * Storage for manually-entered benchmark targets behind the Template
 * Report's "Result Metric vs Benchmark" section. There is no industry
 * benchmark data anywhere in this system — every row here is a number an AM
 * typed in for a real negotiated target, keyed by (client, funnel stage,
 * metric).
 */

export interface StoredBenchmark {
  clientId: string;
  objective: string;
  metric: string;
  targetValue: number;
  comparisonDirection: 'higher_is_better' | 'lower_is_better';
  updatedBy: string | null;
  updatedAt: Date;
}

/** Every benchmark a client has, for the editor's grid. */
export async function listBenchmarks(db: Database, clientId: string): Promise<StoredBenchmark[]> {
  const rows = await db.select().from(reportBenchmarks).where(eq(reportBenchmarks.clientId, clientId));
  return rows.map((row) => ({
    clientId: row.clientId,
    objective: row.objective,
    metric: row.metric,
    targetValue: row.targetValue,
    comparisonDirection: row.comparisonDirection as 'higher_is_better' | 'lower_is_better',
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  }));
}

/** Idempotent per (client, objective, metric) — saving twice replaces, never duplicates. */
export async function upsertBenchmark(
  db: Database,
  input: {
    clientId: string;
    objective: string;
    metric: string;
    targetValue: number;
    comparisonDirection: 'higher_is_better' | 'lower_is_better';
    updatedBy?: string;
  },
): Promise<void> {
  await db
    .insert(reportBenchmarks)
    .values(input)
    .onConflictDoUpdate({
      target: [reportBenchmarks.clientId, reportBenchmarks.objective, reportBenchmarks.metric],
      set: {
        targetValue: input.targetValue,
        comparisonDirection: input.comparisonDirection,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      },
    });
}

export async function deleteBenchmark(
  db: Database,
  clientId: string,
  objective: string,
  metric: string,
): Promise<void> {
  await db
    .delete(reportBenchmarks)
    .where(
      and(
        eq(reportBenchmarks.clientId, clientId),
        eq(reportBenchmarks.objective, objective),
        eq(reportBenchmarks.metric, metric),
      ),
    );
}
