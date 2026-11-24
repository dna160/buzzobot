import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  EMPTY_STRATEGY_SPEC,
  StrategySpecError,
  parseStrategySpec,
  strategySpecFromRow,
  strategySpecToRow,
} from './spec.js';

const ctx = { today: '2026-10-21', accountIds: ['7522417104012722196'] };
const issues = (input: unknown) => {
  try {
    parseStrategySpec(input, ctx);
    return [];
  } catch (e) {
    if (e instanceof StrategySpecError) return e.issues.map((i) => i.field);
    throw e;
  }
};

describe('parseStrategySpec', () => {
  it('accepts an empty spec: inferred class, no goal, no fees', () => {
    expect(parseStrategySpec({}, ctx)).toEqual(EMPTY_STRATEGY_SPEC);
  });

  it('accepts a full, supportable spec', () => {
    const spec = parseStrategySpec(
      {
        ttmsAccountId: '7522417104012722196',
        reportClassOverride: 'brand',
        goal: { kind: 'rank', stage: 'consideration', value: 25, deadline: '2026-12-31' },
        creatorFeeMonthly: 12_000_000,
      },
      ctx,
    );
    expect(spec.goal).toEqual({ kind: 'rank', stage: 'consideration', metric: null, value: 25, deadline: '2026-12-31' });
  });

  it('refuses goals the data cannot measure (P0 corrections)', () => {
    // No daily Conversion flow → no cost per new Conversion (P0 §6.3).
    expect(issues({ goal: { kind: 'cost_per_new', stage: 'conversion', value: 150_000, deadline: '2026-12-31' } })).toEqual([
      'goal.stage',
    ]);
    // A size ratio is defined from Awareness and from Consideration only.
    expect(issues({ goal: { kind: 'size_ratio', stage: 'conversion', value: 0.1, deadline: '2026-12-31' } })).toEqual([
      'goal.stage',
    ]);
    // NSR has no vertical share.
    expect(issues({ goal: { kind: 'share', metric: 'nsr', value: 0.1, deadline: '2026-12-31' } })).toEqual(['goal.metric']);
  });

  it('checks values, the deadline and account ownership', () => {
    expect(issues({ goal: { kind: 'rank', stage: 'awareness', value: 2.5, deadline: '2026-12-31' } })).toEqual(['goal.value']);
    expect(issues({ goal: { kind: 'share', metric: 'impressions', value: 1.5, deadline: '2026-12-31' } })).toEqual([
      'goal.value',
    ]);
    expect(issues({ goal: { kind: 'rank', stage: 'awareness', value: 10, deadline: '2026-10-21' } })).toEqual([
      'goal.deadline',
    ]);
    expect(issues({ ttmsAccountId: 'someone-else' })).toEqual(['ttmsAccountId']);
  });

  it('reports a malformed payload as a ZodError (400), not a 422', () => {
    expect(() => parseStrategySpec({ reportClassOverride: 'luxury' }, ctx)).toThrow(ZodError);
    expect(() => parseStrategySpec({ creatorFeeMonthly: -1 }, ctx)).toThrow(ZodError);
  });

  it('round-trips through the flat row shape', () => {
    const spec = parseStrategySpec(
      { goal: { kind: 'share', metric: 'impressions', value: 0.02, deadline: '2027-01-31' }, bgcCostMonthly: 3_000_000 },
      ctx,
    );
    expect(strategySpecFromRow(strategySpecToRow(spec))).toEqual(spec);
  });
});
