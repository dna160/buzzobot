import { z } from 'zod';

/**
 * Narrative generation is provider-pluggable so the same report can be produced
 * by the Anthropic API in hosted deployments and by a local LM Studio server
 * when the pipeline runs on someone's machine — without the report code
 * knowing which.
 */
export const NarrativeConfigSchema = z.object({
  /**
   * 'anthropic' — the Claude API.
   * 'lmstudio' — a local LM Studio server (OpenAI-compatible endpoint).
   * 'openai-compatible' — any other OpenAI-shaped endpoint (Ollama, vLLM, …).
   * 'off' — skip the model entirely and use the deterministic narrative.
   */
  provider: z.enum(['anthropic', 'lmstudio', 'openai-compatible', 'off']).default('off'),
  model: z.string().default('claude-opus-4-8'),
  /** Base URL for the local/compatible providers. */
  baseUrl: z.string().default('http://localhost:1234/v1'),
  /** Wall-clock budget for one generation attempt. */
  timeoutMs: z.number().int().positive().default(120_000),
  /** Retries on a failed generation or a rejected verification. */
  maxAttempts: z.number().int().min(1).max(5).default(2),
  /**
   * When true, a verification failure aborts report generation instead of
   * silently falling back. Useful in CI to catch a regressed prompt.
   */
  strict: z.boolean().default(false),
});

export type NarrativeConfig = z.infer<typeof NarrativeConfigSchema>;

export const loadNarrativeConfig = (
  env: NodeJS.ProcessEnv = process.env,
): NarrativeConfig => {
  const explicit = env.REPORT_NARRATIVE_PROVIDER;
  // Default to the Anthropic API when a key is present and nothing is set,
  // so a configured deployment gets LLM prose without extra ceremony.
  const provider = explicit ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : 'off');

  return NarrativeConfigSchema.parse({
    provider,
    model:
      env.REPORT_NARRATIVE_MODEL ??
      (provider === 'anthropic' ? 'claude-opus-4-8' : 'local-model'),
    baseUrl: env.REPORT_NARRATIVE_BASE_URL ?? 'http://localhost:1234/v1',
    timeoutMs: env.REPORT_NARRATIVE_TIMEOUT_MS
      ? Number(env.REPORT_NARRATIVE_TIMEOUT_MS)
      : undefined,
    maxAttempts: env.REPORT_NARRATIVE_MAX_ATTEMPTS
      ? Number(env.REPORT_NARRATIVE_MAX_ATTEMPTS)
      : undefined,
    strict: env.REPORT_NARRATIVE_STRICT === 'true',
  });
};

/** What a provider must do: turn two prompts into raw JSON text. */
export interface NarrativeProvider {
  readonly name: string;
  complete(args: {
    system: string;
    user: string;
    signal: AbortSignal;
  }): Promise<string>;
}
