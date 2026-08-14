import type { NorthStar } from '@tempo/core';
import type { Locale } from '../i18n.js';
import type { HourlyReportBase } from '../hourly-model.js';
import { analyseHourly, type HourlyAnalysis } from '../hourly-analysis.js';
import { buildFactSheet, type FactSheet } from './facts.js';
import { systemPrompt, userPrompt } from './prompt.js';
import { NarrativeSchema, type Narrative } from './schema.js';
import {
  loadNarrativeConfig,
  type NarrativeConfig,
  type NarrativeProvider,
} from './provider.js';
import { AnthropicNarrativeProvider } from './providers/anthropic.js';
import { OpenAiCompatibleNarrativeProvider } from './providers/openai-compatible.js';
import {
  stripUnactionableRisks,
  verifyNarrative,
  verifyNoUnsupportedMetrics,
} from './verify.js';

export interface NarrativeResult {
  narrative: Narrative;
  /** Which path produced the text — surfaced in the report footer. */
  source: 'llm' | 'deterministic';
  provider: string | null;
  model: string | null;
  attempts: number;
  /** Why the LLM path was not used, when it wasn't. */
  fallbackReason?: string;
}

export function createNarrativeProvider(config: NarrativeConfig): NarrativeProvider | null {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicNarrativeProvider(config);
    case 'lmstudio':
    case 'openai-compatible':
      return new OpenAiCompatibleNarrativeProvider(config);
    case 'off':
      return null;
  }
}

/**
 * Produce the report narrative.
 *
 * The deterministic analysis always runs first — it computes the figures, and
 * doubles as the fallback. The model then writes prose from those figures. A
 * generated narrative is only accepted if it validates against the schema,
 * cites no number outside the fact sheet, and presents no figure for a metric
 * the export cannot support.
 *
 * Any failure — unreachable model, malformed JSON, invented figure — falls back
 * to the deterministic text rather than failing the report, because a report
 * that renders in plainer prose is far better than one that does not render at
 * all. `strict` mode turns that fallback into a hard error for CI.
 */
export async function generateNarrative(
  model: HourlyReportBase,
  locale: Locale,
  configOverride?: Partial<NarrativeConfig>,
): Promise<NarrativeResult> {
  const config = { ...loadNarrativeConfig(), ...configOverride };
  const analysis = analyseHourly(model);
  const deterministic = () => toNarrative(analysis);

  const provider = createNarrativeProvider(config);
  if (!provider) {
    return {
      narrative: deterministic(),
      source: 'deterministic',
      provider: null,
      model: null,
      attempts: 0,
    };
  }

  const facts = buildFactSheet(model);
  const system = systemPrompt(locale, model.client.northStar);
  const user = userPrompt(facts);

  let lastError = '';
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const raw = await provider.complete({ system, user, signal: controller.signal });
      const narrative = parseAndVerify(raw, facts, model.client.northStar);
      return {
        narrative,
        source: 'llm',
        provider: provider.name,
        model: config.model,
        attempts: attempt,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(
        `[reports] narrative attempt ${attempt}/${config.maxAttempts} failed: ${lastError}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  if (config.strict) {
    throw new Error(`Narrative generation failed after ${config.maxAttempts} attempts: ${lastError}`);
  }

  return {
    narrative: deterministic(),
    source: 'deterministic',
    provider: provider.name,
    model: config.model,
    attempts: config.maxAttempts,
    fallbackReason: lastError,
  };
}

/** Parse, schema-check, and run both guards. Throws with a usable message. */
export function parseAndVerify(raw: string, facts: FactSheet, northStar: NorthStar): Narrative {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Response was not valid JSON (starts: ${raw.slice(0, 120)})`);
  }

  // Unactionable measurement-gap entries are removed before validation, so the
  // register's minimum size is enforced against risks a team can actually act on.
  const result = NarrativeSchema.safeParse(stripUnactionableRisks(parsed, northStar));
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 4)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Response did not match the narrative schema — ${issues}`);
  }

  const numbers = verifyNarrative(result.data, facts);
  if (!numbers.ok) {
    const shown = numbers.violations
      .slice(0, 3)
      .map((v) => `"${v.token}" in ${v.field}`)
      .join('; ');
    throw new Error(
      `Narrative cited ${numbers.violations.length} figure(s) absent from the fact sheet — ${shown}`,
    );
  }

  const metrics = verifyNoUnsupportedMetrics(result.data, northStar);
  if (!metrics.ok) {
    const shown = metrics.violations.slice(0, 3).map((v) => `${v.token} (${v.field})`).join('; ');
    throw new Error(`Narrative presented a value for an unsupported metric — ${shown}`);
  }

  return result.data;
}

/** The deterministic analysis, shaped as a Narrative so both paths are alike. */
export function toNarrative(a: HourlyAnalysis): Narrative {
  return {
    headline: a.summaryProse.split(/(?<=[.!?])\s+/)[0] ?? a.summaryProse,
    summaryProse: a.summaryProse,
    daypart: a.daypart ? { finding: a.daypart.finding, prose: a.daypart.prose } : null,
    efficiency: a.efficiency ? { finding: a.efficiency.finding, prose: a.efficiency.prose } : null,
    mix: a.mix ? { finding: a.mix.finding, prose: a.mix.prose } : null,
    adgroup: a.adgroup ? { finding: a.adgroup.finding, prose: a.adgroup.prose } : null,
    dataGap: a.dataGap,
    risks: a.risks,
    outlook: a.outlook,
    confidence: a.confidence,
  };
}
