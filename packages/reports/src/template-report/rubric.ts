/**
 * Deterministic, auditable scoring for the Template Report (Plan_Template's
 * "TikTok Ads Performance Report"). Every status here is a plain function of
 * real numbers — never an LLM guess — matching the Brief Deck's own "never a
 * hallucinated finding" ethos. The narrative layer (template-report-narrative)
 * only ever writes prose *about* what these functions already decided.
 *
 * Deliberately does NOT reuse `deck/lights.ts`'s `light()`: that function
 * grades against the closed `MetricKey` catalog's per-objective bands, while a
 * Template Report benchmark is a freeform value an AM typed in for one
 * (client, funnel stage, metric) with an explicit `comparisonDirection` — a
 * different input shape, same "grade against a real target, never guess"
 * spirit.
 */

export type Status = 'Baik' | 'Waspada' | 'Kritis';
export type HealthLabel = 'Sehat' | 'Waspada' | 'Kritis';
export type ComparisonDirection = 'higher_is_better' | 'lower_is_better';

/** How far off a benchmark still counts as "on track" (Waspada) rather than "off" (Kritis). */
const BENCHMARK_TOLERANCE = 0.1;

/**
 * Grades one actual value against its manually-entered benchmark. `gapPct` is
 * signed so the caller can print "+12%"/"-8%" — positive always means the
 * actual is numerically above the benchmark, regardless of which direction is
 * "good".
 */
export function benchmarkStatus(
  actual: number,
  benchmark: number,
  direction: ComparisonDirection,
): { status: Status; gapPct: number } {
  if (!Number.isFinite(actual) || !Number.isFinite(benchmark) || benchmark === 0) {
    return { status: 'Waspada', gapPct: 0 };
  }
  const gapPct = (actual - benchmark) / Math.abs(benchmark);
  const favourable = direction === 'higher_is_better' ? gapPct : -gapPct;
  const status: Status = favourable >= 0 ? 'Baik' : favourable >= -BENCHMARK_TOLERANCE ? 'Waspada' : 'Kritis';
  return { status, gapPct };
}

/** Rolls up a set of per-metric statuses into one area status (§1 "Skor Kesehatan per Area"). */
export function rollupStatus(statuses: Status[]): Status {
  if (statuses.some((s) => s === 'Kritis')) return 'Kritis';
  if (statuses.some((s) => s === 'Waspada')) return 'Waspada';
  return 'Baik';
}

/** Overall Health Score from the 6 area statuses. */
export function overallHealthScore(areaStatuses: Status[]): HealthLabel {
  const kritis = areaStatuses.filter((s) => s === 'Kritis').length;
  const waspada = areaStatuses.filter((s) => s === 'Waspada').length;
  if (kritis >= 2) return 'Kritis';
  if (kritis === 1 || waspada >= 2) return 'Waspada';
  return 'Sehat';
}

export type FunnelStage = 'awareness' | 'consideration' | 'conversion';

/**
 * §2's default ideal ranges for the three funnel stages, as % of total
 * spend — used for any client without its own peer-derived `budget_pct`
 * benchmark row. A generic strategic target ("run some mid-funnel"), not a
 * claim about what any real account actually does.
 */
export const FUNNEL_BENCHMARK_RANGE: Record<FunnelStage, [number, number]> = {
  awareness: [0.15, 0.25],
  consideration: [0.2, 0.35],
  conversion: [0.4, 0.6],
};

/** How many percentage points either side of a peer-derived target still count as "on track". */
const FUNNEL_TARGET_TOLERANCE_PP = 0.1;

/** Turns one peer-derived target % into an ideal range, the same shape as `FUNNEL_BENCHMARK_RANGE`'s entries. */
export function funnelRangeFromTarget(target: number): [number, number] {
  return [Math.max(0, target - FUNNEL_TARGET_TOLERANCE_PP), Math.min(1, target + FUNNEL_TARGET_TOLERANCE_PP)];
}

export function funnelAllocationStatus(
  pctByStage: Record<FunnelStage, number>,
  ranges: Record<FunnelStage, [number, number]> = FUNNEL_BENCHMARK_RANGE,
): Status {
  const outOfRange = (Object.keys(ranges) as FunnelStage[]).filter((stage) => {
    const [lo, hi] = ranges[stage];
    const pct = pctByStage[stage];
    return pct < lo || pct > hi;
  }).length;
  if (outOfRange >= 2) return 'Kritis';
  if (outOfRange === 1) return 'Waspada';
  return 'Baik';
}

/**
 * TOF/MOF/BOF classification from TikTok's native `objective_type` string
 * (`tiktok_ads_campaign.objective_type`) — not from campaign-name heuristics,
 * which don't hold up against real production naming.
 *
 * The objective types seen in the real source database, and where they land:
 *   awareness     REACH, RF_REACH, TOPVIEW_REACH, VIDEO_VIEWS
 *   consideration TRAFFIC, ENGAGEMENT, LEAD_GENERATION, BRAND_CONSIDERATION
 *   conversion    APP_PROMOTION, PRODUCT_SALES, WEB_CONVERSIONS, CONVERSIONS (and any unknown)
 *
 * `BRAND_CONSIDERATION` is TikTok's own *consideration* objective and, at the
 * time of writing, the 4th-largest objective in the database by spend. It was
 * previously unrecognized and fell through to the conversion default, which
 * inflated every affected account's bottom-of-funnel share and made a pure
 * brand campaign look like a 0x-ROI sales campaign. `classifyFunnelStage.test.ts`
 * pins every known objective type so a miss like that fails loudly.
 */
export function classifyFunnelStage(objectiveType: string | null): 'awareness' | 'consideration' | 'conversion' {
  const o = (objectiveType ?? '').toUpperCase();
  if (o.includes('REACH') || o.includes('VIDEO_VIEW')) return 'awareness';
  if (
    o.includes('TRAFFIC') ||
    o.includes('ENGAGEMENT') ||
    o.includes('LEAD_GENERATION') ||
    o.includes('CONSIDERATION')
  ) {
    return 'consideration';
  }
  // APP_PROMOTION, PRODUCT_SALES, WEB_CONVERSIONS, CONVERSIONS, and anything
  // else with a purchase-shaped objective default to the bottom of the
  // funnel — the safest default for an unrecognized objective string, since
  // TikTok Shop / GMV Max campaigns overwhelmingly report here.
  return 'conversion';
}

export type ProductRecommendation = 'Scale Up' | 'Maintain' | 'Optimize' | 'Watch';

/** §5 "Produk Andalan" tiers. `roiBenchmark` is the client's Conversion-stage ROI target. */
export function productRecommendation(
  product: { roi: number | null; gmvShareRank: number },
  roiBenchmark: number | null,
): ProductRecommendation {
  const meetsRoi = roiBenchmark !== null && product.roi !== null && product.roi >= roiBenchmark;
  const topShare = product.gmvShareRank <= 2;
  if (meetsRoi && topShare) return 'Scale Up';
  if (meetsRoi) return 'Maintain';
  const gmvShareOver10 = product.gmvShareRank <= 4; // top-4 table is already >10% of shown products by construction
  if (!meetsRoi && gmvShareOver10) return 'Optimize';
  return 'Watch';
}

export type CreativeStatus = 'Winning' | 'Watch' | 'Underperform';

/** §6 "Creative yang Winning" tiers, against the client's Awareness CTR / Conversion ROI benchmarks. */
export function creativeStatus(
  creative: { ctr: number | null; roi: number | null },
  ctrBenchmark: number | null,
  roiBenchmark: number | null,
): CreativeStatus {
  const ctrOk = ctrBenchmark !== null && creative.ctr !== null && creative.ctr >= ctrBenchmark;
  const roiOk = roiBenchmark !== null && creative.roi !== null && creative.roi >= roiBenchmark;
  if (ctrOk && roiOk) return 'Winning';
  if (ctrOk || roiOk) return 'Watch';
  return 'Underperform';
}

/** L30-vs-L60-30D growth, signed fraction (0.18 = +18%). */
export function growthPct(current: number, prior: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) return null;
  return (current - prior) / Math.abs(prior);
}
