import type { NorthStar } from './enums.js';

/**
 * The Template Report's benchmark grid, per north star — pure data (keys,
 * labels, which direction is "good", how to format) with no compute logic, so
 * the benchmark editor UI (client) and the report pipelines (server) agree on
 * exactly one definition. The per-metric formulas live in `@tempo/reports`,
 * keyed by `${objective}:${metric}`.
 *
 * `objective` is the benchmark table's section key. `shop` keeps the original
 * funnel-stage keys (awareness/consideration/conversion) so every benchmark
 * already saved keeps working; the other north stars use their own section keys.
 * Funnel budget ideals (`metric: 'budget_pct'`, one per funnel stage) are the
 * same for every north star and are handled separately from this grid.
 */

export type MetricKind = 'money' | 'count' | 'percent' | 'decimal' | 'seconds';
export type BenchmarkDirection = 'higher_is_better' | 'lower_is_better';

export interface BenchmarkMetricDef {
  objective: string;
  metric: string;
  label: string;
  direction: BenchmarkDirection;
  kind: MetricKind;
}

export interface BenchmarkSectionDef {
  objective: string;
  title: string;
  metrics: BenchmarkMetricDef[];
}

const m = (
  objective: string,
  metric: string,
  label: string,
  direction: BenchmarkDirection,
  kind: MetricKind,
): BenchmarkMetricDef => ({ objective, metric, label, direction, kind });

export const BENCHMARK_LAYOUT: Record<NorthStar, BenchmarkSectionDef[]> = {
  shop: [
    {
      objective: 'awareness',
      title: 'Awareness',
      metrics: [
        m('awareness', 'cpm', 'CPM', 'lower_is_better', 'money'),
        m('awareness', 'ctr', 'CTR', 'higher_is_better', 'percent'),
        m('awareness', 'vtr', 'VTR (6s)', 'higher_is_better', 'percent'),
      ],
    },
    {
      objective: 'consideration',
      title: 'Consideration',
      metrics: [
        m('consideration', 'ctr', 'CTR', 'higher_is_better', 'percent'),
        m('consideration', 'cpc', 'Cost per Click (CPC)', 'lower_is_better', 'money'),
        m('consideration', 'cost_per_atc', 'Cost per Add to Cart', 'lower_is_better', 'money'),
      ],
    },
    {
      objective: 'conversion',
      title: 'Conversion',
      metrics: [
        m('conversion', 'roi', 'ROI', 'higher_is_better', 'decimal'),
        m('conversion', 'cvr', 'CVR', 'higher_is_better', 'percent'),
        m('conversion', 'cpa', 'Cost per Order (CPA)', 'lower_is_better', 'money'),
      ],
    },
  ],
  vtr: [
    {
      objective: 'delivery',
      title: 'Delivery & Efisiensi Jangkauan',
      metrics: [
        m('delivery', 'cpm', 'CPM', 'lower_is_better', 'money'),
        m('delivery', 'cpmr', 'Cost per 1.000 Reach', 'lower_is_better', 'money'),
        m('delivery', 'frequency', 'Frequency', 'lower_is_better', 'decimal'),
      ],
    },
    {
      objective: 'retention',
      title: 'Video Retention',
      metrics: [
        m('retention', 'vtr_6s', 'VTR (6s)', 'higher_is_better', 'percent'),
        m('retention', 'view_rate_2s', '2s View Rate', 'higher_is_better', 'percent'),
        m('retention', 'completion_p50', 'Completion 50%', 'higher_is_better', 'percent'),
        m('retention', 'completion_p100', 'Completion 100%', 'higher_is_better', 'percent'),
        m('retention', 'avg_play', 'Rata-rata Durasi Tonton', 'higher_is_better', 'seconds'),
      ],
    },
    {
      objective: 'engagement',
      title: 'Engagement',
      metrics: [
        m('engagement', 'ctr', 'CTR', 'higher_is_better', 'percent'),
        m('engagement', 'engagement_rate', 'Engagement Rate', 'higher_is_better', 'percent'),
        m('engagement', 'profile_visit_rate', 'Profile Visit Rate', 'higher_is_better', 'percent'),
        m('engagement', 'cost_per_engagement', 'Cost per Engagement', 'lower_is_better', 'money'),
      ],
    },
  ],
  app_install: [
    {
      objective: 'delivery',
      title: 'Delivery & Traffic',
      metrics: [
        m('delivery', 'cpm', 'CPM', 'lower_is_better', 'money'),
        m('delivery', 'ctr', 'CTR', 'higher_is_better', 'percent'),
        m('delivery', 'cpc', 'Cost per Click (CPC)', 'lower_is_better', 'money'),
      ],
    },
    {
      objective: 'install',
      title: 'Efisiensi Install',
      metrics: [
        m('install', 'cpi', 'Cost per Install (CPI)', 'lower_is_better', 'money'),
        m('install', 'install_rate', 'Install Rate (Install / Klik)', 'higher_is_better', 'percent'),
        m('install', 'installs_per_1k', 'Install per 1.000 Impresi', 'higher_is_better', 'decimal'),
      ],
    },
    {
      objective: 'quality',
      title: 'Kualitas Pasca-Install',
      metrics: [
        m('quality', 'registration_rate', 'Registration Rate (Registrasi / Install)', 'higher_is_better', 'percent'),
        m('quality', 'cost_per_registration', 'Cost per Registration', 'lower_is_better', 'money'),
      ],
    },
  ],
};

export const FUNNEL_STAGES = ['awareness', 'consideration', 'conversion'] as const;

/** Human label for a north star's report — used for the template name in the UI and the PDF title. */
export const TEMPLATE_LABEL: Record<NorthStar, string> = {
  shop: 'GMV / TikTok Shop',
  vtr: 'Awareness',
  app_install: 'App Install',
};
