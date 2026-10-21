import { z } from 'zod';

/**
 * Zod mirrors of the Strategy Report blocks `tempo-engine` adds to
 * `BriefContentV2` (`src/engine/contracts/strategy.py`, Strategy Report PRD
 * §10). Snake_case wire shape, parse-don't-trust, and drift-checked against the
 * engine's exported JSON Schema in `engine-content.drift.test.ts` — the same
 * three rules as `deck/engine-content.ts`, which composes these into the
 * content schema as optional fields.
 */

const isoDate = z.string();

export const EngineClassificationSchema = z.object({
  report_class: z.enum(['brand', 'shop']),
  score: z.number(),
  inferred_class: z.enum(['brand', 'shop']),
  overridden: z.boolean().default(false),
  inputs: z.record(z.union([z.number(), z.string(), z.null()])).default({}),
});

export const EngineActionValueSchema = z.object({
  value: z.number(),
  format: z.enum(['percent', 'number', 'idr', 'rank', 'ratio']),
  as_of: isoDate.nullable().optional(),
  by: isoDate.nullable().optional(),
});

export const EngineActionStakeSchema = z.object({
  value: z.number(),
  unit: z.enum(['impressions', 'people', 'idr', 'ranks']),
  range: z.tuple([z.number(), z.number()]),
});

export const EngineKillSignalSchema = z.object({
  metric_key: z.string(),
  condition: z.enum(['no_rise_within_days', 'no_fall_within_days']),
  days: z.number(),
});

export const EngineActionCopySchema = z.object({
  langkah: z.string(),
  dasar: z.string(),
  cara: z.string(),
  gagal_jika: z.string(),
});

export const EngineActionItemSchema = z.object({
  id: z.string(),
  rank: z.number(),
  priority: z.enum(['P0', 'P1', 'P2']),
  lever: z.enum(['content_mix', 'budget_cap', 'stage_targeting', 'creative_refresh', 'creator_boost', 'investigate']),
  metric_key: z.string(),
  entity: z.record(z.unknown()),
  current: EngineActionValueSchema.nullable(),
  target: EngineActionValueSchema.nullable(),
  horizon_days: z.number(),
  delta: z.record(z.number()).nullable().optional(),
  stake: EngineActionStakeSchema.nullable().optional(),
  basis: z.enum(['benchmark_top10', 'own_history', 'solver_cap', 'defensive']),
  confidence: z.enum(['high', 'medium', 'low']),
  kill_signal: EngineKillSignalSchema.nullable(),
  evidence_refs: z.array(z.string()),
  subject: z.string().default(''),
  copy: EngineActionCopySchema.nullable().optional(),
});

export const EngineSignalSchema = z.object({
  finding_id: z.string().nullable(),
  kind: z.string(),
  status: z.enum(['investigate', 'watch', 'good', 'locked']),
  title: z.string(),
  detail: z.string(),
});

export const EngineGoalPaceSchema = z.object({
  kind: z.string(),
  stage: z.string().nullable().optional(),
  metric: z.string().nullable().optional(),
  target: z.number(),
  deadline: isoDate,
  current: z.number().nullable().optional(),
  projected: z.number().nullable().optional(),
  projected_low: z.number().nullable().optional(),
  projected_high: z.number().nullable().optional(),
  required_pace_per_week: z.number().nullable().optional(),
  current_pace_per_week: z.number().nullable().optional(),
  feasibility: z.number().nullable().optional(),
  status: z.enum(['on_track', 'off_track', 'unreachable', 'no_goal', 'insufficient_history']),
  weekly: z.array(z.object({ date: isoDate, value: z.number() })).default([]),
});

export const EngineActionMeasuredSchema = z.object({
  action_id: z.string(),
  started_at: isoDate,
  langkah: z.string().nullable().optional(),
  metric_key: z.string(),
  start_value: z.number().nullable(),
  measured_value: z.number().nullable(),
  target_value: z.number().nullable(),
  category_delta: z.number().nullable(),
  verdict: z.enum(['worked', 'weak', 'failed', 'running']),
  days_running: z.number(),
});

const FunnelBar = z.object({
  stage: z.string(),
  total: z.number().nullable(),
  bench_total: z.number().nullable().optional(),
  rank: z.number().nullable().optional(),
  rank_n: z.number().nullable().optional(),
});

export const EngineStrategyChartsSchema = z.object({
  funnel: z.array(FunnelBar).default([]),
  spend_response: z
    .object({
      stage: z.string(),
      lag_days: z.number(),
      points: z.array(z.object({ spend: z.number(), new: z.number() })),
      fit: z.object({ a: z.number(), b: z.number(), r2: z.number(), knee: z.number() }).nullable(),
    })
    .nullable()
    .optional(),
  rank_weekly: z.array(z.object({ stage: z.string(), date: isoDate, rank: z.number() })).default([]),
  content_mix: z
    .array(z.object({ content_type: z.string(), share: z.number(), bench_share: z.number().nullable() }))
    .default([]),
  rank_list: z
    .object({
      stage: z.string(),
      as_of: isoDate,
      n: z.number().nullable(),
      rows: z.array(z.object({ brand: z.string(), rank: z.number(), rank_7d: z.number().nullable(), own: z.boolean() })),
    })
    .nullable()
    .optional(),
  stage_table: z
    .array(
      z.object({
        stage: z.string(),
        total: z.number().nullable(),
        rank: z.number().nullable(),
        rank_n: z.number().nullable(),
        new: z.number().nullable(),
        outflow: z.number().nullable(),
        bench_total: z.number().nullable(),
      }),
    )
    .default([]),
});

export const EngineStrategyMetaSchema = z.object({
  ttms_account_id: z.string(),
  brand_name: z.string(),
  vertical: z.string().nullable().optional(),
  plan: z.string().nullable().optional(),
  is_lite: z.boolean().default(true),
  as_of: isoDate,
  window_start: isoDate,
  window_end: isoDate,
  benchmark: z.string().default('top10'),
  section_order: z.array(z.number()).default([]),
  prompt_version: z.string().nullable().optional(),
  degraded: z.array(z.string()).default([]),
  eval: z.record(z.unknown()).default({}),
});

/** A narrated T3–T8 section (instant template or narrator), PRD §8.3. */
export const EngineStrategySectionDraftSchema = z.object({
  headline: z.string(),
  paragraphs: z.array(z.object({ text: z.string(), evidence_refs: z.array(z.string()) })),
  implication: z.string().nullable().optional(),
});

/** T1 — the verdict, written last (PRD §5.1). */
export const EngineVerdictDraftSchema = z.object({
  headline: z.string(),
  paragraph: z.string(),
  chips: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      status: z.enum(['critical', 'watch', 'good', 'off_track', 'on_track', 'unknown']),
      finding_id: z.string().nullable().optional(),
    }),
  ),
});

export type EngineClassification = z.infer<typeof EngineClassificationSchema>;
export type EngineActionItem = z.infer<typeof EngineActionItemSchema>;
export type EngineSignal = z.infer<typeof EngineSignalSchema>;
export type EngineGoalPace = z.infer<typeof EngineGoalPaceSchema>;
export type EngineActionMeasured = z.infer<typeof EngineActionMeasuredSchema>;
export type EngineStrategyCharts = z.infer<typeof EngineStrategyChartsSchema>;
export type EngineStrategyMeta = z.infer<typeof EngineStrategyMetaSchema>;
export type EngineStrategySectionDraft = z.infer<typeof EngineStrategySectionDraftSchema>;
export type EngineVerdictDraft = z.infer<typeof EngineVerdictDraftSchema>;
