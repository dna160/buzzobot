import { z } from 'zod';
import { getSetting, setSetting, SETTINGS_KEYS } from '@tempo/db';
import {
  loadNarrativeConfig,
  NarrativeConfigSchema,
  probeLocalLlm,
  type NarrativeConfig,
} from '@tempo/reports';
import { router, publicProcedure } from '../trpc.js';

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
