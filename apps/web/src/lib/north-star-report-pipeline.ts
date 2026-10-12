import type { ClientSummary, NorthStarCampaignRow, NorthStarCreativeRow, NorthStarRawData, NorthStarTotals } from '@tempo/db';
import {
  BENCHMARK_LAYOUT,
  formatDelta,
  formatPercent,
  TEMPLATE_LABEL,
  type BenchmarkMetricDef,
  type Currency,
  type MetricKind,
} from '@tempo/core';
import {
  buildLegend,
  buildPeriodInfo,
  buildRecommendations,
  buildRisks,
  buildSourceBreakdown,
  classifyFunnelStage,
  computeNorthStarMetrics,
  elaborateArea,
  shortName,
  type AreaItem,
  type PerformanceSource,
  type RecMetric,
  defaultFunnelRanges,
  funnelAllocationStatus,
  funnelPctFromSpend,
  funnelRangeFromTarget,
  growthPct,
  northStarMetricValue,
  northStarPreviousPeriodBenchmarks,
  overallHealthScore,
  spendByFunnelStage,
  type BenchmarkTarget,
  type FunnelStage,
  type NorthStarKpiGroup,
  type NorthStarReportModel,
  type ProductRecommendation,
  type Status,
} from '@tempo/reports';
import {
  benchmarkKey,
  benchmarkRow,
  formatCountCompact,
  formatRupiahCompact,
  growthItemStatus,
  inclusiveEndDate,
  rollupScored,
  rowsToAreaItems,
  todayInJakarta,
  type BenchmarkLookup,
  type BenchmarkMode,
} from './template-report-pipeline';

/**
 * Turns raw TTAM data + benchmark targets into a fully computed
 * `NorthStarReportModel` for the Awareness (`vtr`) and App Install
 * (`app_install`) templates — the counterpart of `template-report-pipeline.ts`
 * (the GMV report), same rules: every status comes from `@tempo/reports`'s
 * rubric, formulas live in one place (`north-star/metrics.ts`), and the
 * narrative layer later writes prose about numbers it is handed, never derives
 * one. Split into facts + assemble so the route can feed the LLM the
 * already-computed tables.
 */

export type NorthStarKey = 'vtr' | 'app_install';

export type NorthStarReportFacts = Omit<
  NorthStarReportModel,
  | 'execNarrative'
  | 'funnelInsight'
  | 'efficiencyInsight'
  | 'trendInsight'
  | 'sourceInsight'
  | 'campaignInsight'
  | 'creativeInsight'
  | 'recommendationInsight'
>;

export interface NorthStarNarratives {
  execNarrative: string;
  funnelInsight: string;
  efficiencyInsight: string;
  trendInsight: string;
  sourceInsight: string;
  campaignInsight: string;
  creativeInsight: string;
  recommendationInsight: string;
}

const sum = (rows: NorthStarCampaignRow[], pick: (r: NorthStarCampaignRow) => number): number =>
  rows.reduce((acc, r) => acc + pick(r), 0);

interface TrendDef {
  label: string;
  kind: MetricKind;
  /** 'up' = higher is an improvement, 'down' = lower is, 'neutral' = just a size change (spend). */
  better: 'up' | 'down' | 'neutral';
  value: (t: NorthStarTotals) => number | null;
}

const metric = (objective: string, key: string) => (t: NorthStarTotals) => northStarMetricValue(objective, key, t);

const TREND_DEFS: Record<NorthStarKey, TrendDef[]> = {
  vtr: [
    { label: 'Total Spend', kind: 'money', better: 'neutral', value: (t) => t.spend },
    { label: 'Reach', kind: 'count', better: 'up', value: (t) => t.reach },
    { label: 'Impressions', kind: 'count', better: 'up', value: (t) => t.impressions },
    { label: 'CPM', kind: 'money', better: 'down', value: metric('delivery', 'cpm') },
    { label: 'Cost per 1.000 Reach', kind: 'money', better: 'down', value: metric('delivery', 'cpmr') },
    { label: 'VTR (6s)', kind: 'percent', better: 'up', value: metric('retention', 'vtr_6s') },
    { label: 'Engagement Rate', kind: 'percent', better: 'up', value: metric('engagement', 'engagement_rate') },
  ],
  app_install: [
    { label: 'Total Spend', kind: 'money', better: 'neutral', value: (t) => t.spend },
    { label: 'Total Install', kind: 'count', better: 'up', value: (t) => (t.installs > 0 ? t.installs : null) },
    { label: 'Cost per Install (CPI)', kind: 'money', better: 'down', value: metric('install', 'cpi') },
    { label: 'Install Rate', kind: 'percent', better: 'up', value: metric('install', 'install_rate') },
    { label: 'Total Registrasi', kind: 'count', better: 'up', value: (t) => (t.registrations > 0 ? t.registrations : null) },
    { label: 'Cost per Registration', kind: 'money', better: 'down', value: metric('quality', 'cost_per_registration') },
    { label: 'Registration Rate', kind: 'percent', better: 'up', value: metric('quality', 'registration_rate') },
  ],
};

/** The two campaign-level metrics that decide Scale Up / Maintain / Optimize, per north star. */
interface Check {
  objective: string;
  metric: string;
  /** Campaign/creative value; null when it can't be computed. */
  value: number | null;
  /** true when higher is the good side. */
  higherIsBetter: boolean;
}

function checkPasses(check: Check, lookup: BenchmarkLookup): boolean | null {
  const bm = lookup.get(benchmarkKey(check.objective, check.metric));
  if (bm === undefined || check.value === null) return null;
  return check.higherIsBetter ? check.value >= bm.targetValue : check.value <= bm.targetValue;
}

function recommend(checks: Array<boolean | null>): ProductRecommendation {
  const known = checks.filter((c): c is boolean => c !== null);
  if (known.length === 0) return 'Watch';
  const ok = known.filter(Boolean).length;
  if (ok === known.length) return 'Scale Up';
  return ok > 0 ? 'Maintain' : 'Optimize';
}

function grade(checks: Array<boolean | null>): 'Winning' | 'Watch' | 'Underperform' {
  const known = checks.filter((c): c is boolean => c !== null);
  if (known.length === 0) return 'Watch';
  const ok = known.filter(Boolean).length;
  if (ok === known.length && known.length >= 2) return 'Winning';
  return ok > 0 ? 'Watch' : 'Underperform';
}

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export function computeNorthStarReportFacts(input: {
  client: ClientSummary;
  raw: NorthStarRawData;
  northStar: NorthStarKey;
  benchmarks: BenchmarkTarget[];
  benchmarkMode?: BenchmarkMode;
}): NorthStarReportFacts {
  const { client, raw, northStar } = input;
  const isAwareness = northStar === 'vtr';
  const benchmarkMode: BenchmarkMode = input.benchmarkMode ?? 'industry';

  // Previous-period mode: the prior window is scored with the same formulas as
  // the current one (floor of 1 rupiah, not the peer-noise floor — this is the
  // client's own real history).
  const benchmarks: BenchmarkTarget[] =
    benchmarkMode === 'previous_period'
      ? northStarPreviousPeriodBenchmarks(
          northStar,
          computeNorthStarMetrics(northStar, { totals: raw.prior, campaigns: raw.priorCampaigns }, 1),
        )
      : input.benchmarks;
  const benchmarkSource: NorthStarReportModel['benchmarkSource'] =
    benchmarkMode === 'previous_period'
      ? { mode: 'previous_period', label: `Periode sebelumnya (${raw.priorStart} – ${inclusiveEndDate(raw.priorEnd)})` }
      : { mode: 'industry', label: 'Target benchmark industri / yang ditetapkan AM' };
  const lookup: BenchmarkLookup = new Map(benchmarks.map((b) => [benchmarkKey(b.objective, b.metric), b]));

  const currency = client.currency as Currency;
  const currencySymbol = new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
    .format(0)
    .replace(/[\d.,\s]/g, '');
  const money = (v: number) => formatRupiahCompact(v, currencySymbol);
  const fmt = (kind: MetricKind, v: number): string => {
    switch (kind) {
      case 'money':
        return money(v);
      case 'count':
        return formatCountCompact(v);
      case 'percent':
        return formatPercent(v, 2);
      case 'seconds':
        return `${v.toFixed(1)}s`;
      default:
        return v.toFixed(2);
    }
  };
  const show = (kind: MetricKind, v: number | null): string => (v === null ? 'n/a' : fmt(kind, v));

  const cur = raw.current;
  const prior = raw.prior;
  const delta = (c: number | null, p: number | null): string =>
    c === null || p === null ? '—' : formatDelta(growthPct(c, p));
  const tile = (label: string, kind: MetricKind, value: (t: NorthStarTotals) => number | null) => ({
    label,
    value: show(kind, value(cur)),
    sub: `${delta(value(cur), value(prior))} vs periode sebelumnya`,
  });

  // --- §1 KPI cards ---------------------------------------------------------
  const kpiGroups: NorthStarKpiGroup[] = isAwareness
    ? [
        {
          title: 'Jangkauan · Reach & Frequency',
          tiles: [
            tile('Total Spend', 'money', (t) => t.spend),
            tile('Reach', 'count', (t) => t.reach),
            tile('Frequency', 'decimal', metric('delivery', 'frequency')),
          ],
        },
        {
          title: 'Efisiensi Delivery',
          tiles: [
            tile('Impressions', 'count', (t) => t.impressions),
            tile('CPM', 'money', metric('delivery', 'cpm')),
            tile('Cost per 1.000 Reach', 'money', metric('delivery', 'cpmr')),
          ],
        },
        {
          title: 'Kualitas View & Engagement',
          tiles: [
            tile('VTR (6s)', 'percent', metric('retention', 'vtr_6s')),
            tile('Rata-rata Durasi Tonton', 'seconds', metric('retention', 'avg_play')),
            tile('Engagement Rate', 'percent', metric('engagement', 'engagement_rate')),
          ],
        },
      ]
    : [
        {
          title: 'Delivery & Traffic',
          tiles: [
            tile('Total Spend', 'money', (t) => t.spend),
            tile('Impressions', 'count', (t) => t.impressions),
            tile('Klik', 'count', (t) => t.clicks),
          ],
        },
        {
          title: 'Install',
          tiles: [
            tile('Total Install', 'count', (t) => (t.installs > 0 ? t.installs : null)),
            tile('Cost per Install (CPI)', 'money', metric('install', 'cpi')),
            tile('Install Rate', 'percent', metric('install', 'install_rate')),
          ],
        },
        {
          title: 'Kualitas Pasca-Install',
          tiles: [
            tile('Total Registrasi', 'count', (t) => (t.registrations > 0 ? t.registrations : null)),
            tile('Cost per Registration', 'money', metric('quality', 'cost_per_registration')),
            tile('Registration Rate', 'percent', metric('quality', 'registration_rate')),
          ],
        },
      ];

  // --- §2 Funnel allocation -------------------------------------------------
  // Per-stage range: the client's own `budget_pct` benchmark (peer average or
  // previous period) when present, else this north star's generic default.
  const defaults = defaultFunnelRanges(northStar);
  const funnelRanges = Object.fromEntries(
    (['awareness', 'consideration', 'conversion'] as FunnelStage[]).map((stage) => {
      const bm = lookup.get(benchmarkKey(stage, 'budget_pct'));
      return [stage, bm ? funnelRangeFromTarget(bm.targetValue) : defaults[stage]];
    }),
  ) as Record<FunnelStage, [number, number]>;
  const spendByStage = spendByFunnelStage(raw.campaigns);
  const pctByStage = funnelPctFromSpend(spendByStage);
  const inRange = (stage: FunnelStage) => pctByStage[stage] >= funnelRanges[stage][0] && pctByStage[stage] <= funnelRanges[stage][1];
  const rangeLabel = (stage: FunnelStage) =>
    `${Math.round(funnelRanges[stage][0] * 100)}–${Math.round(funnelRanges[stage][1] * 100)}%`;
  const funnelStatus = funnelAllocationStatus(pctByStage, funnelRanges);
  const funnelRow = (
    stage: FunnelStage,
    label: NorthStarReportModel['funnelRows'][number]['stage'],
    objectiveLabel: string,
  ): NorthStarReportModel['funnelRows'][number] => ({
    stage: label,
    objectiveLabel,
    budget: money(spendByStage[stage]),
    pct: formatPercent(pctByStage[stage], 1),
    benchmarkLabel: rangeLabel(stage),
    status: inRange(stage) ? 'Baik' : 'Waspada',
  });
  const funnelRows: NorthStarReportModel['funnelRows'] = [
    funnelRow('awareness', 'Awareness (TOF)', 'Reach, Video Views'),
    funnelRow('consideration', 'Consideration (MOF)', 'Traffic, Engagement, Lead Generation'),
    funnelRow(
      'conversion',
      'Conversion (BOF)',
      isAwareness ? 'Conversions, Product Sales, App Promotion' : 'App Promotion / App Install, Conversions',
    ),
  ];

  // --- §3 Benchmark tables --------------------------------------------------
  const layout = BENCHMARK_LAYOUT[northStar];
  // Each row is also recorded as a recommendation input so §8 can turn weak
  // metrics into concrete next steps.
  const recMetrics: RecMetric[] = [];
  const benchmarkSections: NorthStarReportModel['benchmarkSections'] = layout.map((section) => ({
    title: section.title,
    rows: section.metrics.map((def: BenchmarkMetricDef) => {
      const row = benchmarkRow(
        lookup,
        def.objective,
        def.metric,
        def.label,
        northStarMetricValue(def.objective, def.metric, cur),
        (v) => fmt(def.kind, v),
      );
      recMetrics.push({
        key: `${def.objective}:${def.metric}`,
        label: def.label,
        section: section.title,
        status: row.status,
        scored: row.scored !== false,
        actual: row.actual,
        benchmark: row.benchmark,
        gap: row.gap,
        higherIsBetter: def.direction === 'higher_is_better',
      });
      return row;
    }),
  }));
  const sectionRowsOf = (objective: string) =>
    benchmarkSections[layout.findIndex((s) => s.objective === objective)]?.rows ?? [];
  // Metrics with no benchmark/actual don't count for or against an area.
  const sectionStatus = (objective: string): Status => rollupScored(sectionRowsOf(objective));

  // --- §4 Trend ---------------------------------------------------------------
  const trendDefs = TREND_DEFS[northStar];
  const trendRows: NorthStarReportModel['trendRows'] = trendDefs.map((def) => {
    const c = def.value(cur);
    const p = def.value(prior);
    const g = c === null || p === null ? null : growthPct(c, p);
    const up = (g ?? 0) >= 0;
    const insight =
      g === null
        ? '—'
        : def.better === 'neutral'
          ? up ? 'Naik' : 'Turun'
          : (def.better === 'up') === up
            ? 'Membaik'
            : 'Menurun';
    return { metric: def.label, l30: show(def.kind, c), l60_30: show(def.kind, p), growth: formatDelta(g), insight };
  });
  const directional = trendDefs
    .filter((d) => d.better !== 'neutral')
    .map((d) => {
      const c = d.value(cur);
      const p = d.value(prior);
      const g = c === null || p === null ? null : growthPct(c, p);
      return g === null ? null : (d.better === 'up') === (g >= 0);
    })
    .filter((v): v is boolean => v !== null);
  const worse = directional.filter((v) => !v).length;
  const trendStatus: Status =
    directional.length === 0 ? 'Waspada' : worse <= directional.length / 3 ? 'Baik' : worse >= (directional.length * 2) / 3 ? 'Kritis' : 'Waspada';

  // --- §5 Campaigns -----------------------------------------------------------
  const totalCampaignSpend = sum(raw.campaigns, (c) => c.spend) || 1;
  const topCampaigns = raw.campaigns.slice(0, 5);
  const campaignRows: NorthStarReportModel['campaignTable']['rows'] = topCampaigns.map((c) => {
    const share = formatPercent(c.spend / totalCampaignSpend, 1);
    if (isAwareness) {
      const cpm = c.impressions > 0 ? (c.spend / c.impressions) * 1000 : null;
      const vtr = ratio(c.video6s, c.impressions);
      const rec = recommend([
        checkPasses({ objective: 'delivery', metric: 'cpm', value: cpm, higherIsBetter: false }, lookup),
        checkPasses({ objective: 'retention', metric: 'vtr_6s', value: vtr, higherIsBetter: true }, lookup),
      ]);
      return {
        cells: [c.campaignName, money(c.spend), formatCountCompact(c.reach), show('decimal', ratio(c.impressions, c.reach)), show('money', cpm), show('percent', vtr), share, rec],
      };
    }
    const cpi = c.installs > 0 ? c.spend / c.installs : null;
    const rate = c.installs > 0 && c.clicks > 0 ? c.installs / c.clicks : null;
    const rec = recommend([
      checkPasses({ objective: 'install', metric: 'cpi', value: cpi, higherIsBetter: false }, lookup),
      checkPasses({ objective: 'install', metric: 'install_rate', value: rate, higherIsBetter: true }, lookup),
    ]);
    return {
      cells: [c.campaignName, money(c.spend), c.installs > 0 ? formatCountCompact(c.installs) : 'n/a', show('money', cpi), show('percent', rate), c.registrations > 0 ? formatCountCompact(c.registrations) : 'n/a', share, rec],
    };
  });
  const top1Share = raw.campaigns[0] ? raw.campaigns[0].spend / totalCampaignSpend : 0;
  const concentrationStatus: Status = top1Share > 0.6 ? 'Kritis' : top1Share > 0.4 ? 'Waspada' : 'Baik';

  // --- §6 Creatives -----------------------------------------------------------
  const topCreatives = raw.creatives.slice(0, 5);
  const creativeStatuses: Array<'Winning' | 'Watch' | 'Underperform'> = [];
  const creativeRows: NorthStarReportModel['creativeTable']['rows'] = topCreatives.map((a: NorthStarCreativeRow) => {
    let status: 'Winning' | 'Watch' | 'Underperform';
    let cells: string[];
    if (isAwareness) {
      const vtr = ratio(a.video6s, a.impressions);
      const completion = a.videoPlays > 0 && a.videoP100 > 0 ? a.videoP100 / a.videoPlays : null;
      const eng = a.engagements > 0 ? ratio(a.engagements, a.impressions) : null;
      status = grade([
        checkPasses({ objective: 'retention', metric: 'vtr_6s', value: vtr, higherIsBetter: true }, lookup),
        checkPasses({ objective: 'engagement', metric: 'engagement_rate', value: eng, higherIsBetter: true }, lookup),
      ]);
      cells = [a.adName, a.format, money(a.spend), `${show('percent', vtr)} / ${show('percent', completion)}`, show('percent', eng), status];
    } else {
      const cpi = a.installs > 0 ? a.spend / a.installs : null;
      const rate = a.installs > 0 && a.clicks > 0 ? a.installs / a.clicks : null;
      status = grade([
        checkPasses({ objective: 'install', metric: 'cpi', value: cpi, higherIsBetter: false }, lookup),
        checkPasses({ objective: 'install', metric: 'install_rate', value: rate, higherIsBetter: true }, lookup),
      ]);
      cells = [a.adName, a.format, money(a.spend), a.installs > 0 ? formatCountCompact(a.installs) : 'n/a', show('money', cpi), show('percent', rate), status];
    }
    creativeStatuses.push(status);
    const note = status === 'Winning' ? 'Pertahankan angle & format ini' : status === 'Underperform' ? 'Pertimbangkan refresh materi' : 'Pantau lebih lanjut';
    return { cells: [...cells, note] };
  });
  const winning = creativeStatuses.filter((s) => s === 'Winning').length;
  const underperform = creativeStatuses.filter((s) => s === 'Underperform').length;
  const creativeQualityStatus: Status =
    creativeRows.length === 0 ? 'Waspada' : underperform > winning ? 'Kritis' : winning > 0 ? 'Baik' : 'Waspada';

  // --- Source breakdown (under §4) ------------------------------------------------
  // Awareness ranks the reach-oriented campaigns (awareness + consideration) on
  // cost per 1.000 reach; Install ranks the conversion campaigns on CPI. The
  // other campaigns are bought for a different purpose, so judging them on
  // this metric would be unfair — their spend goes in a footer row instead, so
  // the table still adds up to the whole account.
  const outputOf = (c: NorthStarCampaignRow): number => (isAwareness ? c.reach : c.installs);
  const isRanked = (c: NorthStarCampaignRow): boolean =>
    isAwareness ? classifyFunnelStage(c.objectiveType) !== 'conversion' : classifyFunnelStage(c.objectiveType) === 'conversion';
  const rankedCampaigns = raw.campaigns.filter(isRanked);
  const otherCampaigns = raw.campaigns.filter((c) => !isRanked(c));
  const sourceList: PerformanceSource[] = rankedCampaigns.map((c) => ({
    name: c.campaignName,
    channel: 'TTAM',
    spend: c.spend,
    output: outputOf(c),
  }));
  const rankedSpend = sum(rankedCampaigns, (c) => c.spend);
  const rankedOutput = sum(rankedCampaigns, outputOf);
  const otherSpend = sum(otherCampaigns, (c) => c.spend);
  const otherOutput = sum(otherCampaigns, outputOf);
  const outputLabel = isAwareness ? 'Reach' : 'Install';
  const efficiencyLabel = isAwareness ? 'Cost per 1.000 Reach' : 'CPI';
  // Internally efficiency is output ÷ spend; this turns it back into the metric readers know.
  const readEfficiency = (v: number): string =>
    v <= 0 ? 'n/a' : isAwareness ? money(1000 / v) : money(1 / v);
  const blendedCost = rankedOutput > 0 ? readEfficiency(rankedOutput / rankedSpend) : 'n/a';
  const sourceBreakdown = buildSourceBreakdown({
    title: isAwareness
      ? 'Breakdown Efisiensi Jangkauan per Campaign — 3 Teratas & 3 Terbawah'
      : 'Breakdown Efisiensi Install per Campaign — 3 Teratas & 3 Terbawah',
    intro: isAwareness
      ? `Tabel ini memeringkat campaign awareness & consideration berdasarkan ${efficiencyLabel} (makin rendah makin efisien); rata-rata campaign yang dinilai = ${blendedCost}. ` +
        `Campaign conversion (${money(otherSpend)}) tidak dinilai di sini. Kolom "Dampak ke Rata-rata" = % reach dikurangi % spend: positif (▲) berarti campaign itu menjangkau lebih banyak dari porsi budgetnya, negatif (▼) berarti lebih boros.`
      : `Tabel ini memeringkat campaign conversion berdasarkan ${efficiencyLabel} (makin rendah makin efisien); rata-rata campaign yang dinilai = ${blendedCost}. ` +
        `Campaign non-conversion seperti traffic/engagement/followers (${money(otherSpend)}) tidak dinilai di sini. Kolom "Dampak ke Rata-rata" = % install dikurangi % spend: positif (▲) berarti campaign itu menghasilkan lebih banyak install dari porsi budgetnya, negatif (▼) berarti lebih boros.`,
    outputLabel,
    efficiencyLabel,
    impactLabel: 'Dampak ke Rata-rata',
    sources: sourceList,
    fmt: {
      money,
      output: formatCountCompact,
      efficiency: readEfficiency,
      impact: (r) => `${r.shareGap >= 0 ? '+' : '-'}${(Math.abs(r.shareGap) * 100).toFixed(1)}pp`,
    },
    extraSummaryRows: [
      {
        label: isAwareness ? 'Campaign conversion (tidak dinilai)' : 'Campaign non-conversion (tidak dinilai)',
        spend: money(otherSpend),
        output: formatCountCompact(otherOutput),
        efisiensi: otherOutput > 0 && otherSpend > 0 ? readEfficiency(otherOutput / otherSpend) : 'n/a',
      },
      {
        label: 'Total semua campaign (spend > 0)',
        spend: money(rankedSpend + otherSpend),
        output: formatCountCompact(rankedOutput + otherOutput),
        efisiensi:
          rankedOutput + otherOutput > 0 && rankedSpend + otherSpend > 0
            ? readEfficiency((rankedOutput + otherOutput) / (rankedSpend + otherSpend))
            : 'n/a',
      },
    ],
  });

  // --- §1 Health check --------------------------------------------------------
  const areaOf = (
    key: string,
    area: string,
    status: Status,
    items: AreaItem[],
    opts: { noun?: string; kondisi?: string } = {},
  ): NorthStarReportModel['areaRows'][number] => {
    const e = elaborateArea(items, { noun: opts.noun });
    return { key, area, status, kondisi: opts.kondisi ?? e.kondisi, working: e.working, improve: e.improve };
  };
  const sectionArea = (objective: string, key: string, area: string): NorthStarReportModel['areaRows'][number] =>
    areaOf(key, area, sectionStatus(objective), rowsToAreaItems(sectionRowsOf(objective)));

  const STAGE_NAME: Record<FunnelStage, string> = {
    awareness: 'Awareness (TOF)',
    consideration: 'Consideration (MOF)',
    conversion: 'Conversion (BOF)',
  };
  const funnelItems: AreaItem[] = (['awareness', 'consideration', 'conversion'] as FunnelStage[]).map((stage) => ({
    label: STAGE_NAME[stage],
    status: inRange(stage) ? 'Baik' : 'Waspada',
    detail: `${formatPercent(pctByStage[stage], 1)} vs ideal ${rangeLabel(stage)}`,
  }));
  const budgetArea = areaOf('funnel', 'Alokasi Budget Funnel', funnelStatus, funnelItems, { noun: 'tahap funnel' });

  // A trend metric counts as healthy when it moved the good way; a move the
  // wrong way is Kritis once it's 15%+ against us.
  const trendItems: AreaItem[] = trendDefs
    .filter((d) => d.better !== 'neutral')
    .map((d) => {
      const c = d.value(cur);
      const pv = d.value(prior);
      const g = c === null || pv === null ? null : growthPct(c, pv);
      // Normalise so a positive number always means "better".
      const improvement = g === null ? null : d.better === 'up' ? g : -g;
      return {
        label: d.label,
        status: growthItemStatus(improvement),
        detail: g === null ? undefined : `${formatDelta(g)} vs periode pembanding`,
        scored: g !== null,
      };
    });
  const trendArea = areaOf('trend', 'Tren (Periode Ini vs Pembanding)', trendStatus, trendItems);

  const creativeItemStatus = { Winning: 'Baik', Watch: 'Waspada', Underperform: 'Kritis' } as const;
  const creativeItems: AreaItem[] = topCreatives.map((a, i) => ({
    label: shortName(a.adName, 30),
    status: creativeItemStatus[creativeStatuses[i] ?? 'Watch'],
  }));
  const watching = creativeStatuses.filter((s) => s === 'Watch').length;
  const creativeArea = areaOf('creative', 'Kualitas Creative', creativeQualityStatus, creativeItems, {
    kondisi: `${winning} winning, ${watching} watch, ${underperform} underperform dari ${creativeRows.length} creative`,
  });

  const concentrationArea = areaOf(
    'concentration',
    'Konsentrasi Campaign',
    concentrationStatus,
    raw.campaigns[0]
      ? [
          {
            label: `Campaign teratas: ${shortName(raw.campaigns[0].campaignName, 30)}`,
            status: concentrationStatus,
            detail: `${formatPercent(top1Share, 1)} dari spend, batas aman ≤40%`,
          },
        ]
      : [{ label: 'Campaign', status: 'Baik', scored: false }],
    { kondisi: raw.campaigns[0] ? `Campaign teratas ${formatPercent(top1Share, 1)} dari spend` : 'Belum ada data campaign' },
  );

  const areaRows: NorthStarReportModel['areaRows'] = isAwareness
    ? [
        budgetArea,
        sectionArea('delivery', 'delivery', 'Efisiensi Delivery'),
        sectionArea('retention', 'retention', 'Video Retention'),
        sectionArea('engagement', 'engagement', 'Engagement'),
        trendArea,
        creativeArea,
      ]
    : [
        budgetArea,
        sectionArea('delivery', 'delivery', 'Efisiensi Delivery & Traffic'),
        sectionArea('install', 'install', 'Efisiensi Install'),
        sectionArea('quality', 'quality', 'Kualitas Pasca-Install'),
        trendArea,
        concentrationArea,
      ];
  const healthScore = overallHealthScore(areaRows.map((a) => a.status));

  // --- §7 Risks (deterministic — evidence + impact per non-Baik area) ---------------
  const risks = buildRisks(areaRows);

  // --- §8 Recommendations (deterministic rules; the narrative only summarizes) ------
  const recommendations = buildRecommendations({
    money,
    funnel: { spendByStage, ranges: funnelRanges },
    metrics: recMetrics,
    sources: {
      ranking: sourceBreakdown.ranking,
      outputLabel,
      efficiencyLabel,
      fmt: { money, output: formatCountCompact, efficiency: readEfficiency },
    },
    creatives: topCreatives.map((a, i) => ({ name: a.adName, status: creativeStatuses[i] ?? 'Watch' })),
    concentration:
      !isAwareness && raw.campaigns[0]
        ? { name: raw.campaigns[0].campaignName, share: top1Share, status: concentrationStatus, noun: 'campaign', limitLabel: '≤40%' }
        : undefined,
  });

  // --- §8 Outlook ---------------------------------------------------------------
  const target = (kind: MetricKind, v: number | null, factor: number, label: string): string =>
    v === null ? 'belum tersedia' : `${fmt(kind, v * factor)} (${label})`;
  const outlookRow = (
    name: string,
    kind: MetricKind,
    v: number | null,
    factor: number,
    label: string,
    strategy: string,
  ): NorthStarReportModel['outlook'][number] => ({
    metric: name,
    current: show(kind, v),
    target: target(kind, v, factor, label),
    strategy,
  });
  const outlook: NorthStarReportModel['outlook'] = isAwareness
    ? [
        outlookRow('Reach', 'count', cur.reach, 1.1, '+10%', 'Perluas audiens & jaga frequency tetap sehat'),
        outlookRow('CPM', 'money', metric('delivery', 'cpm')(cur), 0.95, '-5%', 'Optimasi creative & penempatan untuk menekan CPM'),
        outlookRow('VTR (6s)', 'percent', metric('retention', 'vtr_6s')(cur), 1.05, '+5%', 'Perkuat hook 3 detik pertama'),
      ]
    : [
        outlookRow('Total Install', 'count', cur.installs > 0 ? cur.installs : null, 1.1, '+10%', 'Scale campaign dengan CPI terbaik'),
        outlookRow('Cost per Install (CPI)', 'money', metric('install', 'cpi')(cur), 0.95, '-5%', 'Realokasi budget ke creative & campaign CPI rendah'),
        outlookRow('Registration Rate', 'percent', metric('quality', 'registration_rate')(cur), 1.05, '+5%', 'Perbaiki onboarding & kualitas traffic'),
      ];

  return {
    northStar,
    reportTitle: isAwareness ? 'TikTok Awareness Performance Report' : 'TikTok App Install Performance Report',
    coverage: 'TTAM (Regular Ads)',
    clientName: client.name,
    brandColor: client.brandColor ?? '#1FD8C7',
    periodLabel: `${raw.windowStart} – ${inclusiveEndDate(raw.windowEnd)}`,
    period: buildPeriodInfo({
      start: raw.windowStart,
      endExclusive: raw.windowEnd,
      priorStart: raw.priorStart,
      priorEndExclusive: raw.priorEnd,
      benchmarkMode,
      coverage:
        'Iklan reguler (TTAM) saja — GMV Max tidak dimasukkan karena tidak punya data tayangan, jangkauan, maupun install. Mencakup seluruh kampanye yang punya spend pada periode ini di akun di bawah. Nilai dalam Rupiah (Rb = ribu, Jt = juta, M = miliar).',
      templateLabel: TEMPLATE_LABEL[northStar],
      generatedOn: todayInJakarta(),
    }),
    benchmarkSource,
    adAccountIds: raw.tiktokAdAccountIds,
    kpiGroups,
    healthScore,
    areaRows,
    funnelRows,
    benchmarkSections,
    trendTitle: isAwareness ? 'Tren Performa Awareness' : 'Tren Performa Install',
    trendRows,
    sourceBreakdown: sourceBreakdown.model,
    campaignTitle: isAwareness ? 'Campaign Andalan Awareness' : 'Campaign Andalan Install',
    campaignTable: {
      headers: isAwareness
        ? ['Campaign', 'Spend', 'Reach', 'Frequency', 'CPM', 'VTR (6s)', '% dari Spend', 'Rekomendasi']
        : ['Campaign', 'Spend', 'Install', 'CPI', 'Install Rate', 'Registrasi', '% dari Spend', 'Rekomendasi'],
      rows: campaignRows,
      emptyNote: 'Belum ada data campaign pada periode ini.',
    },
    creativeTitle: 'Creative yang Winning',
    creativeTable: {
      headers: isAwareness
        ? ['Creative', 'Format', 'Cost', 'VTR (6s) / Completion 100%', 'Engagement Rate', 'Status', 'Catatan']
        : ['Creative', 'Format', 'Cost', 'Install', 'CPI', 'Install Rate', 'Status', 'Catatan'],
      rows: creativeRows,
      emptyNote: 'Belum ada data creative pada periode ini.',
    },
    risks,
    recommendations,
    outlook,
    legend: buildLegend(northStar),
  };
}

export function assembleNorthStarReportModel(
  facts: NorthStarReportFacts,
  narratives: NorthStarNarratives,
): NorthStarReportModel {
  return { ...facts, ...narratives };
}
