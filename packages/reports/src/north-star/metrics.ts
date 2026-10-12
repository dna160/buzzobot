import { BENCHMARK_LAYOUT, type NorthStar } from '@tempo/core';
import type { NorthStarCampaignRow, NorthStarTotals } from '@tempo/db';
import { classifyFunnelStage, FUNNEL_BENCHMARK_RANGE, type FunnelStage } from '../template-report/rubric.js';
import type { BenchmarkTarget } from '../template-report/peer-benchmark.js';

/**
 * Metric formulas for the Awareness (`vtr`) and App Install (`app_install`)
 * reports, keyed by `${objective}:${metric}` to match `BENCHMARK_LAYOUT` in
 * `@tempo/core`. One formula each, shared by the client's own report, the
 * previous-period benchmark, and the industry-peer average — so the target and
 * the actual can never be computed two different ways.
 *
 * Rates built on a sparse numerator (installs, registrations, follows,
 * profile visits) return `null` when that numerator is zero rather than a
 * misleading 0: an account that doesn't track the event isn't "0% good".
 */

type Compute = (t: NorthStarTotals) => number | null;

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);
const sparseRatio = (num: number, den: number): number | null => (num > 0 && den > 0 ? num / den : null);

const CPM: Compute = (t) => (t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null);

const COMPUTE: Record<string, Compute> = {
  // Awareness
  'delivery:cpm': CPM,
  'delivery:cpmr': (t) => (t.reach > 0 ? (t.spend / t.reach) * 1000 : null),
  'delivery:frequency': (t) => ratio(t.impressions, t.reach),
  'retention:vtr_6s': (t) => ratio(t.video6s, t.impressions),
  'retention:view_rate_2s': (t) => ratio(t.video2s, t.impressions),
  'retention:completion_p50': (t) => sparseRatio(t.videoP50, t.videoPlays),
  'retention:completion_p100': (t) => sparseRatio(t.videoP100, t.videoPlays),
  'retention:avg_play': (t) => (t.videoPlays > 0 && t.avgPlayWeighted > 0 ? t.avgPlayWeighted / t.videoPlays : null),
  'engagement:ctr': (t) => ratio(t.clicks, t.impressions),
  'engagement:engagement_rate': (t) => sparseRatio(t.engagements, t.impressions),
  'engagement:profile_visit_rate': (t) => sparseRatio(t.profileVisits, t.impressions),
  'engagement:cost_per_engagement': (t) => (t.engagements > 0 ? t.spend / t.engagements : null),
  // App install (`delivery:cpm` is shared with awareness)
  'delivery:ctr': (t) => ratio(t.clicks, t.impressions),
  'delivery:cpc': (t) => ratio(t.spend, t.clicks),
  'install:cpi': (t) => (t.installs > 0 ? t.spend / t.installs : null),
  'install:install_rate': (t) => sparseRatio(t.installs, t.clicks),
  'install:installs_per_1k': (t) => (t.installs > 0 && t.impressions > 0 ? (t.installs / t.impressions) * 1000 : null),
  'quality:registration_rate': (t) => sparseRatio(t.registrations, t.installs),
  'quality:cost_per_registration': (t) => (t.registrations > 0 ? t.spend / t.registrations : null),
};

/** The formula for one benchmark metric, or undefined for a key this north star doesn't compute (e.g. shop's `cost_per_atc`). */
export function northStarMetricValue(objective: string, metric: string, totals: NorthStarTotals): number | null {
  const fn = COMPUTE[`${objective}:${metric}`];
  return fn ? fn(totals) : null;
}

/**
 * Default funnel-budget ideal ranges when a client has no saved `budget_pct`
 * benchmark. Generic strategic starting points per north star — an Awareness
 * account is expected to be top-of-funnel heavy, an Install account bottom-
 * heavy — not claims about any real account. Peer averages and the previous
 * period override these per client.
 */
export function defaultFunnelRanges(northStar: NorthStar): Record<FunnelStage, [number, number]> {
  if (northStar === 'vtr') {
    return { awareness: [0.5, 0.7], consideration: [0.2, 0.3], conversion: [0.05, 0.2] };
  }
  if (northStar === 'app_install') {
    return { awareness: [0.1, 0.25], consideration: [0.1, 0.25], conversion: [0.55, 0.75] };
  }
  return FUNNEL_BENCHMARK_RANGE;
}

/** TTAM spend split into funnel stages by TikTok's own `objective_type`. */
export function spendByFunnelStage(campaigns: NorthStarCampaignRow[]): Record<FunnelStage, number> {
  const out: Record<FunnelStage, number> = { awareness: 0, consideration: 0, conversion: 0 };
  for (const c of campaigns) out[classifyFunnelStage(c.objectiveType)] += c.spend;
  return out;
}

export function funnelPctFromSpend(spend: Record<FunnelStage, number>): Record<FunnelStage, number> {
  const total = spend.awareness + spend.consideration + spend.conversion || 1;
  return {
    awareness: spend.awareness / total,
    consideration: spend.consideration / total,
    conversion: spend.conversion / total,
  };
}

export interface NorthStarPeerMetrics {
  spend: number;
  /** `${objective}:${metric}` → value, or null when it can't be computed for this account. */
  values: Record<string, number | null>;
  budgetPct: Record<FunnelStage, number> | null;
}

/** One account/window's metrics, or all-null when it has no real spend (below `materialityFloor`). */
export function computeNorthStarMetrics(
  northStar: NorthStar,
  data: { totals: NorthStarTotals; campaigns: NorthStarCampaignRow[] },
  materialityFloor: number,
): NorthStarPeerMetrics {
  const values: Record<string, number | null> = {};
  for (const section of BENCHMARK_LAYOUT[northStar]) {
    for (const def of section.metrics) values[`${def.objective}:${def.metric}`] = null;
  }
  if (data.totals.spend < materialityFloor) return { spend: data.totals.spend, values, budgetPct: null };
  for (const section of BENCHMARK_LAYOUT[northStar]) {
    for (const def of section.metrics) {
      values[`${def.objective}:${def.metric}`] = northStarMetricValue(def.objective, def.metric, data.totals);
    }
  }
  return { spend: data.totals.spend, values, budgetPct: funnelPctFromSpend(spendByFunnelStage(data.campaigns)) };
}

export interface AveragedBenchmarkEntry {
  objective: string;
  metric: string;
  value: number;
  /** How many accounts had a real value for this metric. */
  n: number;
}

/** Unweighted mean across accounts, per metric, each ignoring its own nulls independently. */
export function averageNorthStarPeers(northStar: NorthStar, accounts: NorthStarPeerMetrics[]): AveragedBenchmarkEntry[] {
  const out: AveragedBenchmarkEntry[] = [];
  const mean = (objective: string, metric: string, values: Array<number | null | undefined>): void => {
    const real = values.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
    if (real.length > 0) out.push({ objective, metric, value: real.reduce((a, b) => a + b, 0) / real.length, n: real.length });
  };
  for (const section of BENCHMARK_LAYOUT[northStar]) {
    for (const def of section.metrics) {
      mean(def.objective, def.metric, accounts.map((a) => a.values[`${def.objective}:${def.metric}`]));
    }
  }
  for (const stage of ['awareness', 'consideration', 'conversion'] as const) {
    mean(stage, 'budget_pct', accounts.map((a) => a.budgetPct?.[stage]));
  }
  return out;
}

/** "Previous period" mode for Awareness/Install: the prior window's own metrics become the targets. */
export function northStarPreviousPeriodBenchmarks(northStar: NorthStar, prior: NorthStarPeerMetrics): BenchmarkTarget[] {
  const rows: BenchmarkTarget[] = [];
  for (const section of BENCHMARK_LAYOUT[northStar]) {
    for (const def of section.metrics) {
      const value = prior.values[`${def.objective}:${def.metric}`];
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        rows.push({ objective: def.objective, metric: def.metric, targetValue: value, comparisonDirection: def.direction });
      }
    }
  }
  if (prior.budgetPct) {
    for (const stage of ['awareness', 'consideration', 'conversion'] as const) {
      rows.push({ objective: stage, metric: 'budget_pct', targetValue: prior.budgetPct[stage], comparisonDirection: 'higher_is_better' });
    }
  }
  return rows;
}
