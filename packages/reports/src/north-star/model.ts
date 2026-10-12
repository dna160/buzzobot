import type {
  LegendGroup,
  ReportPeriodInfo,
  SourceBreakdownModel,
  TemplateReportAreaRow,
  TemplateReportBenchmarkRow,
  TemplateReportFunnelRow,
  TemplateReportOutlookRow,
  TemplateReportRecommendations,
  TemplateReportRiskRow,
  TemplateReportTrendRow,
} from '../template-report/model.js';
import type { HealthLabel, Status } from '../template-report/rubric.js';

/**
 * Fully-computed model for the Awareness (`vtr`) and App Install
 * (`app_install`) Template Report variants. Same 8-section skeleton as the GMV
 * report (health check, funnel budget, benchmark tables, trend, top
 * campaigns, creatives, risks, outlook) with the content each north star
 * actually buys media for. Like every report model here it carries no
 * DB/clock access — the renderer reads only this.
 */

export interface NorthStarKpiTile {
  label: string;
  value: string;
  sub: string;
}

export interface NorthStarKpiGroup {
  title: string;
  tiles: NorthStarKpiTile[];
}

export interface NorthStarTable {
  headers: string[];
  rows: Array<{ cells: string[]; status?: Status }>;
  emptyNote: string;
}

export interface NorthStarReportModel {
  northStar: 'vtr' | 'app_install';
  reportTitle: string;
  /** e.g. "TTAM" — which delivery types the numbers cover. */
  coverage: string;
  clientName: string;
  brandColor: string;
  periodLabel: string;
  /** Header block: exact period, comparison period, scope. */
  period: ReportPeriodInfo;
  /** What §2/§3 are graded against — printed so a period-over-period comparison is never mistaken for an industry target. */
  benchmarkSource: { mode: 'industry' | 'previous_period'; label: string };
  adAccountIds: string[];
  kpiGroups: NorthStarKpiGroup[];
  healthScore: HealthLabel;
  areaRows: TemplateReportAreaRow[];
  execNarrative: string;
  funnelRows: TemplateReportFunnelRow[];
  funnelInsight: string;
  benchmarkSections: { title: string; rows: TemplateReportBenchmarkRow[] }[];
  efficiencyInsight: string;
  trendTitle: string;
  trendRows: TemplateReportTrendRow[];
  trendInsight: string;
  /** Best/worst campaigns on the template's headline efficiency, shown under the trend table. */
  sourceBreakdown: SourceBreakdownModel;
  sourceInsight: string;
  campaignTitle: string;
  campaignTable: NorthStarTable;
  campaignInsight: string;
  creativeTitle: string;
  creativeTable: NorthStarTable;
  creativeInsight: string;
  risks: TemplateReportRiskRow[];
  recommendations: TemplateReportRecommendations;
  recommendationInsight: string;
  outlook: TemplateReportOutlookRow[];
  legend: LegendGroup[];
}
