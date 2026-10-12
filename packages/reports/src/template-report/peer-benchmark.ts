import type {
  TemplateReportPeriodTotals,
  TemplateReportGmvMaxTotals,
  TemplateReportCampaignRow,
} from '@tempo/db';
import { classifyFunnelStage, type FunnelStage } from './rubric.js';

/**
 * Pure functions shared between the Template Report's own §3/§4 math
 * (`apps/web/src/lib/template-report-pipeline.ts`) and the "populate from
 * industry peers" feature — one real, blended-TTAM+GMV-Max formula per
 * metric, used both to grade a client's own report and to build the peer
 * average it's graded against. No DB/LLM access here; callers hand in
 * already-fetched `TemplateReportRawData` fields.
 */

export interface PeerAccountMetrics {
  spend: number;
  cpm: number | null;
  ctr: number | null;
  vtr: number | null;
  cpc: number | null;
  cvr: number | null;
  cpa: number | null;
  roi: number | null;
  budgetPct: Record<FunnelStage, number> | null;
}

/** A few hundred thousand rupiah over the window is dead/test-account noise, not a real campaign. */
export const PEER_MATERIALITY_FLOOR = 10_000_000;

/** One account's blended metrics, or all-nulls if it has no real spend in the window. */
export function computePeerAccountMetrics(
  data: {
    current: TemplateReportPeriodTotals;
    currentGmvMax: TemplateReportGmvMaxTotals;
    campaigns: TemplateReportCampaignRow[];
  },
  materialityFloor: number = PEER_MATERIALITY_FLOOR,
): PeerAccountMetrics {
  const { current, currentGmvMax: gmv, campaigns } = data;
  const combinedSpend = current.spend + gmv.cost;
  const combinedRevenue = current.totalOnsiteShoppingValue + gmv.grossRevenue;
  const combinedOrders = current.onsiteShopping + gmv.orders;

  const empty: PeerAccountMetrics = {
    spend: combinedSpend,
    cpm: null,
    ctr: null,
    vtr: null,
    cpc: null,
    cvr: null,
    cpa: null,
    roi: null,
    budgetPct: null,
  };
  if (combinedSpend < materialityFloor) return empty;

  const spendByStage: Record<FunnelStage, number> = { awareness: 0, consideration: 0, conversion: 0 };
  for (const c of campaigns) {
    spendByStage[classifyFunnelStage(c.objectiveType)] += c.spend;
  }
  spendByStage.conversion += gmv.cost;
  const conversionSpend = spendByStage.conversion;
  const totalCampaignSpend = spendByStage.awareness + spendByStage.consideration + spendByStage.conversion || 1;

  return {
    spend: combinedSpend,
    cpm: current.impressions > 0 ? (current.spend / current.impressions) * 1000 : null,
    ctr: current.impressions > 0 ? current.clicks / current.impressions : null,
    vtr: current.impressions > 0 ? current.videoWatched6s / current.impressions : null,
    cpc: current.clicks > 0 ? current.spend / current.clicks : null,
    cvr: current.clicks > 0 ? combinedOrders / current.clicks : null,
    cpa: combinedOrders > 0 ? conversionSpend / combinedOrders : null,
    roi: combinedRevenue / combinedSpend,
    budgetPct: {
      awareness: spendByStage.awareness / totalCampaignSpend,
      consideration: spendByStage.consideration / totalCampaignSpend,
      conversion: spendByStage.conversion / totalCampaignSpend,
    },
  };
}

/** The shape the report pipeline grades against — a stored (industry) benchmark row, or one synthesized from a prior period. */
export interface BenchmarkTarget {
  objective: string;
  metric: string;
  targetValue: number;
  comparisonDirection: 'higher_is_better' | 'lower_is_better';
}

/**
 * "Previous period" benchmark mode: the report's own prior window, of equal
 * length and immediately preceding, becomes the target. Uses the exact same
 * blended TTAM+GMV Max formulas as the current period and the industry-peer
 * averages, so the comparison is like-for-like. A metric the prior window
 * couldn't compute (no impressions, no orders...) yields no target and shows
 * as "belum diatur", same as an unset industry benchmark. `cost_per_atc` has
 * no data source in either mode.
 */
export function previousPeriodBenchmarks(prior: PeerAccountMetrics): BenchmarkTarget[] {
  const rows: BenchmarkTarget[] = [];
  const add = (
    objective: string,
    metric: string,
    value: number | null,
    comparisonDirection: BenchmarkTarget['comparisonDirection'],
  ): void => {
    if (value !== null && Number.isFinite(value)) rows.push({ objective, metric, targetValue: value, comparisonDirection });
  };
  add('awareness', 'cpm', prior.cpm, 'lower_is_better');
  add('awareness', 'ctr', prior.ctr, 'higher_is_better');
  add('awareness', 'vtr', prior.vtr, 'higher_is_better');
  add('consideration', 'ctr', prior.ctr, 'higher_is_better');
  add('consideration', 'cpc', prior.cpc, 'lower_is_better');
  add('conversion', 'roi', prior.roi, 'higher_is_better');
  add('conversion', 'cvr', prior.cvr, 'higher_is_better');
  add('conversion', 'cpa', prior.cpa, 'lower_is_better');
  if (prior.budgetPct) {
    add('awareness', 'budget_pct', prior.budgetPct.awareness, 'higher_is_better');
    add('consideration', 'budget_pct', prior.budgetPct.consideration, 'higher_is_better');
    add('conversion', 'budget_pct', prior.budgetPct.conversion, 'higher_is_better');
  }
  return rows;
}

export interface AveragedPeerBenchmarks {
  cpm: { value: number; n: number } | null;
  ctr: { value: number; n: number } | null;
  vtr: { value: number; n: number } | null;
  cpc: { value: number; n: number } | null;
  cvr: { value: number; n: number } | null;
  cpa: { value: number; n: number } | null;
  roi: { value: number; n: number } | null;
  budgetPct: Record<FunnelStage, { value: number; n: number } | null>;
}

function averageIgnoringNulls(values: Array<number | null>): { value: number; n: number } | null {
  const real = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (real.length === 0) return null;
  return { value: real.reduce((a, b) => a + b, 0) / real.length, n: real.length };
}

/** Unweighted mean across accounts, per metric, each ignoring its own nulls independently. */
export function averagePeerMetrics(accounts: PeerAccountMetrics[]): AveragedPeerBenchmarks {
  return {
    cpm: averageIgnoringNulls(accounts.map((a) => a.cpm)),
    ctr: averageIgnoringNulls(accounts.map((a) => a.ctr)),
    vtr: averageIgnoringNulls(accounts.map((a) => a.vtr)),
    cpc: averageIgnoringNulls(accounts.map((a) => a.cpc)),
    cvr: averageIgnoringNulls(accounts.map((a) => a.cvr)),
    cpa: averageIgnoringNulls(accounts.map((a) => a.cpa)),
    roi: averageIgnoringNulls(accounts.map((a) => a.roi)),
    budgetPct: {
      awareness: averageIgnoringNulls(accounts.map((a) => a.budgetPct?.awareness ?? null)),
      consideration: averageIgnoringNulls(accounts.map((a) => a.budgetPct?.consideration ?? null)),
      conversion: averageIgnoringNulls(accounts.map((a) => a.budgetPct?.conversion ?? null)),
    },
  };
}
