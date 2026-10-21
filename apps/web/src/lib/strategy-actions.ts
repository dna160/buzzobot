import { insertProposedActionsOnce, recordActionMeasurement, type ActionMeasurement, type Database } from '@tempo/db';

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

interface ActionLogEntry {
  action_id: string;
  verdict: ActionMeasurement['verdict'];
  measured_value: number | null;
  category_delta: number | null;
}

/**
 * Close the loop (PRD §5.6, P5): write each running action's T11 measurement
 * from this run back to `strategy_actions`. A final verdict closes the action
 * (it then appears in later reports' T9 with that verdict and is not measured
 * again); `running` refreshes its latest value. Entries for actions an earlier
 * run already closed are no-ops — the transition is guarded in SQL.
 *
 * Returns how many rows changed. Like proposals, a failure is logged and never
 * fails the report.
 */
export async function recordActionMeasurements(db: Database, clientId: string, runId: string, content: unknown): Promise<number> {
  const log = (content as { action_log?: unknown } | null)?.action_log;
  if (!Array.isArray(log) || log.length === 0) return 0;
  let changed = 0;
  try {
    for (const raw of log as ActionLogEntry[]) {
      if (!raw?.action_id || !raw.verdict) continue;
      const row = await recordActionMeasurement(db, clientId, raw.action_id, {
        verdict: raw.verdict,
        measuredValue: raw.measured_value ?? null,
        categoryDelta: raw.category_delta ?? null,
        measuredRunId: runId,
      });
      if (row) changed += 1;
    }
  } catch (err) {
    console.error('[strategy-report] recording action measurements failed:', err);
  }
  return changed;
}

/** Everything a client-facing run writes back: its proposals and its measurements. */
export async function recordStrategyRun(db: Database, clientId: string, runId: string, content: unknown): Promise<void> {
  await recordActionMeasurements(db, clientId, runId, content);
  await recordProposedActions(db, clientId, runId, content);
}
