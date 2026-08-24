import { recentReportRuns } from '@tempo/db';
import { router, publicProcedure } from '../trpc.js';

const TEMPO_ENGINE_URL = process.env.TEMPO_ENGINE_URL ?? 'http://127.0.0.1:8001';
const HEALTH_TIMEOUT_MS = 4_000;

export interface EngineHealthz {
  status?: string;
  engine_version?: string;
  content_version?: number;
  tiers?: string[];
  probe_loop_enabled?: boolean;
  db?: boolean;
  briefs_total?: number;
  last_run?: {
    run_id?: string;
    brief_type?: string;
    status?: string;
    tier?: string | null;
    updated_at?: string | null;
  } | null;
}

export const settingsRouter = router({
  /**
   * Engine health for the Settings card (Brief Deck PRD §7, K6).
   *
   * Replaces the LM Studio probe UI. That card asked an operator to configure a
   * model connection the surface no longer owns — narration moved to
   * tempo-engine — so the useful question changed from "which model should I
   * use" to "is the engine up, and did the last deck render".
   *
   * Two sources, deliberately: `/healthz` for the engine's own view, and
   * `report_runs` for the surface's. If the engine is unreachable, the deck
   * history still tells an operator when decks last worked.
   */
  getEngineHealth: publicProcedure.query(async ({ ctx }) => {
    let engine: EngineHealthz | null = null;
    let engineError: string | null = null;

    try {
      const response = await fetch(`${TEMPO_ENGINE_URL}/healthz`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        cache: 'no-store',
      });
      if (response.ok) {
        engine = (await response.json()) as EngineHealthz;
      } else {
        engineError = `HTTP ${response.status}`;
      }
    } catch (error) {
      // Unreachable is a state the card renders, not an error it throws: an
      // operator opening Settings to find out why decks are failing should not
      // be met with a broken page.
      engineError = (error as Error).message;
    }

    const runs = await recentReportRuns(ctx.db, 8);

    return {
      url: TEMPO_ENGINE_URL,
      reachable: engine !== null,
      engineError,
      engine,
      recentRuns: runs.map((run) => ({
        id: run.id,
        objective: run.objective,
        tier: run.tier,
        status: run.status,
        runId: run.runId,
        periodEnd: run.periodEnd,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
        artifactBytes: run.artifactBytes,
        error: run.error,
      })),
    };
  }),
});
