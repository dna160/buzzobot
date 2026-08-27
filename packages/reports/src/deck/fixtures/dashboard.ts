import type { CampaignWindowRow, DailyBriefDashboardData, DayPoint, Totals } from '@tempo/db';

/**
 * A day-grain brief rollup, shaped exactly like `getDailyBriefDashboard`
 * returns one. Hand-built rather than seeded, because the deck's tests are
 * about *rendering* — the read-model's own arithmetic is already covered by
 * `packages/db`'s PGlite tests, and a deck test that needs a database is a deck
 * test nobody runs.
 *
 * Ratios are derived here the same way `daily-brief.ts` derives them: from
 * summed numerators and denominators, never averaged. A fixture that broke that
 * rule would let a renderer bug hide behind arithmetic that could not occur in
 * production.
 */

export interface TotalsSeed {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  videoViews: number;
  videoWatched6s: number;
  engagedView15s: number;
  engagements: number;
  conversions: number;
  conversionValue: number;
}

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

export function makeTotals(seed: TotalsSeed): Totals {
  return {
    ...seed,
    vtr6s: ratio(seed.videoWatched6s, seed.impressions),
    vtr15s: ratio(seed.engagedView15s, seed.impressions),
    frequency: ratio(seed.impressions, seed.reach),
    ctr: ratio(seed.clicks, seed.impressions),
    cpc: ratio(seed.spend, seed.clicks),
    cpm: seed.impressions > 0 ? (seed.spend / seed.impressions) * 1000 : null,
    cpv: ratio(seed.spend, seed.videoViews),
    cpa: ratio(seed.spend, seed.conversions),
    conversionRate: ratio(seed.conversions, seed.clicks),
    roas: ratio(seed.conversionValue, seed.spend),
  };
}

function scaleSeed(base: TotalsSeed, factor: number): TotalsSeed {
  return {
    spend: Math.round(base.spend * factor),
    impressions: Math.round(base.impressions * factor),
    clicks: Math.round(base.clicks * factor),
    reach: Math.round(base.reach * factor),
    videoViews: Math.round(base.videoViews * factor),
    videoWatched6s: Math.round(base.videoWatched6s * factor),
    engagedView15s: Math.round(base.engagedView15s * factor),
    engagements: Math.round(base.engagements * factor),
    conversions: Math.round(base.conversions * factor),
    conversionValue: Math.round(base.conversionValue * factor),
  };
}

const DAY_SEED: TotalsSeed = {
  spend: 12_500_000,
  impressions: 2_400_000,
  clicks: 31_000,
  reach: 810_000,
  videoViews: 1_950_000,
  videoWatched6s: 430_000,
  engagedView15s: 190_000,
  engagements: 58_000,
  conversions: 640,
  conversionValue: 41_000_000,
};

// Deterministic day-to-day variation — no randomness, so goldens stay golden.
const DAY_FACTORS = [0.86, 1.04, 0.93, 1.18, 1.09, 0.97, 1.02];

function sumSeeds(seeds: TotalsSeed[]): TotalsSeed {
  return seeds.reduce((acc, seed) => ({
    spend: acc.spend + seed.spend,
    impressions: acc.impressions + seed.impressions,
    clicks: acc.clicks + seed.clicks,
    reach: acc.reach + seed.reach,
    videoViews: acc.videoViews + seed.videoViews,
    videoWatched6s: acc.videoWatched6s + seed.videoWatched6s,
    engagedView15s: acc.engagedView15s + seed.engagedView15s,
    engagements: acc.engagements + seed.engagements,
    conversions: acc.conversions + seed.conversions,
    conversionValue: acc.conversionValue + seed.conversionValue,
  }));
}

const CAMPAIGN_SEEDS: Array<{ id: string; name: string; objective: string; factor: number; roasBias: number }> = [
  { id: 'c1', name: 'GMV Max — Skincare Bundle', objective: 'product_sales', factor: 0.42, roasBias: 1.35 },
  { id: 'c2', name: 'Live Session — Prime Time', objective: 'product_sales', factor: 0.28, roasBias: 1.1 },
  { id: 'c3', name: 'Video Shopping Ads — Retargeting', objective: 'product_sales', factor: 0.19, roasBias: 0.7 },
  { id: 'c4', name: 'Traffic — Cold Audience', objective: 'traffic', factor: 0.11, roasBias: 0.2 },
];

export function buildDashboardFixture(): DailyBriefDashboardData {
  const daySeeds = DAY_FACTORS.map((factor) => scaleSeed(DAY_SEED, factor));
  const days: DayPoint[] = daySeeds.map((seed, i) => ({
    date: `2026-08-${String(10 + i).padStart(2, '0')}`,
    totals: makeTotals(seed),
  }));

  const windowSeed = sumSeeds(daySeeds);
  const previousSeed = scaleSeed(windowSeed, 0.88);

  const campaigns: CampaignWindowRow[] = CAMPAIGN_SEEDS.map(({ id, name, objective, factor, roasBias }) => {
    const seed = scaleSeed(windowSeed, factor);
    return {
      id,
      name,
      objective,
      totals: makeTotals({
        ...seed,
        conversionValue: Math.round(seed.conversionValue * roasBias),
      }),
    };
  });

  const windowTotals = makeTotals(windowSeed);
  const previous = makeTotals(previousSeed);

  return {
    client: {
      id: 'client-sovella',
      name: 'Sovella',
      slug: 'sovella',
      brandColor: '#7A3AA7',
      currency: 'IDR',
      timezone: 'Asia/Jakarta',
      northStar: 'shop',
      // Sovella has intraday telemetry in the fixture's story, and the field
      // has been required on ClientSummary since the clients.tier migration.
      tier: 'premium',
    },
    days,
    windowTotals,
    comparison: {
      firstDate: '2026-08-03',
      lastDate: '2026-08-09',
      previous,
      deltas: {
        impressions: null,
        reach: null,
        vtr6s: null,
        vtr15s: null,
        spend: null,
        clicks: null,
        ctr: null,
        cpc: null,
        cpm: null,
        conversions: null,
        cpa: null,
        roas: null,
      },
    },
    campaigns,
  };
}

/** A window with no ingested days — the honest-empty-state path. */
export function buildEmptyDashboardFixture(): DailyBriefDashboardData {
  const zero = makeTotals({
    spend: 0,
    impressions: 0,
    clicks: 0,
    reach: 0,
    videoViews: 0,
    videoWatched6s: 0,
    engagedView15s: 0,
    engagements: 0,
    conversions: 0,
    conversionValue: 0,
  });
  return {
    client: buildDashboardFixture().client,
    days: [],
    windowTotals: zero,
    comparison: null,
    campaigns: [],
  };
}
