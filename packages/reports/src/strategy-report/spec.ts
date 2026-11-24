import { z } from 'zod';
import { TTMS_INSIGHT_METRICS, TTMS_STAGES, type ReportClass, type TtmsStageKey } from '@tempo/core';

/**
 * What an AM may set for a client's Strategy Report (PRD §6.4, §9.3) and the
 * rules a setting must satisfy — the single definition both the tRPC editor and
 * any later caller validate against, as `deck/spec.ts` is for the deck.
 *
 * Goal rules carry the P0 corrections (docs/phases/strategy-report/P0_DISCOVERY.md):
 *  - `size_ratio` (the PRD's `move_on_rate`) exists for Awareness→Consideration
 *    and Consideration→Conversion only, and is a ratio of stage sizes.
 *  - `cost_per_new` only for Awareness and Consideration: Conversion-stage
 *    new/outflow is 0 every day for 14 of 15 accounts (P0 §6.3), so a cost per
 *    new Conversion could never be measured.
 *  - `share` goals name a TTMS insight metric that has a vertical share (not NSR).
 */

export const GOAL_KINDS = ['rank', 'share', 'size_ratio', 'cost_per_new'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

/** Stages a goal of each kind may name; `share` goals name a metric instead. */
export const GOAL_STAGES: Record<Exclude<GoalKind, 'share'>, readonly TtmsStageKey[]> = {
  rank: TTMS_STAGES,
  size_ratio: ['awareness', 'consideration'],
  cost_per_new: ['awareness', 'consideration'],
};

export const SHARE_GOAL_METRICS = TTMS_INSIGHT_METRICS.filter((m) => m !== 'nsr');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const StrategyGoalSchema = z.object({
  kind: z.enum(GOAL_KINDS),
  stage: z.enum(TTMS_STAGES).nullable().default(null),
  metric: z.enum(TTMS_INSIGHT_METRICS).nullable().default(null),
  value: z.number().finite(),
  deadline: isoDate,
});
export type StrategyGoal = z.infer<typeof StrategyGoalSchema>;

export const StrategySpecSchema = z.object({
  /** Which TTMS account to report on when the client has several; null = the primary one. */
  ttmsAccountId: z.string().min(1).nullable().default(null),
  reportClassOverride: z.enum(['brand', 'shop']).nullable().default(null),
  goal: StrategyGoalSchema.nullable().default(null),
  /** IDR per month. Creator fees never appear in TikTok Ads, so the AM types them. */
  creatorFeeMonthly: z.number().finite().nonnegative().nullable().default(null),
  bgcCostMonthly: z.number().finite().nonnegative().nullable().default(null),
});
export type StrategySpec = z.infer<typeof StrategySpecSchema>;

export const EMPTY_STRATEGY_SPEC: StrategySpec = StrategySpecSchema.parse({});

export interface StrategySpecIssue {
  field: string;
  message: string;
}

/** 422 — the spec parses, but asks for something the data cannot support. */
export class StrategySpecError extends Error {
  readonly status = 422;
  constructor(readonly issues: StrategySpecIssue[]) {
    super(issues.map((i) => `${i.field}: ${i.message}`).join('; '));
    this.name = 'StrategySpecError';
  }
}

/**
 * Parse and check a spec. `today` (YYYY-MM-DD) rejects a deadline already past;
 * `accountIds` — the client's mirrored TTMS accounts — rejects an account the
 * client does not own. Throws `ZodError` for a malformed payload (400) and
 * `StrategySpecError` for a well-formed but unsupportable one (422).
 */
export function parseStrategySpec(
  input: unknown,
  ctx: { today: string; accountIds: readonly string[] },
): StrategySpec {
  const spec = StrategySpecSchema.parse(input);
  const issues: StrategySpecIssue[] = [];

  if (spec.ttmsAccountId && !ctx.accountIds.includes(spec.ttmsAccountId)) {
    issues.push({ field: 'ttmsAccountId', message: 'not a Market Scope account of this client' });
  }

  const g = spec.goal;
  if (g) {
    if (g.deadline <= ctx.today) issues.push({ field: 'goal.deadline', message: 'must be after today' });
    if (g.kind === 'share') {
      if (!g.metric || !SHARE_GOAL_METRICS.includes(g.metric as (typeof SHARE_GOAL_METRICS)[number])) {
        issues.push({ field: 'goal.metric', message: `share goals need one of ${SHARE_GOAL_METRICS.join(', ')}` });
      }
      if (g.stage) issues.push({ field: 'goal.stage', message: 'share goals name a metric, not a stage' });
      if (!(g.value > 0 && g.value <= 1)) issues.push({ field: 'goal.value', message: 'a share is between 0 and 1' });
    } else {
      const allowed = GOAL_STAGES[g.kind];
      if (!g.stage || !allowed.includes(g.stage)) {
        issues.push({ field: 'goal.stage', message: `${g.kind} goals need one of ${allowed.join(', ')}` });
      }
      if (g.metric) issues.push({ field: 'goal.metric', message: `${g.kind} goals name a stage, not a metric` });
      if (g.kind === 'rank' && !(Number.isInteger(g.value) && g.value >= 1)) {
        issues.push({ field: 'goal.value', message: 'a rank is a whole number from 1' });
      }
      if (g.kind !== 'rank' && !(g.value > 0)) issues.push({ field: 'goal.value', message: 'must be above 0' });
    }
  }

  if (issues.length) throw new StrategySpecError(issues);
  return spec;
}

/** Flatten a spec to the `strategy_specs` row shape (and back), so the db layer stays schema-agnostic. */
export function strategySpecToRow(spec: StrategySpec) {
  return {
    ttmsAccountId: spec.ttmsAccountId,
    reportClassOverride: spec.reportClassOverride as ReportClass | null,
    goalKind: spec.goal?.kind ?? null,
    goalStage: spec.goal?.stage ?? null,
    goalMetric: spec.goal?.metric ?? null,
    goalValue: spec.goal?.value ?? null,
    goalDeadline: spec.goal?.deadline ?? null,
    creatorFeeMonthly: spec.creatorFeeMonthly,
    bgcCostMonthly: spec.bgcCostMonthly,
  };
}

/** A stored row as the db hands it back: plain strings, re-checked by the schema on the way in. */
export interface LooseStrategySpecRow {
  ttmsAccountId: string | null;
  reportClassOverride: string | null;
  goalKind: string | null;
  goalStage: string | null;
  goalMetric: string | null;
  goalValue: number | null;
  goalDeadline: string | null;
  creatorFeeMonthly: number | null;
  bgcCostMonthly: number | null;
}

export function strategySpecFromRow(row: LooseStrategySpecRow): StrategySpec {
  return StrategySpecSchema.parse({
    ttmsAccountId: row.ttmsAccountId,
    reportClassOverride: row.reportClassOverride,
    goal:
      row.goalKind && row.goalValue != null && row.goalDeadline
        ? { kind: row.goalKind, stage: row.goalStage, metric: row.goalMetric, value: row.goalValue, deadline: row.goalDeadline }
        : null,
    creatorFeeMonthly: row.creatorFeeMonthly,
    bgcCostMonthly: row.bgcCostMonthly,
  });
}
