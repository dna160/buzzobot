import { z } from 'zod';
import { getSetting, setSetting, SETTINGS_KEYS } from '@tempo/db';
import {
  loadNarrativeConfig,
  NarrativeConfigSchema,
  probeLocalLlm,
  type NarrativeConfig,
} from '@tempo/reports';
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

/**
 * The report-narrative config the operator may edit in Settings. It is exactly
 * the narrative config minus the secret: the API key is never stored in or
 * returned from the database — the OpenAI-compatible provider reads
 * REPORT_NARRATIVE_API_KEY from the environment, so keys stay out of the app DB.
 */
const ReportAiSettingsSchema = NarrativeConfigSchema;

/** Read the stored override, defensively — a bad row falls back to env. */
async function readStored(
  db: Parameters<typeof getSetting>[0],
): Promise<Partial<NarrativeConfig> | null> {
  const raw = await getSetting(db, SETTINGS_KEYS.reportNarrative);
  if (!raw) return null;
  const parsed = NarrativeConfigSchema.partial().safeParse(raw);
  return parsed.success ? parsed.data : null;
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

  /**
   * The effective report-AI config the export will actually use — the .env
   * defaults with any saved Settings override merged on top — plus enough
   * provenance for the UI to explain where the value comes from.
   */
  getReportAi: publicProcedure.query(async ({ ctx }) => {
    const envConfig = loadNarrativeConfig();
    const stored = await readStored(ctx.db);
    const effective: NarrativeConfig = { ...envConfig, ...stored };

    return {
      effective,
      /** Which fields are pinned by a saved Settings value (vs. inherited from env). */
      overriddenKeys: stored ? (Object.keys(stored) as Array<keyof NarrativeConfig>) : [],
      hasStoredOverride: stored !== null,
      envProvider: envConfig.provider,
      /** Surfaced so the UI can say a key is present without ever exposing it. */
      apiKeyConfigured: Boolean(process.env.REPORT_NARRATIVE_API_KEY),
    };
  }),

  /** Persist the operator's report-AI config. Validated before it hits the DB. */
  updateReportAi: publicProcedure
    .input(ReportAiSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      await setSetting(ctx.db, SETTINGS_KEYS.reportNarrative, input);
      return { ok: true as const, saved: input };
    }),

  /**
   * Probe a local/compatible endpoint with the given connection values, so the
   * operator can test before saving. Reuses the same checks as the CLI doctor.
   * The API key (if any) is taken from the environment, never from the client.
   */
  testReportAiConnection: publicProcedure
    .input(
      z.object({
        baseUrl: z.string().min(1),
        model: z.string().min(1),
        timeoutMs: z.number().int().positive().max(600_000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return probeLocalLlm({
        baseUrl: input.baseUrl,
        model: input.model,
        // Cap the interactive test so the request can't hang the UI for minutes.
        timeoutMs: Math.min(input.timeoutMs ?? 30_000, 30_000),
        apiKey: process.env.REPORT_NARRATIVE_API_KEY,
      });
    }),
});
