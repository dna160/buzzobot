import { BriefObjective, METRICS, type MetricKey } from '@tempo/core';
import { z } from 'zod';

/**
 * `ReportSpec` — the adaptive-grid configuration (Brief Deck PRD §3.3).
 *
 * Which metrics a client's deck shows, in priority order. Stored per client
 * (`report_specs`); absent means the objective's preset, so every client has a
 * working deck before anyone configures anything.
 *
 * The part that matters is not the storage — it is that **validation is
 * objective-constrained**. Each objective declares an allowed metric set
 * mirroring the engine's own `ObjectiveContract` axes
 * (`tempo-engine/src/engine/contracts/presets.py`), so an `awareness` spec
 * containing `roas` or `conversionValue` is rejected. That is how "brand
 * awareness tidak melihat GMV sama sekali" becomes a guarantee enforced by a
 * schema instead of a habit enforced by whoever is reviewing the deck.
 *
 * Slot Swap (M6) is an array splice on `metrics`; the grid solver re-derives
 * the layout. It is not a layout feature and there is nothing to persist about
 * position.
 */

const METRIC_KEYS = Object.keys(METRICS) as [MetricKey, ...MetricKey[]];

export const MetricKeySchema = z.enum(METRIC_KEYS);

/**
 * The grid has no honest layout below three tiles, and a spec past twenty
 * metrics is an appendix pretending to be a deck. Named here so the schema and
 * the editor enforce the same two numbers rather than each carrying a literal.
 */
export const MIN_SPEC_METRICS = 3;
export const MAX_SPEC_METRICS = 20;

export const ReportSpecSchema = z.object({
  version: z.literal(1),
  preset: z.enum(['views', 'jualan', 'install', 'custom']),
  /** Ordered = priority; the first 3–6 tile, the rest reach Lampiran A. */
  metrics: z.array(MetricKeySchema).min(MIN_SPEC_METRICS).max(MAX_SPEC_METRICS),
  appendix: z
    .object({
      rawTable: z.boolean().default(true),
      allVideos: z.boolean().default(true),
      /** Lampiran C — probe trace, below-the-cut, coverage audit. D4: off. */
      internal: z.boolean().default(false),
    })
    .default({ rawTable: true, allVideos: true, internal: false }),
  targets: z.record(MetricKeySchema, z.number()).optional(),
});

export type ReportSpec = z.infer<typeof ReportSpecSchema>;
export type ReportSpecPreset = ReportSpec['preset'];

/**
 * What each objective is allowed to show, mirroring the engine's
 * `ObjectiveContract` axes. Two independent systems now agree on the same
 * boundary, and the engine re-checks it when it builds a metric frame — this
 * is the fast, local half.
 */
export const OBJECTIVE_METRICS: Record<BriefObjective, MetricKey[]> = {
  // AWARENESS_OBJECTIVE_CONTRACT: impressions, reach, frequency, vtr6s,
  // vtr15s, qualified_reach, cost, cpm. No outcome or revenue axis exists —
  // which is the whole point of the constraint.
  [BriefObjective.Awareness]: [
    'impressions',
    'reach',
    'frequency',
    'vtr6s',
    'vtr15s',
    'videoViews',
    'videoWatched6s',
    'engagedView15s',
    'cpv',
    'cpm',
    'spend',
    'clicks',
    'ctr',
    'cpc',
    'engagements',
  ],
  // GMV_OBJECTIVE_CONTRACT: impressions, clicks, ctr, cvr, orders, aov, gmv,
  // cost, roi. Orders/GMV reach Tempo as conversions/conversionValue.
  [BriefObjective.Gmv]: [
    'conversionValue',
    'conversions',
    'roas',
    'cpa',
    'conversionRate',
    'spend',
    'impressions',
    'clicks',
    'ctr',
    'cpc',
    'cpm',
    'reach',
    'frequency',
    'vtr6s',
    'vtr15s',
    'videoViews',
    'engagements',
  ],
  // INSTALL_OBJECTIVE_CONTRACT: impressions, clicks, ctr, ir, installs, cost,
  // cpi. Installs are `conversions`, CPI is `cpa`. `conversionValue`/`roas`
  // are excluded deliberately: Tempo has no revenue column an install client
  // could stand behind, so a revenue tile would be a fabricated outcome.
  [BriefObjective.Install]: [
    'conversions',
    'cpa',
    'conversionRate',
    'spend',
    'clicks',
    'ctr',
    'cpc',
    'impressions',
    'cpm',
    'reach',
    'frequency',
    'vtr6s',
    'videoViews',
    'engagements',
  ],
};

/** Preset metric orders. First 3–6 tile; the rest are appendix depth. */
export const REPORT_SPEC_PRESETS: Record<Exclude<ReportSpecPreset, 'custom'>, MetricKey[]> = {
  views: ['impressions', 'reach', 'vtr6s', 'vtr15s', 'frequency', 'cpm', 'spend', 'clicks', 'ctr'],
  jualan: [
    'conversionValue',
    'conversions',
    'roas',
    'spend',
    'cpa',
    'conversionRate',
    'impressions',
    'clicks',
    'ctr',
    'cpm',
  ],
  install: [
    'conversions',
    'cpa',
    'conversionRate',
    'spend',
    'clicks',
    'ctr',
    'impressions',
    'cpm',
    'reach',
  ],
};

export const PRESET_BY_OBJECTIVE: Record<BriefObjective, Exclude<ReportSpecPreset, 'custom'>> = {
  [BriefObjective.Awareness]: 'views',
  [BriefObjective.Gmv]: 'jualan',
  [BriefObjective.Install]: 'install',
};

export class ReportSpecObjectiveError extends Error {
  /** 422 — the spec parses, but not for this objective. */
  readonly status = 422;
  constructor(
    readonly objective: BriefObjective,
    readonly offending: MetricKey[],
  ) {
    super(
      `metrics [${offending.join(', ')}] are not available for the "${objective}" objective ` +
        `(allowed: ${OBJECTIVE_METRICS[objective].join(', ')})`,
    );
    this.name = 'ReportSpecObjectiveError';
  }
}

/** Metrics in `spec` that this objective may not show. */
export function disallowedMetrics(spec: ReportSpec, objective: BriefObjective): MetricKey[] {
  const allowed = new Set(OBJECTIVE_METRICS[objective]);
  const offending = spec.metrics.filter((m) => !allowed.has(m));
  const targetKeys = Object.keys(spec.targets ?? {}) as MetricKey[];
  // A target for a metric this objective cannot show would silently grade a
  // tile that never renders — reject it with the same rule, not a shrug.
  return [...offending, ...targetKeys.filter((m) => !allowed.has(m) && !offending.includes(m))];
}

/**
 * Parse and objective-check in one step. Throws `ZodError` on a malformed spec
 * and `ReportSpecObjectiveError` (422) on a well-formed spec that contradicts
 * its objective.
 */
export function parseReportSpec(raw: unknown, objective: BriefObjective): ReportSpec {
  const spec = ReportSpecSchema.parse(raw);
  const offending = disallowedMetrics(spec, objective);
  if (offending.length > 0) throw new ReportSpecObjectiveError(objective, offending);
  return spec;
}

/** The preset spec for an objective — what a client gets before anyone configures one. */
export function defaultReportSpec(objective: BriefObjective): ReportSpec {
  const preset = PRESET_BY_OBJECTIVE[objective];
  return {
    version: 1,
    preset,
    metrics: REPORT_SPEC_PRESETS[preset],
    appendix: { rawTable: true, allVideos: true, internal: false },
  };
}

/**
 * Resolve the spec a deck renders from. A stored spec that no longer suits its
 * objective (the objective's allowed set changed, or the client's north star
 * moved) falls back to the preset rather than failing the export — the deck
 * always renders, and `onInvalid` lets the caller log what it dropped.
 */
export function resolveReportSpec(
  stored: unknown | null | undefined,
  objective: BriefObjective,
  onInvalid?: (error: unknown) => void,
): ReportSpec {
  if (stored === null || stored === undefined) return defaultReportSpec(objective);
  try {
    return parseReportSpec(stored, objective);
  } catch (error) {
    onInvalid?.(error);
    return defaultReportSpec(objective);
  }
}

/** Preset order for the objective, used by the grid solver to fill a 5th-tile gap. */
export function presetMetricsFor(objective: BriefObjective): MetricKey[] {
  return REPORT_SPEC_PRESETS[PRESET_BY_OBJECTIVE[objective]];
}
