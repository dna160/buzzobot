import type { BriefObjective, DataSurface } from '../domain/enums.js';

/**
 * The metric catalog is the contract between analytics and presentation.
 * A KPI tile, a chart axis, or a table column references a MetricKey here and
 * inherits its label, formatting, and "which direction is good" — so those
 * decisions live in exactly one place.
 */

export type MetricFormat = 'currency' | 'number' | 'percent' | 'duration' | 'ratio' | 'rank';

/** For deltas: is an increase good (up), bad (down), or neutral? */
export type MetricDirection = 'up' | 'down' | 'neutral';

/**
 * How the spec editor's metric palette groups a metric (Brief Deck PRD §3.4).
 * The dividing line: `biaya` is money out (spend and every cost-per), `hasil`
 * is countable outcome, `efisiensi` is a non-money ratio, `jangkauan` is who
 * saw it, `video` is how much of it they watched.
 */
export type MetricCategory = 'biaya' | 'hasil' | 'efisiensi' | 'video' | 'jangkauan';

/**
 * Grading thresholds for one objective. Read direction-aware: for a metric
 * whose `goodDirection` is `up`, green is `value >= green`; for `down`, green
 * is `value <= green`. `light()` in `@tempo/reports` owns that resolution and
 * is the only place it happens.
 *
 * Bands are deliberately sparse. A light printed to a client is a claim, and
 * inventing a threshold to fill a column is the same failure as inventing a
 * number — so a band exists here only where this codebase already commits to
 * one, and every other metric grades from a per-client `target` or not at all.
 */
export interface MetricBand {
  green: number;
  yellow: number;
}

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
  /**
   * The Bahasa label a client actually reads. Named `labelId` for the locale,
   * not for an identifier: it holds the string itself. Brief Deck PRD §3.4
   * makes this structural — **no renderer ever prints a `MetricKey`**, so this
   * is the only string that reaches a slide, and `catalog.test.ts` fails the
   * build if a pickable metric is missing one.
   */
  labelId: string;
  /** Palette grouping in the spec editor (M6). */
  category: MetricCategory;
  /** Objective-specific grading thresholds; absent means "grade from a target or not at all". */
  bands?: Partial<Record<BriefObjective, MetricBand>>;
  /**
   * Whether an account manager may put this metric on a deck. False here is
   * never a judgement about the metric's value — it means nothing can fill the
   * tile yet. The brief window reads the day-grain paid rollup
   * (`getDailyBriefDashboard`), so organic metrics have no value to show until
   * the organic read-model joins it (M4's video work).
   */
  pickerVisible: boolean;
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
  // Paid video & delivery — the intraday grain the brief window reports on.
  // These are the columns `paid_hourly_metrics` carries and the day-grain
  // rollup (`getDailyBriefDashboard`) already sums; the catalog was written
  // before that read-model existed, which is why a deck could not name them.
  | 'videoViews'
  | 'videoWatched6s'
  | 'engagedView15s'
  | 'engagements'
  | 'vtr6s'
  | 'vtr15s'
  | 'frequency'
  | 'cpv'
  // Organic
  | 'views'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'reach'
  | 'newFollowers'
  | 'engagementRate'
  | 'avgWatchTimeSec'
  // Market Scope (TTMS) — Strategy Report
  | MarketScopeMetricKey;

// ─── Market Scope (TTMS) ─────────────────────────────────────────────────────
//
// Strategy Report PRD §6.5, with the corrections from
// docs/phases/strategy-report/P0_DISCOVERY.md applied:
//  - `size_ratio`, not `move_on_rate`: TTMS stage totals are rolling-window
//    stocks, and Conversion can exceed Consideration (BDL 12.5×), so the ratio
//    of two stages is not a share of people moving on (P0 §6.2).
//  - no per-metric insight rank: the portal stores rank for audience stages
//    only; per-metric rank comes from a live call it never persists (P0 §2).
//  - no cost per new Conversion: Conversion-stage new/outflow is 0 every day
//    for 14 of 15 accounts (P0 §6.3).
//  - content-type shares are `neutral`: a bigger slice of a mix is neither good
//    nor bad by itself, and the sub-types overlap (P0 §6.6).
// Families are generated from the tables below so a stage or metric added
// later gets every key at once. Grading is benchmark-relative (`light()` with
// the benchmark as target), so none of these carries `bands`.

export const TTMS_STAGES = ['acc', 'awareness', 'consideration', 'conversion'] as const;
export type TtmsStageKey = (typeof TTMS_STAGES)[number];

export const TTMS_INSIGHT_METRICS = [
  'impressions',
  'engagements',
  'video_views_p100',
  'video_views_6s',
  'search_volume',
  'likes',
  'comments',
  'shares',
  'clicks',
  'product_card_clicks',
  'nsr',
] as const;
export type TtmsInsightMetricKey = (typeof TTMS_INSIGHT_METRICS)[number];

/** Content types below "all". Only `paid` + `non_paid` partition the total; the rest overlap. */
export const TTMS_CONTENT_TYPES = [
  'paid',
  'non_paid',
  'ads',
  'creator_boosted',
  'creator_organic',
  'bgc_boosted',
  'bgc_organic',
  'ugc_boosted',
  'ugc_organic',
] as const;
export type TtmsContentTypeKey = (typeof TTMS_CONTENT_TYPES)[number];

export type MarketScopeMetricKey =
  | `ttms.audience.${TtmsStageKey}.${'total' | 'new' | 'outflow' | 'rank'}`
  | 'ttms.audience.awareness.size_ratio'
  | 'ttms.audience.consideration.size_ratio'
  | `ttms.${TtmsInsightMetricKey}`
  | `ttms.${Exclude<TtmsInsightMetricKey, 'nsr'>}.share`
  | `ttms.impressions.share.${TtmsContentTypeKey}`
  | 'ttms.halo_ratio'
  | 'strategy.cost_per_1k_new.awareness'
  | 'strategy.cost_per_1k_new.consideration'
  | 'strategy.spend_cap_daily';

const STAGE_NAME: Record<TtmsStageKey, string> = {
  acc: 'ACC',
  awareness: 'Awareness',
  consideration: 'Consideration',
  conversion: 'Conversion',
};

const INSIGHT: Record<
  TtmsInsightMetricKey,
  { label: string; short: string; labelId: string; category: MetricCategory; format?: MetricFormat }
> = {
  impressions: { label: 'Brand Impressions', short: 'Impr.', labelId: 'Impresi konten merek', category: 'jangkauan' },
  engagements: { label: 'Brand Engagements', short: 'Eng.', labelId: 'Interaksi konten merek', category: 'hasil' },
  video_views_p100: { label: 'Brand Video Views (100%)', short: '100% Views', labelId: 'Tontonan penuh konten merek', category: 'video' },
  video_views_6s: { label: 'Brand Video Views (6s)', short: '6s Views', labelId: 'Tontonan 6 detik konten merek', category: 'video' },
  search_volume: { label: 'Brand Search Volume', short: 'Search', labelId: 'Volume pencarian merek', category: 'hasil' },
  likes: { label: 'Brand Likes', short: 'Likes', labelId: 'Suka konten merek', category: 'hasil' },
  comments: { label: 'Brand Comments', short: 'Comments', labelId: 'Komentar konten merek', category: 'hasil' },
  shares: { label: 'Brand Shares', short: 'Shares', labelId: 'Dibagikan konten merek', category: 'hasil' },
  clicks: { label: 'Brand Clicks', short: 'Clicks', labelId: 'Klik konten merek', category: 'hasil' },
  product_card_clicks: { label: 'Product Card Clicks', short: 'Card Clicks', labelId: 'Klik kartu produk', category: 'hasil' },
  nsr: { label: 'Net Sentiment Rate', short: 'NSR', labelId: 'Sentimen bersih', category: 'efisiensi', format: 'ratio' },
};

/** Approved Bahasa phrasings (Strategy Report PRD §5.4 rule 3). */
const CONTENT_TYPE: Record<TtmsContentTypeKey, { label: string; phrase: string }> = {
  paid: { label: 'Paid content', phrase: 'konten berbayar' },
  non_paid: { label: 'Non-paid content', phrase: 'konten non-berbayar' },
  ads: { label: 'Ads', phrase: 'iklan' },
  creator_boosted: { label: 'Creator content, boosted', phrase: 'video afiliasi/kreator yang di-boost' },
  creator_organic: { label: 'Creator content, organic', phrase: 'video afiliasi/kreator (organik)' },
  bgc_boosted: { label: 'Brand content, boosted', phrase: 'konten BGC internal yang di-boost' },
  bgc_organic: { label: 'Brand content, organic', phrase: 'konten BGC internal (organik)' },
  ugc_boosted: { label: 'User content, boosted', phrase: 'konten pengguna (UGC) yang di-boost' },
  ugc_organic: { label: 'User content, organic', phrase: 'konten pengguna (UGC) organik' },
};

const ttms = (
  key: MarketScopeMetricKey,
  def: Omit<MetricDef, 'key' | 'surface' | 'pickerVisible'>,
): [MarketScopeMetricKey, MetricDef] => [
  key,
  // Not pickable: the deck's brief window has no Market Scope read-model.
  { key, surface: 'market_scope', pickerVisible: false, ...def },
];

function buildMarketScopeMetrics(): Record<MarketScopeMetricKey, MetricDef> {
  const out: Array<[MarketScopeMetricKey, MetricDef]> = [];
  for (const s of TTMS_STAGES) {
    const n = STAGE_NAME[s];
    out.push(
      ttms(`ttms.audience.${s}.total`, {
        label: `${n} Audience`, shortLabel: n, format: 'number', goodDirection: 'up', category: 'jangkauan',
        labelId: `Audiens ${n}`,
        description: `People in the brand's ${n} stage on the day (TTMS, rolling window; a stock, not a flow).`,
      }),
      ttms(`ttms.audience.${s}.new`, {
        label: `New ${n} Audience`, shortLabel: `New ${n}`, format: 'number', goodDirection: 'up', category: 'jangkauan',
        labelId: `Audiens baru ${n}`,
        description: `People in the ${n} stage today but not yesterday, summed over the period.`,
      }),
      ttms(`ttms.audience.${s}.outflow`, {
        label: `${n} Outflow`, shortLabel: `${n} out`, format: 'number', goodDirection: 'down', category: 'jangkauan',
        labelId: `Audiens keluar ${n}`,
        description: `People in the ${n} stage yesterday but not today, summed over the period.`,
      }),
      ttms(`ttms.audience.${s}.rank`, {
        label: `${n} Rank`, shortLabel: 'Rank', format: 'rank', goodDirection: 'down', category: 'jangkauan',
        labelId: `Peringkat ${n}`,
        description: `Position in the TTMS ranking list for the ${n} stage (ties share a rank).`,
      }),
    );
  }
  out.push(
    ttms('ttms.audience.awareness.size_ratio', {
      label: 'Consideration ÷ Awareness Size', shortLabel: 'Cons./Aw.', format: 'percent', precision: 1,
      goodDirection: 'up', category: 'efisiensi', labelId: 'Ukuran Consideration dibanding Awareness',
      description: 'Consideration audience ÷ Awareness audience on the same day. A ratio of two stocks — never a share of people moving on.',
    }),
    ttms('ttms.audience.consideration.size_ratio', {
      label: 'Conversion ÷ Consideration Size', shortLabel: 'Conv./Cons.', format: 'percent', precision: 1,
      goodDirection: 'up', category: 'efisiensi', labelId: 'Ukuran Conversion dibanding Consideration',
      description: 'Conversion audience ÷ Consideration audience on the same day. Can exceed 100% — the stages use different windows.',
    }),
  );
  for (const m of TTMS_INSIGHT_METRICS) {
    const d = INSIGHT[m];
    out.push(
      ttms(`ttms.${m}`, {
        label: d.label, shortLabel: d.short, format: d.format ?? 'number', goodDirection: 'up', category: d.category,
        labelId: d.labelId, ...(m === 'nsr' ? { precision: 2 } : {}),
        description: `${d.label} on content mentioning the brand (TTMS brand insights, all content types).`,
      }),
    );
    if (m !== 'nsr') {
      out.push(
        ttms(`ttms.${m}.share`, {
          label: `${d.label} Share of Category`, shortLabel: `${d.short} share`, format: 'percent', precision: 2,
          goodDirection: 'up', category: 'efisiensi', labelId: `Pangsa kategori: ${d.labelId}`,
          description: `The brand's ${d.label.toLowerCase()} ÷ the whole vertical's, over the period.`,
        }),
      );
    }
  }
  for (const c of TTMS_CONTENT_TYPES) {
    const d = CONTENT_TYPE[c];
    out.push(
      ttms(`ttms.impressions.share.${c}`, {
        label: `Impressions Share: ${d.label}`, shortLabel: d.label, format: 'percent', precision: 1,
        goodDirection: 'neutral', category: 'jangkauan', labelId: `Porsi impresi dari ${d.phrase}`,
        description:
          `Impressions from ${d.label.toLowerCase()} ÷ all brand impressions. Only paid + non-paid add up to ` +
          '100%; the other content types overlap and are never summed or stacked.',
      }),
    );
  }
  out.push(
    ttms('ttms.halo_ratio', {
      label: 'Earned Halo', shortLabel: 'Halo', format: 'ratio', precision: 2, goodDirection: 'up',
      category: 'efisiensi', labelId: 'Impresi gratis per impresi berbayar',
      description: 'Non-paid impressions ÷ paid impressions on content mentioning the brand.',
    }),
    ttms('strategy.cost_per_1k_new.awareness', {
      label: 'Cost per 1K New Awareness', shortLabel: 'Cost/1K new Aw.', format: 'currency', goodDirection: 'down',
      category: 'biaya', labelId: 'Biaya per 1.000 audiens baru Awareness',
      description: 'Ad spend ÷ new Awareness audience × 1,000. TTMS "new" counts paid and organic entrants alike.',
    }),
    ttms('strategy.cost_per_1k_new.consideration', {
      label: 'Cost per 1K New Consideration', shortLabel: 'Cost/1K new Cons.', format: 'currency',
      goodDirection: 'down', category: 'biaya', labelId: 'Biaya per 1.000 audiens baru Consideration',
      description: 'Ad spend ÷ new Consideration audience × 1,000. TTMS "new" counts paid and organic entrants alike.',
    }),
    ttms('strategy.spend_cap_daily', {
      label: 'Suggested Daily Spend Cap', shortLabel: 'Daily cap', format: 'currency', goodDirection: 'neutral',
      category: 'biaya', labelId: 'Batas belanja harian',
      description: 'Daily spend above which new Consideration per rupiah falls off — shown only when the fit passes its gate.',
    }),
  );
  return Object.fromEntries(out) as Record<MarketScopeMetricKey, MetricDef>;
}

const MARKET_SCOPE_METRICS = buildMarketScopeMetrics();

export const METRICS: Record<MetricKey, MetricDef> = {
  spend: {
    key: 'spend',
    label: 'Ad Spend',
    shortLabel: 'Spend',
    surface: 'paid',
    format: 'currency',
    goodDirection: 'neutral',
    description: 'Total amount invested across paid campaigns.',
    labelId: 'Total Biaya Iklan',
    category: 'biaya',
    pickerVisible: true,
  },
  impressions: {
    key: 'impressions',
    label: 'Impressions',
    shortLabel: 'Impr.',
    surface: 'paid',
    format: 'number',
    goodDirection: 'up',
    description: 'Number of times ads were served.',
    labelId: 'Impresi',
    category: 'jangkauan',
    pickerVisible: true,
  },
  clicks: {
    key: 'clicks',
    label: 'Clicks',
    shortLabel: 'Clicks',
    surface: 'paid',
    format: 'number',
    goodDirection: 'up',
    description: 'Total clicks driven by paid campaigns.',
    labelId: 'Klik',
    category: 'hasil',
    pickerVisible: true,
  },
  conversions: {
    key: 'conversions',
    label: 'Conversions',
    shortLabel: 'Conv.',
    surface: 'paid',
    format: 'number',
    goodDirection: 'up',
    description: 'Completed conversion events attributed to ads.',
    labelId: 'Konversi',
    category: 'hasil',
    pickerVisible: true,
  },
  conversionValue: {
    key: 'conversionValue',
    label: 'Conversion Value',
    shortLabel: 'Conv. Value',
    surface: 'paid',
    format: 'currency',
    goodDirection: 'up',
    description: 'Total revenue attributed to converting clicks.',
    labelId: 'Nilai Konversi',
    category: 'hasil',
    pickerVisible: true,
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
    labelId: 'Rasio Klik (CTR)',
    category: 'efisiensi',
    pickerVisible: true,
  },
  cpm: {
    key: 'cpm',
    label: 'Cost per 1K Impressions',
    shortLabel: 'CPM',
    surface: 'paid',
    format: 'currency',
    goodDirection: 'down',
    description: 'Spend per one thousand impressions.',
    labelId: 'Biaya per 1.000 Impresi (CPM)',
    category: 'biaya',
    pickerVisible: true,
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
    labelId: 'Biaya per Klik (CPC)',
    category: 'biaya',
    pickerVisible: true,
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
    labelId: 'Biaya per Konversi (CPA)',
    category: 'biaya',
    pickerVisible: true,
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
    labelId: 'Rasio Konversi (CVR)',
    category: 'efisiensi',
    pickerVisible: true,
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
    labelId: 'Nilai Balik Belanja Iklan (ROAS)',
    category: 'efisiensi',
    // The one band this codebase already commits to: `insights.ts` has
    // scaled winners at ROAS >= 3 and reallocated laggards below 2x since
    // Phase 1.5. Reused rather than re-decided, so the deck's lights and the
    // action plan cannot disagree about what "good" means.
    bands: { gmv: { green: 3, yellow: 2 } },
    pickerVisible: true,
  },
  videoViews: {
    key: 'videoViews',
    label: 'Paid Video Views',
    shortLabel: 'Video Views',
    surface: 'paid',
    format: 'number',
    goodDirection: 'up',
    description: 'Video views delivered by paid campaigns (distinct from organic `views`).',
    labelId: 'Tontonan Video',
    category: 'video',
    pickerVisible: true,
  },
  videoWatched6s: {
    key: 'videoWatched6s',
    label: 'Video Views at 6s',
    shortLabel: '6s Views',
    surface: 'paid',
    format: 'number',
    goodDirection: 'up',
    description: 'Paid video views that reached six seconds.',
    labelId: 'Tontonan 6 Detik',
    category: 'video',
    pickerVisible: true,
  },
  engagedView15s: {
    key: 'engagedView15s',
    label: 'Engaged Views at 15s',
    shortLabel: '15s Views',
    surface: 'paid',
    format: 'number',
    goodDirection: 'up',
    description: 'Paid video views that reached fifteen seconds.',
    labelId: 'Tontonan 15 Detik',
    category: 'video',
    pickerVisible: true,
  },
  engagements: {
    key: 'engagements',
    label: 'Paid Engagements',
    shortLabel: 'Engagements',
    surface: 'paid',
    format: 'number',
    goodDirection: 'up',
    description: 'Interactions attributed to paid delivery.',
    labelId: 'Interaksi Berbayar',
    category: 'hasil',
    pickerVisible: true,
  },
  vtr6s: {
    key: 'vtr6s',
    label: 'View-Through Rate (6s)',
    shortLabel: 'VTR 6s',
    surface: 'paid',
    format: 'percent',
    goodDirection: 'up',
    description: 'Six-second video views divided by impressions.',
    labelId: 'VTR 6 Detik',
    category: 'video',
    precision: 2,
    pickerVisible: true,
  },
  vtr15s: {
    key: 'vtr15s',
    label: 'View-Through Rate (15s)',
    shortLabel: 'VTR 15s',
    surface: 'paid',
    format: 'percent',
    goodDirection: 'up',
    description: 'Fifteen-second engaged views divided by impressions.',
    labelId: 'VTR 15 Detik',
    category: 'video',
    precision: 2,
    pickerVisible: true,
  },
  frequency: {
    key: 'frequency',
    label: 'Frequency',
    shortLabel: 'Freq.',
    surface: 'paid',
    format: 'ratio',
    // Neither direction is good on its own: too low is under-saturation, too
    // high is fatigue (the engine's A01 generator flags both). A frequency
    // tile grades from a client target or not at all — never from a delta.
    goodDirection: 'neutral',
    description: 'Impressions divided by reach over the window.',
    labelId: 'Frekuensi',
    category: 'jangkauan',
    precision: 2,
    pickerVisible: true,
  },
  cpv: {
    key: 'cpv',
    label: 'Cost per Video View',
    shortLabel: 'CPV',
    surface: 'paid',
    format: 'currency',
    goodDirection: 'down',
    description: 'Spend divided by paid video views.',
    labelId: 'Biaya per Tontonan',
    category: 'biaya',
    precision: 2,
    pickerVisible: true,
  },
  views: {
    key: 'views',
    label: 'Video Views',
    shortLabel: 'Views',
    surface: 'organic',
    format: 'number',
    goodDirection: 'up',
    description: 'Total organic video views.',
    labelId: 'Tontonan Konten Organik',
    category: 'video',
    pickerVisible: false,
  },
  likes: {
    key: 'likes',
    label: 'Likes',
    shortLabel: 'Likes',
    surface: 'organic',
    format: 'number',
    goodDirection: 'up',
    description: 'Total likes on organic content.',
    labelId: 'Suka',
    category: 'hasil',
    pickerVisible: false,
  },
  comments: {
    key: 'comments',
    label: 'Comments',
    shortLabel: 'Comments',
    surface: 'organic',
    format: 'number',
    goodDirection: 'up',
    description: 'Total comments on organic content.',
    labelId: 'Komentar',
    category: 'hasil',
    pickerVisible: false,
  },
  shares: {
    key: 'shares',
    label: 'Shares',
    shortLabel: 'Shares',
    surface: 'organic',
    format: 'number',
    goodDirection: 'up',
    description: 'Total shares of organic content.',
    labelId: 'Dibagikan',
    category: 'hasil',
    pickerVisible: false,
  },
  reach: {
    key: 'reach',
    label: 'Reach',
    shortLabel: 'Reach',
    // The one key that exists on both surfaces. TikTok reports reach for paid
    // delivery too (`paid_hourly_metrics.reach`, which the brief window sums),
    // and the catalog models a single surface per key — kept as `organic`
    // because that is what it has always meant to the dashboard, rather than
    // splitting one client-facing word into two tiles nobody asked for.
    surface: 'organic',
    format: 'number',
    goodDirection: 'up',
    description:
      'Unique accounts that saw the content. Also reported for paid delivery, where the ' +
      'brief window sums it across hourly rows (not deduped — the accepted convention here).',
    labelId: 'Jangkauan',
    category: 'jangkauan',
    pickerVisible: true,
  },
  newFollowers: {
    key: 'newFollowers',
    label: 'New Followers',
    shortLabel: 'Followers',
    surface: 'organic',
    format: 'number',
    goodDirection: 'up',
    description: 'Net new followers gained in the period.',
    labelId: 'Pengikut Baru',
    category: 'hasil',
    pickerVisible: false,
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
    labelId: 'Rasio Interaksi',
    category: 'efisiensi',
    pickerVisible: false,
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
    labelId: 'Rata-rata Durasi Tonton',
    category: 'video',
    pickerVisible: false,
  },
  ...MARKET_SCOPE_METRICS,
};

export const metricsBySurface = (surface: DataSurface): MetricDef[] =>
  Object.values(METRICS).filter((m) => m.surface === surface);
