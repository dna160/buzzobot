import { and, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { reportSpecs } from '../schema.js';

/**
 * Storage for per-client Brief Deck specs (Brief Deck PRD §3.3).
 *
 * Deliberately schema-agnostic: this module reads and writes an opaque JSON
 * payload, and `@tempo/reports` owns what a valid spec *is*
 * (`ReportSpecSchema`, objective-constrained). Putting the validation here
 * would fork it — the deck builder and the M6 editor would then each be
 * checking against a different definition, which is exactly the drift the
 * schema exists to prevent.
 */

export interface StoredReportSpec {
  clientId: string;
  objective: string;
  spec: unknown;
  updatedAt: Date;
}

/** The stored spec for one client × objective, or `null` to use the preset. */
export async function getReportSpec(
  db: Database,
  clientId: string,
  objective: string,
): Promise<StoredReportSpec | null> {
  const [row] = await db
    .select()
    .from(reportSpecs)
    .where(and(eq(reportSpecs.clientId, clientId), eq(reportSpecs.objective, objective)))
    .limit(1);

  if (!row) return null;
  return {
    clientId: row.clientId,
    objective: row.objective,
    spec: row.spec,
    updatedAt: row.updatedAt,
  };
}

/** Every spec a client has, for the M6 editor's overview. */
export async function listReportSpecs(db: Database, clientId: string): Promise<StoredReportSpec[]> {
  const rows = await db.select().from(reportSpecs).where(eq(reportSpecs.clientId, clientId));
  return rows.map((row) => ({
    clientId: row.clientId,
    objective: row.objective,
    spec: row.spec,
    updatedAt: row.updatedAt,
  }));
}

/** Idempotent per (client, objective) — saving twice replaces, never duplicates. */
export async function upsertReportSpec(
  db: Database,
  clientId: string,
  objective: string,
  spec: unknown,
): Promise<void> {
  await db
    .insert(reportSpecs)
    .values({ clientId, objective, spec })
    .onConflictDoUpdate({
      target: [reportSpecs.clientId, reportSpecs.objective],
      set: { spec, updatedAt: new Date() },
    });
}

/** Revert a client to the objective preset by removing their stored spec. */
export async function deleteReportSpec(
  db: Database,
  clientId: string,
  objective: string,
): Promise<void> {
  await db
    .delete(reportSpecs)
    .where(and(eq(reportSpecs.clientId, clientId), eq(reportSpecs.objective, objective)));
}
