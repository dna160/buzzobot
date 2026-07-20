import type { DataSurface } from '../domain/enums.js';

/**
 * The metric catalog is the contract between analytics and presentation.
 * A KPI tile, a chart axis, or a table column references a MetricKey here and
 * inherits its label, formatting, and "which direction is good" — so those
 * decisions live in exactly one place.
 */

export type MetricFormat = 'currency' | 'number' | 'percent' | 'duration' | 'ratio';

/** For deltas: is an increase good (up), bad (down), or neutral? */
export type MetricDirection = 'up' | 'down' | 'neutral';

export interface MetricDef {
  key: MetricKey;
  label: string;
  shortLabel: string;
  surface: DataSurface;
  format: MetricFormat;
  /** Whether a positive delta is favorable — drives the green/red coloring. */
  goodDirection: MetricDirection;
  description: string;
  /** Fraction digits for display; defaults applied by the formatter. */
  precision?: number;
}

export type MetricKey =
  // Paid
  | 'spend'
  | 'impressions'
  | 'clicks'
  | 'conversions'
  | 'conversionValue'
  | 'ctr'
  | 'cpm'
  | 'cpc'
  | 'cpa'
  | 'conversionRate'
  | 'roas'
  // Organic
  | 'views'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'reach'
  | 'newFollowers'
  | 'engagementRate'
  | 'avgWatchTimeSec';

export const METRICS: Record<MetricKey, MetricDef> = {
  spend: {
    key: 'spend',
    label: 'Ad Spend',
    shortLabel: 'Spend',
    surface: 'paid',
    format: 'currency',
    goodDirection: 'neutral',
    description: 'Total amount invested across paid campaigns.',
  },
  impressions: {
    key: 'impressions',
    label: 'Impressions',
    shortLabel: 'Impr.',
    surface: 'paid',
    format: 'number',
    goodDirection: 'up',
    description: 'Number of times ads were served.',
  },
  clicks: {
    key: 'clicks',
    label: 'Clicks',
    shortLabel: 'Clicks',
    surface: 'paid',
    format: 'number',
    goodDirection: 'up',
    description: 'Total clicks driven by paid campaigns.',
  },
  conversions: {
    key: 'conversions',
    label: 'Conversions',
    shortLabel: 'Conv.',
    surface: 'paid',
    format: 'number',
    goodDirection: 'up',
    description: 'Completed conversion events attributed to ads.',
  },
  conversionValue: {
    key: 'conversionValue',
    label: 'Conversion Value',
    shortLabel: 'Conv. Value',
    surface: 'paid',
    format: 'currency',
    goodDirection: 'up',
    description: 'Total revenue attributed to converting clicks.',
  },
  ctr: {
    key: 'ctr',
    label: 'Click-Through Rate',
    shortLabel: 'CTR',
    surface: 'paid',
    format: 'percent',
    goodDirection: 'up',
    description: 'Clicks divided by impressions.',
    precision: 2,
  },
  cpm: {
    key: 'cpm',
    label: 'Cost per 1K Impressions',
    shortLabel: 'CPM',
    surface: 'paid',
    format: 'currency',
    goodDirection: 'down',
    description: 'Spend per one thousand impressions.',
  },
  cpc: {
    key: 'cpc',
    label: 'Cost per Click',
    shortLabel: 'CPC',
    surface: 'paid',
    format: 'currency',
    goodDirection: 'down',
    description: 'Average cost of a single click.',
    precision: 2,
  },
  cpa: {
    key: 'cpa',
    label: 'Cost per Acquisition',
    shortLabel: 'CPA',
    surface: 'paid',
    format: 'currency',
    goodDirection: 'down',
    description: 'Spend divided by conversions.',
    precision: 2,
  },
  conversionRate: {
    key: 'conversionRate',
    label: 'Conversion Rate',
    shortLabel: 'CVR',
    surface: 'paid',
    format: 'percent',
    goodDirection: 'up',
    description: 'Conversions divided by clicks.',
    precision: 2,
  },
  roas: {
    key: 'roas',
    label: 'Return on Ad Spend',
    shortLabel: 'ROAS',
    surface: 'paid',
    format: 'ratio',
    goodDirection: 'up',
    description: 'Conversion value divided by spend.',
    precision: 2,
  },
  views: {
    key: 'views',
    label: 'Video Views',
    shortLabel: 'Views',
    surface: 'organic',
    format: 'number',
    goodDirection: 'up',
    description: 'Total organic video views.',
  },
  likes: {
    key: 'likes',
    label: 'Likes',
    shortLabel: 'Likes',
    surface: 'organic',
    format: 'number',
    goodDirection: 'up',
    description: 'Total likes on organic content.',
  },
  comments: {
    key: 'comments',
    label: 'Comments',
    shortLabel: 'Comments',
    surface: 'organic',
    format: 'number',
    goodDirection: 'up',
    description: 'Total comments on organic content.',
  },
  shares: {
    key: 'shares',
    label: 'Shares',
    shortLabel: 'Shares',
    surface: 'organic',
    format: 'number',
    goodDirection: 'up',
    description: 'Total shares of organic content.',
  },
  reach: {
    key: 'reach',
    label: 'Reach',
    shortLabel: 'Reach',
    surface: 'organic',
    format: 'number',
    goodDirection: 'up',
    description: 'Unique accounts that saw the content.',
  },
  newFollowers: {
    key: 'newFollowers',
    label: 'New Followers',
    shortLabel: 'Followers',
    surface: 'organic',
    format: 'number',
    goodDirection: 'up',
    description: 'Net new followers gained in the period.',
  },
  engagementRate: {
    key: 'engagementRate',
    label: 'Engagement Rate',
    shortLabel: 'Eng. Rate',
    surface: 'organic',
    format: 'percent',
    goodDirection: 'up',
    description: '(Likes + comments + shares) divided by views.',
    precision: 2,
  },
  avgWatchTimeSec: {
    key: 'avgWatchTimeSec',
    label: 'Avg. Watch Time',
    shortLabel: 'Watch Time',
    surface: 'organic',
    format: 'duration',
    goodDirection: 'up',
    description: 'Average seconds watched per view.',
    precision: 1,
  },
};

export const metricsBySurface = (surface: DataSurface): MetricDef[] =>
  Object.values(METRICS).filter((m) => m.surface === surface);
