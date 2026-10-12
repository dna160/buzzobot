import type { Status, HealthLabel, ProductRecommendation, CreativeStatus } from './rubric.js';
import type { SourceBreakdownModel } from './breakdown.js';
import type { LegendGroup } from './legend.js';
import type { ReportPeriodInfo } from './period.js';
import type { FunnelPlanRow, RecommendationRow } from './recommendations.js';

export type { SourceBreakdownModel, SourceBreakdownRow, SourceBreakdownSummaryRow } from './breakdown.js';
export type { LegendGroup, LegendEntry } from './legend.js';
export type { ReportPeriodInfo } from './period.js';
export type { FunnelPlanRow, RecommendationRow, Priority } from './recommendations.js';

export interface TemplateReportAreaRow {
  /** Stable id, used to pick the risk wording. */
  key: string;
  area: string;
  /** "2/3 metrik baik, 1/3 perlu perbaikan" */
  kondisi: string;
  status: Status;
  /** What is on target in this area. */
  working: string;
  /** What is not, worst first, with the number behind it. */
  improve: string;
}

export interface TemplateReportFunnelRow {
  stage: 'Awareness (TOF)' | 'Consideration (MOF)' | 'Conversion (BOF)';
  objectiveLabel: string;
  budget: string;
  pct: string;
  benchmarkLabel: string;
  status: Status;
}

export interface TemplateReportBenchmarkRow {
  metric: string;
  actual: string;
  benchmark: string;
  gap: string;
  status: Status;
  /** false when there is no benchmark or no actual to judge against — shown as "—", excluded from area scoring. Default true. */
  scored?: boolean;
}

export interface TemplateReportTrendRow {
  metric: string;
  l30: string;
  l60_30: string;
  growth: string;
  insight: string;
}

export interface TemplateReportProductRow {
  produk: string;
  gmv: string;
  orders: string;
  roi: string;
  pctKontribusi: string;
  rekomendasi: ProductRecommendation;
}

export interface TemplateReportCreativeRow {
  creative: string;
  format: string;
  cost: string;
  ctrRoi: string;
  status: CreativeStatus;
  catatan: string;
}

export interface TemplateReportRiskRow {
  risiko: string;
  level: 'Low' | 'Medium' | 'High';
  /** The numbers that put this area at risk. */
  bukti: string;
  /** What happens if it is left alone. */
  dampak: string;
}

/** The "Rekomendasi Next Steps" section: prioritized actions plus the proposed next-period funnel split. */
export interface TemplateReportRecommendations {
  rows: RecommendationRow[];
  funnelPlan: FunnelPlanRow[];
  funnelPlanNote: string;
}

export interface TemplateReportOutlookRow {
  metric: string;
  current: string;
  target: string;
  strategy: string;
}

/** The fully-computed, ready-to-render report — no DB/clock access, same rule as `DeckModel`. */
export interface TemplateReportModel {
  clientName: string;
  brandColor: string;
  periodLabel: string;
  /** Header block: exact period, comparison period, scope — so a reader knows precisely what they are looking at. */
  period: ReportPeriodInfo;
  /**
   * What §2/§3 are graded against — printed so a reader never mistakes a
   * period-over-period comparison for an industry target (or vice versa).
   */
  benchmarkSource: { mode: 'industry' | 'previous_period'; label: string };
  /** Real TikTok ad account id(s) this report's numbers came from — printed so an AM can verify it against the real account before sending. */
  adAccountIds: string[];
  kpis: {
    /** TTAM (reach-based ads) north star: spend, reach, engagement. */
    ttam: {
      spend: string;
      spendDelta: string;
      reach: string;
      reachDelta: string;
      engagement: string;
      engagementDelta: string;
    };
    /** GMV Max (conversion-based ads) north star: spend, revenue, ROI/ROAS. */
    gmvMax: {
      spend: string;
      spendDelta: string;
      revenue: string;
      revenueDelta: string;
      roi: string;
      roiDelta: string;
      roiTarget: string;
    };
    /** TTAM + GMV Max combined: total spend, blended CPM, blended ROI/ROAS. */
    total: {
      spend: string;
      spendDelta: string;
      cpm: string;
      cpmDelta: string;
      roi: string;
      roiDelta: string;
    };
    /** Same overall score shown in each of the 3 card groups above. */
    healthScore: HealthLabel;
  };
  areaRows: TemplateReportAreaRow[];
  execNarrative: string;
  funnelRows: TemplateReportFunnelRow[];
  funnelInsight: string;
  benchmarkSections: { title: string; rows: TemplateReportBenchmarkRow[] }[];
  efficiencyInsight: string;
  trendRows: TemplateReportTrendRow[];
  trendInsight: string;
  /** Top/bottom ROI sources, shown right under the trend table. */
  roiBreakdown: SourceBreakdownModel;
  roiInsight: string;
  productRows: TemplateReportProductRow[];
  productInsight: string;
  creativeRows: TemplateReportCreativeRow[];
  creativeInsight: string;
  risks: TemplateReportRiskRow[];
  recommendations: TemplateReportRecommendations;
  recommendationInsight: string;
  outlook: TemplateReportOutlookRow[];
  /** Appendix: definitions of every term used in this report. */
  legend: LegendGroup[];
}
