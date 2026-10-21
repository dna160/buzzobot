import { insertProposedActionsOnce, type Database } from '@tempo/db';

/**
 * Record a strategy run's Action List as `proposed` rows (PRD §5.6, Q3 default:
 * a run proposes, only an AM's explicit accept starts the loop). Stored exactly
 * as the engine sent each `ActionItem` — the target the next run measures
 * against must be the Target Solver's, never a re-phrasing.
 *
 * Failure here never fails the report: the client still gets their PDF, and
 * the panel simply shows no actions to accept for this run.
 */
export async function recordProposedActions(db: Database, clientId: string, runId: string, content: unknown): Promise<void> {
  const plan = (content as { action_plan?: unknown } | null)?.action_plan;
  if (!Array.isArray(plan) || plan.length === 0) return;
  try {
    await insertProposedActionsOnce(db, clientId, runId, plan);
  } catch (err) {
    console.error('[strategy-report] recording proposed actions failed:', err);
  }
}
