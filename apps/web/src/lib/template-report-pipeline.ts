import type { TemplateReportRawData, ClientSummary } from '@tempo/db';
import {
  benchmarkStatus,
  buildLegend,
  buildPeriodInfo,
  buildRecommendations,
  buildRisks,
  buildSourceBreakdown,
  computePeerAccountMetrics,
  elaborateArea,
  previousPeriodBenchmarks,
  shortName,
  type AreaItem,
  type BenchmarkTarget,
  type PerformanceSource,
  type RecMetric,
  classifyFunnelStage,
  creativeStatus,
  FUNNEL_BENCHMARK_RANGE,
  funnelAllocationStatus,
  funnelRangeFromTarget,
  growthPct,
  overallHealthScore,
  productRecommendation,
  rollupStatus,
  type FunnelStage,
  type Status,
  type TemplateReportModel,
  type TemplateReportBenchmarkRow,
} from '@tempo/reports';
import { formatDelta, formatPercent, formatRatio, TEMPLATE_LABEL, type Currency } from '@tempo/core';
import type { TemplateReportNarratives } from './template-report-narrative';

/**
 * Turns raw TikTok data + an AM's manually-entered benchmarks into a fully
 * computed `TemplateReportModel`. Every status/tier here comes from
 * `@tempo/reports`'s rubric — this file only shapes numbers into the rubric's
 * inputs and formats the outputs; it makes no judgement calls of its own.
 *
 * Split into `computeTemplateReportFacts` (everything below, no narrative
 * dependency) and `assembleTemplateReportModel` (merges facts + narratives)
 * so the route can feed LM Studio the *already-computed* benchmark/funnel/
 * trend tables instead of raw totals. Handing the model raw spend/impression
 * totals and asking it to work out CPM/CTR/VTR/CPC/ROI/CVR/CPA itself before
 * writing a single word of prose reliably burned through its whole token
 * budget on arithmetic — the Efisiensi prompt in particular has 7 ratios to
 * derive, and was consistently hitting `finish_reason: length` with empty
 * `content` even at a 4096-token budget. Pre-computed facts also match the
 * rest of the system's own rule: the model writes prose about numbers, it
 * never derives them.
 */

export type TemplateReportFacts = Omit<
  TemplateReportModel,
  | 'execNarrative'
  | 'funnelInsight'
  | 'efficiencyInsight'
  | 'trendInsight'
  | 'roiInsight'
  | 'productInsight'
  | 'creativeInsight'
  | 'recommendationInsight'
>;

export type BenchmarkLookup = Map<string, BenchmarkTarget>;

export function benchmarkKey(objective: string, metric: string): string {
  return `${objective}:${metric}`;
}

function findBenchmark(lookup: BenchmarkLookup, objective: string, metric: string): BenchmarkTarget | undefined {
  return lookup.get(benchmarkKey(objective, metric));
}

/**
 * Compact currency for the Template Report only — deliberately NOT
 * `@tempo/core`'s `formatCurrencyCompact`, which uses English magnitude
 * letters (K/M/B) via `Intl.NumberFormat`'s 'compact' notation. This report
 * is Bahasa-only throughout, and in Indonesian business usage "M" means
 * *miliar* (billion), not million — showing English "M" for a million-rupiah
 * figure reads as 1000x the real value to an Indonesian AM. Uses the
 * Indonesian magnitude words instead: Rb (ribu/thousand), Jt (juta/million),
 * M (miliar/billion).
 */
export function formatRupiahCompact(value: number, currencySymbol: string): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const round1 = (n: number): string => {
    const rounded = Math.round(n * 10) / 10;
    return (Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)).replace('.', ',');
  };
  if (abs >= 1_000_000_000) return `${sign}${currencySymbol}${round1(abs / 1_000_000_000)}M`;
  if (abs >= 1_000_000) return `${sign}${currencySymbol}${round1(abs / 1_000_000)}Jt`;
  if (abs >= 1_000) return `${sign}${currencySymbol}${round1(abs / 1_000)}Rb`;
  return `${sign}${currencySymbol}${Math.round(abs).toLocaleString('id-ID')}`;
}

/** Same Indonesian magnitude words as `formatRupiahCompact`, without a currency symbol — for counts (reach, engagement). */
export function formatCountCompact(value: number): string {
  return formatRupiahCompact(value, '');
}

/** `raw.windowEnd` is exclusive internally ([start, end)) — this is the human-readable inclusive date for display (period labels, filenames). */
export function inclusiveEndDate(exclusiveEnd: string): string {
  const d = new Date(`${exclusiveEnd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function benchmarkRow(
  lookup: BenchmarkLookup,
  objective: string,
  metric: string,
  label: string,
  actual: number | null,
  formatValue: (v: number) => string,
): TemplateReportBenchmarkRow {
  const bm = findBenchmark(lookup, objective, metric);
  if (actual === null || bm === undefined) {
    // Nothing to judge against (no benchmark set, or no actual): shown as "—" and kept out of area scoring.
    return {
      metric: label,
      actual: actual === null ? 'n/a' : formatValue(actual),
      benchmark: 'belum diatur',
      gap: '—',
      status: 'Waspada',
      scored: false,
    };
  }
  const { status, gapPct } = benchmarkStatus(actual, bm.targetValue, bm.comparisonDirection);
  return { metric: label, actual: formatValue(actual), benchmark: formatValue(bm.targetValue), gap: formatDelta(gapPct), status, scored: true };
}

/** Today's date (YYYY-MM-DD) in Jakarta — the "Dibuat pada" stamp, independent of the server's timezone. */
export function todayInJakarta(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

/**
 * A benchmark table's rows as health-check items: label, status, and the
 * number behind it. A metric that appears in two sections (CTR is graded under
 * both Awareness and Consideration) is only counted once when the same
 * actual/benchmark pair repeats, and otherwise gets `dupSuffix` so the two
 * entries stay distinguishable.
 */
export function rowsToAreaItems(
  rows: TemplateReportBenchmarkRow[],
  seen: Map<string, string> = new Map(),
  dupSuffix = '(lanjutan)',
): AreaItem[] {
  const items: AreaItem[] = [];
  for (const r of rows) {
    const signature = `${r.actual}|${r.benchmark}`;
    const prior = seen.get(r.metric);
    if (prior === signature) continue; // identical to what's already listed
    const label = prior !== undefined ? `${r.metric} ${dupSuffix}` : r.metric;
    seen.set(r.metric, signature);
    items.push({
      label,
      status: r.status,
      detail: r.scored === false ? undefined : `${r.actual} vs ${r.benchmark} → ${r.gap}`,
      scored: r.scored !== false,
    });
  }
  return items;
}

/** Worst status among the scored rows; an area with nothing scorable is "Waspada" (unknown, not good). */
export function rollupScored(rows: TemplateReportBenchmarkRow[]): Status {
  const scored = rows.filter((r) => r.scored !== false);
  return scored.length === 0 ? 'Waspada' : rollupStatus(scored.map((r) => r.status));
}

/** A growth figure as a health-check status: any growth is Baik, a mild drop Waspada, a drop of 15%+ Kritis. */
export function growthItemStatus(g: number | null): Status {
  if (g === null || g >= 0) return 'Baik';
  return g <= -0.15 ? 'Kritis' : 'Waspada';
}

export type BenchmarkMode = 'industry' | 'previous_period';

export function computeTemplateReportFacts(input: {
  client: ClientSummary;
  raw: TemplateReportRawData;
  /** Stored per-client targets (manual entry / industry peer average) — used in 'industry' mode, ignored in 'previous_period'. */
  benchmarks: BenchmarkTarget[];
  /** 'industry' (default) grades against `benchmarks`; 'previous_period' grades against this report's own prior window of equal length. */
  benchmarkMode?: BenchmarkMode;
}): TemplateReportFacts {
  const { client, raw } = input;
  const benchmarkMode: BenchmarkMode = input.benchmarkMode ?? 'industry';
  // Previous-period mode: the prior window is scored with the same blended
  // formulas as the current one (floor of 1 rupiah, not the peer-noise floor —
  // this is the client's own real history, not a stranger's dead test account).
  const benchmarks: BenchmarkTarget[] =
    benchmarkMode === 'previous_period'
      ? previousPeriodBenchmarks(
          computePeerAccountMetrics(
            { current: raw.prior, currentGmvMax: raw.priorGmvMax, campaigns: raw.priorCampaigns },
            1,
          ),
        )
      : input.benchmarks;
  const benchmarkSource: TemplateReportModel['benchmarkSource'] =
    benchmarkMode === 'previous_period'
      ? {
          mode: 'previous_period',
          label: `Periode sebelumnya (${raw.priorStart} – ${inclusiveEndDate(raw.priorEnd)})`,
        }
      : { mode: 'industry', label: 'Target benchmark industri / yang ditetapkan AM' };
  const currency = client.currency as Currency;
  const currencySymbol = new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
    .format(0)
    .replace(/[\d.,\s]/g, '');
  const money = (v: number) => formatRupiahCompact(v, currencySymbol);
  const bmLookup: BenchmarkLookup = new Map(benchmarks.map((b) => [benchmarkKey(b.objective, b.metric), b]));

  // --- KPIs (§1) ------------------------------------------------------------
  // TTAM (reach-based ads) and GMV Max (conversion-based ads) are different
  // campaign delivery types with their own cost/revenue, so §1 shows three
  // card groups instead of blending them into one number: TTAM (its own
  // north star is Spend/Reach/Engagement — GMV Max runs no reach/engagement
  // objectives at all), GMV Max (Spend/Revenue/ROI — its own conversion
  // economics), and Total (both sources combined, since an AM still needs
  // one blended cost-efficiency view across the whole account).
  const ttamSpend = raw.current.spend;
  const ttamReach = raw.current.reach;
  const ttamEngagement = raw.current.engagements;
  const priorTtamSpend = raw.prior.spend;
  const priorTtamReach = raw.prior.reach;
  const priorTtamEngagement = raw.prior.engagements;
  const ttamSpendGrowth = growthPct(ttamSpend, priorTtamSpend);
  const ttamReachGrowth = growthPct(ttamReach, priorTtamReach);
  const ttamEngagementGrowth = growthPct(ttamEngagement, priorTtamEngagement);

  const gmvSpend = raw.currentGmvMax.cost;
  const gmvRevenue = raw.currentGmvMax.grossRevenue;
  const gmvRoi = gmvSpend > 0 ? gmvRevenue / gmvSpend : 0;
  const priorGmvSpend = raw.priorGmvMax.cost;
  const priorGmvRevenue = raw.priorGmvMax.grossRevenue;
  const priorGmvRoi = priorGmvSpend > 0 ? priorGmvRevenue / priorGmvSpend : 0;
  const gmvSpendGrowth = growthPct(gmvSpend, priorGmvSpend);
  const gmvRevenueGrowth = growthPct(gmvRevenue, priorGmvRevenue);
  const gmvRoiGrowth = growthPct(gmvRoi, priorGmvRoi);
  const roiBenchmark = findBenchmark(bmLookup, 'conversion', 'roi');

  // Total = TTAM + GMV Max combined. CPM is deliberately blended: TTAM is the
  // only source with impression data, so "combined CPM" is total spend
  // across both delivery types divided by the impressions TTAM actually
  // delivered — an all-in cost-per-1000-impressions figure, not just TTAM's
  // own CPM. Combined ROI/ROAS is (TTAM + GMV Max revenue) / (TTAM + GMV Max
  // spend) — the true blended return across the whole account.
  const combinedSpend = ttamSpend + gmvSpend;
  const combinedRevenue = raw.current.totalOnsiteShoppingValue + gmvRevenue;
  const combinedRoi = combinedSpend > 0 ? combinedRevenue / combinedSpend : 0;
  const combinedCpm = raw.current.impressions > 0 ? (combinedSpend / raw.current.impressions) * 1000 : 0;
  const combinedOrders = raw.current.onsiteShopping + raw.currentGmvMax.orders;
  const priorCombinedSpend = priorTtamSpend + priorGmvSpend;
  const priorCombinedRevenue = raw.prior.totalOnsiteShoppingValue + priorGmvRevenue;
  const priorCombinedRoi = priorCombinedSpend > 0 ? priorCombinedRevenue / priorCombinedSpend : 0;
  const priorCombinedCpm = raw.prior.impressions > 0 ? (priorCombinedSpend / raw.prior.impressions) * 1000 : 0;
  const priorCombinedOrders = raw.prior.onsiteShopping + raw.priorGmvMax.orders;
  const combinedSpendGrowth = growthPct(combinedSpend, priorCombinedSpend);
  const combinedRoiGrowth = growthPct(combinedRoi, priorCombinedRoi);
  const combinedCpmGrowth = growthPct(combinedCpm, priorCombinedCpm);

  // §3-§8 below are blended (TTAM + GMV Max combined), same philosophy as the
  // "Total" card in §1 and the combined funnel in §2 — an AM's headline
  // GMV/ROI/CPA numbers should reflect the whole account, not just its GMV
  // Max slice. Reuses the combined values computed above under these
  // shorter names since every downstream section already reads them.
  const totalSpend = combinedSpend;
  const totalGmv = combinedRevenue;
  const roi = combinedRoi;
  const priorRoi = priorCombinedRoi;

  // --- Funnel allocation (§2) ----------------------------------------------
  // Combined across both sources, per funnel stage: Awareness/Consideration
  // are purely TTAM (GMV Max runs no reach/traffic objectives to add there),
  // and Conversion (BOF) combines TTAM's own conversion-classified campaigns
  // with GMV Max cost — one blended view of where budget actually goes
  // across the whole funnel, not just the GMV Max slice of it.
  const spendByStage = { awareness: 0, consideration: 0, conversion: 0 };
  for (const c of raw.campaigns) {
    const stage = classifyFunnelStage(c.objectiveType);
    spendByStage[stage] += c.spend;
  }
  spendByStage.conversion += gmvSpend;
  const totalCampaignSpend = spendByStage.awareness + spendByStage.consideration + spendByStage.conversion || 1;
  const pctByStage = {
    awareness: spendByStage.awareness / totalCampaignSpend,
    consideration: spendByStage.consideration / totalCampaignSpend,
    conversion: spendByStage.conversion / totalCampaignSpend,
  };
  // Each stage's ideal range comes from the client's own peer-derived
  // 'budget_pct' benchmark when one has been entered (see funnelRangeFromTarget),
  // falling back stage-by-stage to the generic FUNNEL_BENCHMARK_RANGE default
  // for any stage without one — so a client with only some stages benchmarked
  // doesn't lose the others' defaults.
  const funnelRanges = Object.fromEntries(
    (Object.keys(FUNNEL_BENCHMARK_RANGE) as FunnelStage[]).map((stage) => {
      const bm = findBenchmark(bmLookup, stage, 'budget_pct');
      return [stage, bm ? funnelRangeFromTarget(bm.targetValue) : FUNNEL_BENCHMARK_RANGE[stage]];
    }),
  ) as Record<FunnelStage, [number, number]>;
  const inRange = (stage: FunnelStage, pct: number): boolean => {
    const [lo, hi] = funnelRanges[stage];
    return pct >= lo && pct <= hi;
  };
  const rangeLabel = (stage: FunnelStage): string => {
    const [lo, hi] = funnelRanges[stage];
    return `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`;
  };
  const funnelStatus = funnelAllocationStatus(pctByStage, funnelRanges);
  const funnelRows: TemplateReportModel['funnelRows'] = [
    {
      stage: 'Awareness (TOF)',
      objectiveLabel: 'Reach, Video Views',
      budget: money(spendByStage.awareness),
      pct: formatPercent(pctByStage.awareness, 1),
      benchmarkLabel: rangeLabel('awareness'),
      status: inRange('awareness', pctByStage.awareness) ? 'Baik' : 'Waspada',
    },
    {
      stage: 'Consideration (MOF)',
      objectiveLabel: 'Traffic, Engagement, Brand Consideration',
      budget: money(spendByStage.consideration),
      pct: formatPercent(pctByStage.consideration, 1),
      benchmarkLabel: rangeLabel('consideration'),
      status: inRange('consideration', pctByStage.consideration) ? 'Baik' : 'Waspada',
    },
    {
      stage: 'Conversion (BOF)',
      objectiveLabel: 'Product GMV Max, Live GMV Max, TTAM Conversion',
      budget: money(spendByStage.conversion),
      pct: formatPercent(pctByStage.conversion, 1),
      benchmarkLabel: rangeLabel('conversion'),
      status: inRange('conversion', pctByStage.conversion) ? 'Baik' : 'Waspada',
    },
  ];

  // --- Benchmark tables (§3) -------------------------------------------------
  // Awareness/Consideration metrics stay TTAM-sourced — GMV Max carries no
  // impression/click/reach data, so CPM/CTR/VTR/CPC simply cannot be derived
  // from it. Conversion (ROI/CVR/CPA) is blended, matching §2's combined
  // Conversion(BOF) budget: `combinedOrders` is TTAM's own onsite-shopping
  // conversions plus GMV Max orders, and CPA's cost is `spendByStage.conversion`
  // (the same TTAM-conversion-campaigns + GMV Max cost total the funnel row
  // above already computed) — one consistent conversion figure throughout,
  // not a GMV Max-only number. CVR's denominator (clicks) has no GMV Max
  // equivalent — the closest available figure is TTAM clicks, a known
  // limitation, not a full fix.
  const cpmActual = raw.current.impressions > 0 ? (raw.current.spend / raw.current.impressions) * 1000 : null;
  const ctrActual = raw.current.impressions > 0 ? raw.current.clicks / raw.current.impressions : null;
  const vtrActual = raw.current.impressions > 0 ? raw.current.videoWatched6s / raw.current.impressions : null;
  const cpcActual = raw.current.clicks > 0 ? raw.current.spend / raw.current.clicks : null;
  const cvrActual = raw.current.clicks > 0 ? combinedOrders / raw.current.clicks : null;
  const cpaActual = combinedOrders > 0 ? spendByStage.conversion / combinedOrders : null;

  // Each row is also recorded as a recommendation input (key, section, status,
  // numbers) so §8 can turn weak metrics into concrete next steps.
  const recMetrics: RecMetric[] = [];
  const bmRow = (
    section: string,
    objective: string,
    metric: string,
    label: string,
    actual: number | null,
    fmt: (v: number) => string,
  ): TemplateReportBenchmarkRow => {
    const row = benchmarkRow(bmLookup, objective, metric, label, actual, fmt);
    const bm = findBenchmark(bmLookup, objective, metric);
    recMetrics.push({
      key: `${objective}:${metric}`,
      label,
      section,
      status: row.status,
      scored: row.scored !== false,
      actual: row.actual,
      benchmark: row.benchmark,
      gap: row.gap,
      higherIsBetter: bm ? bm.comparisonDirection === 'higher_is_better' : true,
    });
    return row;
  };

  const benchmarkSections: TemplateReportModel['benchmarkSections'] = [
    {
      title: 'Awareness',
      rows: [
        bmRow('Efisiensi Awareness', 'awareness', 'cpm', 'CPM', cpmActual, money),
        bmRow('Efisiensi Awareness', 'awareness', 'ctr', 'CTR', ctrActual, (v) => formatPercent(v, 2)),
        bmRow('Efisiensi Awareness', 'awareness', 'vtr', 'VTR (6s)', vtrActual, (v) => formatPercent(v, 2)),
      ],
    },
    {
      title: 'Consideration',
      rows: [
        bmRow('Efisiensi Consideration', 'consideration', 'ctr', 'CTR', ctrActual, (v) => formatPercent(v, 2)),
        bmRow('Efisiensi Consideration', 'consideration', 'cpc', 'Cost per Click (CPC)', cpcActual, money),
        bmRow('Efisiensi Consideration', 'consideration', 'cost_per_atc', 'Cost per Add to Cart', null, money),
      ],
    },
    {
      title: 'Conversion',
      rows: [
        bmRow('Efisiensi Conversion', 'conversion', 'roi', 'ROI', roi, (v) => formatRatio(v)),
        bmRow('Efisiensi Conversion', 'conversion', 'cvr', 'CVR', cvrActual, (v) => formatPercent(v, 2)),
        bmRow('Efisiensi Conversion', 'conversion', 'cpa', 'Cost per Order (CPA)', cpaActual, money),
      ],
    },
  ];
  const sectionRows = (title: string) => benchmarkSections.find((s) => s.title === title)!.rows;
  // Metrics with no benchmark/actual don't count for or against an area.
  const efficiencyStatus = rollupScored(sectionRows('Conversion'));
  const nonGmvMaxStatus = rollupScored([...sectionRows('Awareness'), ...sectionRows('Consideration')]);

  // --- Trend (§4) — blended (TTAM + GMV Max), same as §3's Conversion row. ---
  const gmvGrowth = growthPct(totalGmv, priorCombinedRevenue);
  const costGrowth = growthPct(totalSpend, priorCombinedSpend);
  const roiGrowth = growthPct(roi, priorRoi);
  const ordersGrowth = growthPct(combinedOrders, priorCombinedOrders);
  const aov = combinedOrders > 0 ? totalGmv / combinedOrders : 0;
  const priorAov = priorCombinedOrders > 0 ? priorCombinedRevenue / priorCombinedOrders : 0;
  const aovGrowth = growthPct(aov, priorAov);

  const trendRows: TemplateReportModel['trendRows'] = [
    { metric: 'Total GMV', l30: money(totalGmv), l60_30: money(priorCombinedRevenue), growth: formatDelta(gmvGrowth), insight: (gmvGrowth ?? 0) >= 0 ? 'Tumbuh' : 'Menurun' },
    { metric: 'Total Cost', l30: money(totalSpend), l60_30: money(priorCombinedSpend), growth: formatDelta(costGrowth), insight: (costGrowth ?? 0) <= 0 ? 'Efisien' : 'Naik' },
    { metric: 'ROI', l30: formatRatio(roi), l60_30: formatRatio(priorRoi), growth: formatDelta(roiGrowth), insight: (roiGrowth ?? 0) >= 0 ? 'Membaik' : 'Menurun' },
    { metric: 'Total Orders', l30: String(combinedOrders), l60_30: String(priorCombinedOrders), growth: formatDelta(ordersGrowth), insight: (ordersGrowth ?? 0) >= 0 ? 'Tumbuh' : 'Menurun' },
    { metric: 'AOV', l30: money(aov), l60_30: money(priorAov), growth: formatDelta(aovGrowth), insight: (aovGrowth ?? 0) >= 0 ? 'Naik' : 'Turun' },
  ];
  const trendStatus: Status = (gmvGrowth ?? 0) >= 0 && (roiGrowth ?? 0) >= 0 ? 'Baik' : (gmvGrowth ?? 0) < 0 && (roiGrowth ?? 0) < 0 ? 'Kritis' : 'Waspada';

  // --- Products (§5) ----------------------------------------------------------
  // "% Kontribusi thd Total GMV" is against the *true* account-level GMV Max
  // total (`gmvRevenue`, not the blended `totalGmv` used elsewhere) — these
  // rows come exclusively from GMV Max product campaigns, so their share only
  // makes sense against the GMV Max total they were actually drawn from, not
  // account-wide revenue that includes TTAM's onsite-shopping value too. Also
  // not the sum of only the top 4 shown, which would overstate each product's
  // real share once products past the top 4 also contribute GMV.
  const totalProductGmv = gmvRevenue || 1;
  const productRows: TemplateReportModel['productRows'] = raw.topProducts.map((p, i) => {
    const rec = productRecommendation({ roi: p.roi, gmvShareRank: i + 1 }, roiBenchmark?.targetValue ?? null);
    return {
      produk: p.campaignName,
      gmv: money(p.gmv),
      orders: String(p.orders),
      roi: p.roi === null ? 'n/a' : formatRatio(p.roi),
      pctKontribusi: formatPercent(p.gmv / totalProductGmv, 1),
      rekomendasi: rec,
    };
  });
  const top1Share = raw.topProducts[0] ? raw.topProducts[0].gmv / totalProductGmv : 0;
  const concentrationStatus: Status = top1Share > 0.5 ? 'Kritis' : top1Share > 0.35 ? 'Waspada' : 'Baik';

  // --- Creatives (§6) -----------------------------------------------------
  const ctrBenchmark = findBenchmark(bmLookup, 'awareness', 'ctr');
  const creativeRows: TemplateReportModel['creativeRows'] = raw.topCreatives.map((c) => {
    const status = creativeStatus({ ctr: c.ctr, roi: c.roi }, ctrBenchmark?.targetValue ?? null, roiBenchmark?.targetValue ?? null);
    return {
      creative: c.adName,
      format: c.format,
      cost: money(c.spend),
      ctrRoi: `${c.ctr === null ? 'n/a' : formatPercent(c.ctr, 2)} / ${c.roi === null ? 'n/a' : formatRatio(c.roi)}`,
      status,
      catatan: status === 'Winning' ? 'Pertahankan angle & format ini' : status === 'Underperform' ? 'Pertimbangkan refresh materi' : 'Pantau lebih lanjut',
    };
  });
  const winning = creativeRows.filter((r) => r.status === 'Winning').length;
  const underperform = creativeRows.filter((r) => r.status === 'Underperform').length;
  const creativeQualityStatus: Status = creativeRows.length === 0 ? 'Waspada' : underperform > winning ? 'Kritis' : winning > 0 ? 'Baik' : 'Waspada';

  // --- ROI breakdown (under §4) -------------------------------------------------
  // Sources are the conversion-oriented ones: every GMV Max campaign plus the
  // TTAM campaigns TikTok classes as conversion. Awareness/Consideration TTAM
  // spend is deliberately not ranked on ROI — those campaigns are bought for
  // reach and traffic, so "0x ROI" would be an unfair verdict — it is shown as
  // a separate footer row so the table still adds up to the headline ROI.
  const roiSources: PerformanceSource[] = [
    ...raw.gmvMaxCampaigns.map((c) => ({ name: c.campaignName, channel: 'GMV Max', spend: c.cost, output: c.grossRevenue })),
    ...raw.campaigns
      .filter((c) => classifyFunnelStage(c.objectiveType) === 'conversion')
      .map((c) => ({ name: c.campaignName, channel: 'TTAM', spend: c.spend, output: c.totalOnsiteShoppingValue })),
  ];
  const liveSources = roiSources.filter((x) => x.spend > 0);
  const convSpend = liveSources.reduce((a, x) => a + x.spend, 0);
  const convRevenue = liveSources.reduce((a, x) => a + x.output, 0);
  const convRoi = convSpend > 0 ? convRevenue / convSpend : 0;
  const restSpend = Math.max(0, combinedSpend - convSpend);
  const restRevenue = Math.max(0, combinedRevenue - convRevenue);
  const roiBreakdown = buildSourceBreakdown({
    title: 'Breakdown Sumber ROI — 3 Teratas & 3 Terbawah',
    intro:
      `ROI gabungan akun = ${formatRatio(combinedRoi)} (revenue ${money(combinedRevenue)} ÷ seluruh spend ${money(combinedSpend)}). ` +
      `Tabel ini memecahnya per sumber conversion (campaign GMV Max dan campaign TTAM berorientasi penjualan); ROI rata-rata sumber conversion = ${formatRatio(convRoi)}. ` +
      `Selisihnya dengan ROI gabungan berasal dari spend awareness & consideration (${money(restSpend)}) yang memang tidak dirancang menghasilkan penjualan langsung. ` +
      'Kolom "Dampak ke ROI" menunjukkan seberapa jauh satu sumber menaikkan (▲) atau menurunkan (▼) ROI rata-rata sumber conversion.',
    outputLabel: 'Revenue',
    efficiencyLabel: 'ROI',
    impactLabel: 'Dampak ke ROI',
    sources: roiSources,
    fmt: {
      money,
      output: money,
      efficiency: (v) => formatRatio(v),
      impact: (r) => `${r.impact >= 0 ? '+' : '-'}${Math.abs(r.impact).toFixed(2)}x`,
    },
    extraSummaryRows: [
      {
        label: 'Awareness, Consideration & lainnya (tidak dinilai ROI)',
        spend: money(restSpend),
        output: money(restRevenue),
        efisiensi: restSpend > 0 ? formatRatio(restRevenue / restSpend) : 'n/a',
      },
      {
        label: 'Total gabungan (sesuai KPI di bagian 1)',
        spend: money(combinedSpend),
        output: money(combinedRevenue),
        efisiensi: formatRatio(combinedRoi),
      },
    ],
  });

  // --- §1 Health check ------------------------------------------------------
  const STAGE_NAME: Record<FunnelStage, string> = {
    awareness: 'Awareness (TOF)',
    consideration: 'Consideration (MOF)',
    conversion: 'Conversion (BOF)',
  };
  const areaOf = (
    key: string,
    area: string,
    status: Status,
    items: AreaItem[],
    opts: { noun?: string; kondisi?: string } = {},
  ): TemplateReportModel['areaRows'][number] => {
    const e = elaborateArea(items, { noun: opts.noun });
    return { key, area, status, kondisi: opts.kondisi ?? e.kondisi, working: e.working, improve: e.improve };
  };

  const funnelItems: AreaItem[] = (['awareness', 'consideration', 'conversion'] as FunnelStage[]).map((stage) => ({
    label: STAGE_NAME[stage],
    status: inRange(stage, pctByStage[stage]) ? 'Baik' : 'Waspada',
    detail: `${formatPercent(pctByStage[stage], 1)} vs ideal ${rangeLabel(stage)}`,
  }));
  const trendItems: AreaItem[] = [
    { label: 'Total GMV', g: gmvGrowth },
    { label: 'ROI', g: roiGrowth },
    { label: 'Total Orders', g: ordersGrowth },
    { label: 'AOV', g: aovGrowth },
  ].map(({ label, g }) => ({
    label,
    status: growthItemStatus(g),
    detail: g === null ? undefined : `${formatDelta(g)} vs periode pembanding`,
    scored: g !== null,
  }));
  const creativeItemStatus = { Winning: 'Baik', Watch: 'Waspada', Underperform: 'Kritis' } as const;
  const creativeItems: AreaItem[] = creativeRows.map((c, i) => {
    const raw_ = raw.topCreatives[i];
    return {
      label: shortName(c.creative, 30),
      status: creativeItemStatus[c.status],
      detail: raw_
        ? `CTR ${raw_.ctr === null ? 'n/a' : formatPercent(raw_.ctr, 2)}, ROI ${raw_.roi === null ? 'n/a' : formatRatio(raw_.roi)}`
        : undefined,
    };
  });
  const watching = creativeRows.filter((r) => r.status === 'Watch').length;
  const concentrationItems: AreaItem[] = raw.topProducts[0]
    ? [
        {
          label: `Produk teratas: ${shortName(raw.topProducts[0].campaignName, 30)}`,
          status: concentrationStatus,
          detail: `${formatPercent(top1Share, 1)} dari GMV, batas aman ≤35%`,
        },
      ]
    : [{ label: 'Produk GMV Max', status: 'Baik', scored: false }];

  const topFunnelItems = (() => {
    const seen = new Map<string, string>();
    return [
      ...rowsToAreaItems(sectionRows('Awareness'), seen),
      ...rowsToAreaItems(sectionRows('Consideration'), seen, '(Consideration)'),
    ];
  })();

  const areaRows: TemplateReportModel['areaRows'] = [
    areaOf('funnel', 'Alokasi Budget Funnel', funnelStatus, funnelItems, { noun: 'tahap funnel' }),
    areaOf('conversion', 'Efisiensi Konversi (BOF)', efficiencyStatus, rowsToAreaItems(sectionRows('Conversion'))),
    areaOf('trend', 'Tren Gabungan', trendStatus, trendItems),
    areaOf('concentration', 'Konsentrasi Produk', concentrationStatus, concentrationItems, {
      kondisi: raw.topProducts[0] ? `Produk teratas ${formatPercent(top1Share, 1)} dari GMV` : 'Belum ada data produk GMV Max',
    }),
    areaOf('creative', 'Kualitas Creative', creativeQualityStatus, creativeItems, {
      kondisi: `${winning} winning, ${watching} watch, ${underperform} underperform dari ${creativeRows.length} creative`,
    }),
    areaOf('topfunnel', 'Efisiensi Awareness & Consideration (TTAM)', nonGmvMaxStatus, topFunnelItems),
  ];
  const healthScore = overallHealthScore(areaRows.map((a) => a.status));

  // --- §7 Risks (deterministic — evidence + impact per non-Baik area) ----------
  const risks = buildRisks(areaRows);

  // --- §8 Recommendations (deterministic rules; the narrative only summarizes) -
  const recommendations = buildRecommendations({
    money,
    funnel: { spendByStage, ranges: funnelRanges },
    metrics: recMetrics,
    sources: {
      ranking: roiBreakdown.ranking,
      outputLabel: 'Revenue',
      efficiencyLabel: 'ROI',
      fmt: { money, output: money, efficiency: (v) => formatRatio(v) },
      // A source returning less than it costs is losing money — urgent.
      isCritical: (d) => d.efficiency < 1,
    },
    creatives: creativeRows.map((c) => ({ name: c.creative, status: c.status })),
    products: raw.topProducts.map((p, i) => ({
      name: p.campaignName,
      rec: productRows[i]!.rekomendasi,
      roi: productRows[i]!.roi,
    })),
    concentration: raw.topProducts[0]
      ? { name: raw.topProducts[0].campaignName, share: top1Share, status: concentrationStatus, noun: 'produk', limitLabel: '≤35%' }
      : undefined,
  });

  // --- §8 Outlook -------------------------------------------------------------
  const outlook: TemplateReportModel['outlook'] = [
    { metric: 'GMV', current: money(totalGmv), target: `${money(totalGmv * 1.1)} (+10%)`, strategy: 'Scale produk top performer, jaga efisiensi ROI' },
    { metric: 'ROI', current: formatRatio(roi), target: `${formatRatio(roi)} – ${formatRatio(roi * 1.1)}`, strategy: 'Realokasi budget ke campaign BOF efisien' },
    { metric: 'Kontribusi Live Shopping', current: 'belum tersedia', target: 'belum tersedia', strategy: 'Perlu data sesi live untuk proyeksi' },
  ];

  return {
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
        'Seluruh kampanye yang punya spend pada periode ini di akun di bawah: iklan reguler (TTAM) dan GMV Max (Product/Live). Nilai dalam Rupiah (Rb = ribu, Jt = juta, M = miliar).',
      templateLabel: TEMPLATE_LABEL.shop,
      generatedOn: todayInJakarta(),
    }),
    benchmarkSource,
    adAccountIds: raw.tiktokAdAccountIds,
    kpis: {
      ttam: {
        spend: money(ttamSpend),
        spendDelta: formatDelta(ttamSpendGrowth),
        reach: formatCountCompact(ttamReach),
        reachDelta: formatDelta(ttamReachGrowth),
        engagement: formatCountCompact(ttamEngagement),
        engagementDelta: formatDelta(ttamEngagementGrowth),
      },
      gmvMax: {
        spend: money(gmvSpend),
        spendDelta: formatDelta(gmvSpendGrowth),
        revenue: money(gmvRevenue),
        revenueDelta: formatDelta(gmvRevenueGrowth),
        roi: formatRatio(gmvRoi),
        roiDelta: formatDelta(gmvRoiGrowth),
        roiTarget: roiBenchmark ? formatRatio(roiBenchmark.targetValue) : 'belum diatur',
      },
      total: {
        spend: money(combinedSpend),
        spendDelta: formatDelta(combinedSpendGrowth),
        cpm: money(combinedCpm),
        cpmDelta: formatDelta(combinedCpmGrowth),
        roi: formatRatio(combinedRoi),
        roiDelta: formatDelta(combinedRoiGrowth),
      },
      healthScore,
    },
    areaRows,
    funnelRows,
    benchmarkSections,
    trendRows,
    roiBreakdown: roiBreakdown.model,
    productRows,
    creativeRows,
    risks,
    recommendations,
    outlook,
    legend: buildLegend('shop'),
  };
}

/** Merges the deterministic facts with the six LM Studio narrative strings into the final render model. */
export function assembleTemplateReportModel(
  facts: TemplateReportFacts,
  narratives: TemplateReportNarratives,
): TemplateReportModel {
  return {
    ...facts,
    execNarrative: narratives.execNarrative,
    funnelInsight: narratives.funnelInsight,
    efficiencyInsight: narratives.efficiencyInsight,
    trendInsight: narratives.trendInsight,
    roiInsight: narratives.roiInsight,
    productInsight: narratives.productInsight,
    creativeInsight: narratives.creativeInsight,
    recommendationInsight: narratives.recommendationInsight,
  };
}
