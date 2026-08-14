import { describe, expect, it } from 'vitest';
import { NorthStar } from '@tempo/core';
import type { ClientSummary, HourPoint, Totals } from '@tempo/db';
import { getCopy } from './i18n.js';
import type { HourlyReportBase, HourlyReportDay } from './hourly-model.js';
import { analyseHourly } from './hourly-analysis.js';

const hour = (h: number, over: Partial<HourPoint> = {}): HourPoint => ({
  hour: h,
  spend: 200_000,
  impressions: 30_000,
  clicks: 300,
  reach: 20_000,
  videoViews: 0,
  videoWatched6s: 0,
  engagedView15s: 0,
  engagements: 0,
  vtr6s: null,
  vtr15s: null,
  frequency: 30_000 / 20_000,
  ctr: 300 / 30_000,
  cpc: 200_000 / 300,
  cpm: (200_000 / 30_000) * 1000,
  cpv: null,
  conversions: 15,
  conversionValue: 0,
  cpa: 200_000 / 15,
  conversionRate: 15 / 300,
  roas: null,
  ...over,
});

const totals = (over: Partial<Totals> = {}): Totals => ({
  spend: 1_000_000,
  impressions: 150_000,
  clicks: 1_500,
  reach: 100_000,
  videoViews: 0,
  videoWatched6s: 0,
  engagedView15s: 0,
  engagements: 0,
  vtr6s: null,
  vtr15s: null,
  frequency: 1.5,
  ctr: 0.01,
  cpc: 667,
  cpm: 6_667,
  cpv: null,
  conversions: 75,
  conversionValue: 0,
  cpa: 1_000_000 / 75,
  conversionRate: 75 / 1_500,
  roas: null,
  ...over,
});

const day = (date: string, hours: HourPoint[]): HourlyReportDay => ({
  date,
  coverage: {
    firstHour: hours[0]?.hour ?? null,
    lastHour: hours[hours.length - 1]?.hour ?? null,
    aggregatedHours: [],
    isComplete: true,
  },
  totals: totals(),
  hours,
  pacing: hours.map((h, i) => ({
    hour: h.hour,
    cumulative: (i + 1) * h.spend,
    share: (i + 1) / hours.length,
    evenShare: (i + 1) / hours.length,
  })),
});

// A day whose money goes to the worst-converting hours, plus one campaign
// that is both expensive-per-conversion and poorly converting, and one
// clearly-failing adgroup — the shape the register should have something to
// say about, mirroring the VTR risk-register test in hourly-render.test.ts.
const spread = [
  hour(6, { spend: 100_000, clicks: 300, conversions: 24, cpa: 100_000 / 24, conversionRate: 24 / 300 }),
  hour(8, { spend: 120_000, clicks: 320, conversions: 22, cpa: 120_000 / 22, conversionRate: 22 / 320 }),
  hour(18, { spend: 900_000, clicks: 900, conversions: 9, cpa: 900_000 / 9, conversionRate: 9 / 900 }),
  hour(20, { spend: 1_100_000, clicks: 950, conversions: 8, cpa: 1_100_000 / 8, conversionRate: 8 / 950 }),
  hour(22, { spend: 1_000_000, clicks: 900, conversions: 7, cpa: 1_000_000 / 7, conversionRate: 7 / 900 }),
];

function campaignFixture(
  id: string,
  name: string,
  t: Partial<Totals>,
  adgroups: Array<{ id: string; name: string; totals: Partial<Totals> }> = [],
) {
  return {
    id,
    name,
    objective: 'web_conversions',
    totals: totals(t),
    hours: [],
    adgroups: adgroups.map((a) => ({ ...a, totals: totals(a.totals), hours: [] })),
  };
}

function buildModel(northStar: NorthStar): HourlyReportBase {
  const client: ClientSummary = {
    id: 'c1',
    name: 'Laneige',
    slug: 'laneige',
    brandColor: null,
    currency: 'IDR',
    timezone: 'UTC',
    northStar,
  };
  const d = day('2026-07-31', spread);

  return {
    locale: 'en',
    copy: getCopy('en'),
    client,
    days: [d],
    focus: d,
    focusCampaigns: [],
    campaigns: [
      campaignFixture('big', 'Heavy but weak', {
        spend: 3_500_000,
        impressions: 400_000,
        clicks: 2_900,
        conversions: 20,
        cpa: 3_500_000 / 20,
        conversionRate: 20 / 2_900,
      }),
      campaignFixture('good', 'Small but strong', {
        spend: 1_000_000,
        impressions: 130_000,
        clicks: 1_000,
        conversions: 45,
        cpa: 1_000_000 / 45,
        conversionRate: 45 / 1_000,
      }),
      campaignFixture(
        'bad',
        'Costly and unconverting',
        {
          spend: 2_000_000,
          impressions: 220_000,
          clicks: 1_100,
          conversions: 5,
          cpa: 2_000_000 / 5,
          conversionRate: 5 / 1_100,
        },
        [
          { id: 'ag1', name: 'Failing adgroup', totals: { clicks: 700, conversions: 1, conversionRate: 1 / 700 } },
          { id: 'ag2', name: 'Healthier adgroup', totals: { clicks: 400, conversions: 4, conversionRate: 4 / 400 } },
        ],
      ),
    ],
    windowTotals: totals({
      spend: 6_500_000,
      impressions: 750_000,
      clicks: 5_000,
      conversions: 70,
      cpa: 6_500_000 / 70,
      conversionRate: 70 / 5_000,
    }),
    totalHours: spread.length,
    comparison: null,
    periodLabel: '31 Jul 2026',
    generatedLabel: 'Generated Aug 1, 2026 · 00:00 UTC',
  };
}

describe('analyseHourly — conversion path (Shop / App Install)', () => {
  it('produces at least six actionable entries for a Shop client', () => {
    const risks = analyseHourly(buildModel(NorthStar.Shop)).risks;
    expect(risks.length).toBeGreaterThanOrEqual(6);
  });

  it('leads with the spend-versus-conversion-rate misallocation', () => {
    const risks = analyseHourly(buildModel(NorthStar.Shop)).risks;
    expect(risks[0]!.risk).toMatch(/spend/i);
    expect(risks[0]!.severity).toBe('high');
  });

  it('reads on conversions, never on VTR — this client has real on-platform outcomes', () => {
    const analysis = analyseHourly(buildModel(NorthStar.Shop));
    const text = [
      analysis.summaryProse,
      analysis.efficiency?.prose ?? '',
      analysis.adgroup?.prose ?? '',
      ...analysis.risks.map((r) => `${r.risk} ${r.action}`),
    ].join(' ');
    expect(text).not.toMatch(/VTR|view-through/i);
  });

  it('names the specific failing campaign and adgroup', () => {
    const text = analyseHourly(buildModel(NorthStar.Shop))
      .risks.map((r) => `${r.risk} ${r.action}`)
      .join(' ');
    expect(text).toMatch(/Costly and unconverting/);
    expect(text).toMatch(/Failing adgroup/);
  });

  it('uses "install" wording for an App Install client and "conversion" for a Shop client', () => {
    const shopText = analyseHourly(buildModel(NorthStar.Shop))
      .risks.map((r) => r.risk)
      .join(' ');
    const installText = analyseHourly(buildModel(NorthStar.AppInstall))
      .risks.map((r) => r.risk)
      .join(' ');
    expect(shopText).toMatch(/conversion/i);
    expect(installText).toMatch(/install/i);
    expect(installText).not.toMatch(/\bconversion\b/i);
  });

  it('assigns every entry a real owner and a distinct action', () => {
    for (const r of analyseHourly(buildModel(NorthStar.Shop)).risks) {
      expect(r.owner.length).toBeGreaterThan(2);
      expect(r.action).not.toBe(r.risk);
      expect(r.action).not.toBe(r.owner);
    }
  });
});
