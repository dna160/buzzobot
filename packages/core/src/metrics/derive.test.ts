import { describe, expect, it } from 'vitest';
import { derivePaid, deriveOrganic, deltaPct, sumPaid, sumOrganic } from './derive.js';
import type { OrganicDailyMetric, PaidDailyMetric } from '../domain/entities.js';

const paidRow = (over: Partial<PaidDailyMetric>): PaidDailyMetric => ({
  date: '2026-07-01',
  campaignId: '00000000-0000-0000-0000-000000000000',
  spend: 0,
  impressions: 0,
  clicks: 0,
  conversions: 0,
  conversionValue: 0,
  videoViews: 0,
  ...over,
});

describe('derivePaid', () => {
  it('computes ROAS, CPA, CTR, CPM and CPC', () => {
    const totals = sumPaid([
      paidRow({ spend: 1000, impressions: 100_000, clicks: 2000, conversions: 50, conversionValue: 4000 }),
    ]);
    const d = derivePaid(totals);
    expect(d.roas).toBeCloseTo(4);
    expect(d.cpa).toBeCloseTo(20);
    expect(d.ctr).toBeCloseTo(0.02);
    expect(d.cpm).toBeCloseTo(10);
    expect(d.cpc).toBeCloseTo(0.5);
    expect(d.conversionRate).toBeCloseTo(0.025);
  });

  it('never divides by zero', () => {
    const d = derivePaid(sumPaid([paidRow({})]));
    expect(d.roas).toBe(0);
    expect(d.cpa).toBe(0);
    expect(d.ctr).toBe(0);
  });
});

const organicRow = (over: Partial<OrganicDailyMetric>): OrganicDailyMetric => ({
  date: '2026-07-01',
  videoId: '00000000-0000-0000-0000-000000000000',
  views: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  watchTimeSec: 0,
  reach: 0,
  newFollowers: 0,
  ...over,
});

describe('deriveOrganic', () => {
  it('computes engagement rate and avg watch time', () => {
    const totals = sumOrganic([
      organicRow({ views: 1000, likes: 80, comments: 15, shares: 5, watchTimeSec: 12_000 }),
    ]);
    const d = deriveOrganic(totals);
    expect(d.engagementRate).toBeCloseTo(0.1);
    expect(d.avgWatchTimeSec).toBeCloseTo(12);
  });
});

describe('deltaPct', () => {
  it('returns a fraction', () => {
    expect(deltaPct(125, 100)).toBeCloseTo(0.25);
    expect(deltaPct(80, 100)).toBeCloseTo(-0.2);
  });
  it('returns null with no baseline', () => {
    expect(deltaPct(50, 0)).toBeNull();
    expect(deltaPct(0, 0)).toBe(0);
  });
});
