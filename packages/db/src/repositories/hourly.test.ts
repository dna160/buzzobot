import { describe, expect, it } from 'vitest';
import { parseHourlyExport } from '@tempo/tiktok';

/**
 * These pin the two rules the hourly read-model depends on, at the boundary
 * where they are cheapest to verify: the parser's bucket output. The read-model
 * itself is exercised end-to-end against the seeded database.
 */

function csv(series: Record<string, number[]>, adgroupId = '') {
  const cols = ['campaign_id', 'date', 'adgroup_id', 'metrics'];
  for (let h = 0; h <= 24; h += 1) {
    cols.push(`h${String(h).padStart(2, '0')}`);
    if (h < 24) cols.push(`d${String(h).padStart(2, '0')}`);
  }
  cols.push('campaign_name', 'adgroup_name');
  const lines = [cols.join(',')];
  for (const [metric, cum] of Object.entries(series)) {
    const cells = ['C1', '2026-07-18', `"${adgroupId}"`, metric];
    for (let h = 0; h <= 24; h += 1) {
      cells.push(String(cum[h] ?? 0));
      if (h < 24) cells.push(String((cum[h] ?? 0) - (h === 0 ? 0 : (cum[h - 1] ?? 0))));
    }
    cells.push('Camp', adgroupId ? 'AG' : '');
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}

describe('hourly aggregation rules', () => {
  it('derives CTR from summed totals, not by averaging hourly ratios', () => {
    // Hour 1: 1 click / 10 impressions = 10% CTR
    // Hour 2: 9 clicks / 990 impressions ≈ 0.91% CTR
    // Mean of ratios ≈ 5.45%; true pooled CTR = 10/1000 = 1%.
    const { buckets } = parseHourlyExport(
      csv({ impressions: [0, 10, 1000], clicks: [0, 1, 10] }),
    );
    const totalClicks = buckets.reduce((s, b) => s + b.clicks, 0);
    const totalImpr = buckets.reduce((s, b) => s + b.impressions, 0);
    const pooled = totalClicks / totalImpr;

    const meanOfRatios =
      buckets.reduce((s, b) => s + (b.impressions ? b.clicks / b.impressions : 0), 0) /
      buckets.length;

    expect(pooled).toBeCloseTo(0.01, 6);
    expect(meanOfRatios).toBeGreaterThan(0.05);
    // The read-model must use the pooled figure.
    expect(pooled).not.toBeCloseTo(meanOfRatios, 3);
  });

  it('separates aggregated first buckets from true hours', () => {
    const cum = Array(25).fill(0);
    cum[20] = 1_000_000;
    cum[21] = 1_100_000;
    const { buckets } = parseHourlyExport(csv({ spend: cum }));

    const trueHours = buckets.filter((b) => b.spanHours === 1);
    const aggregated = buckets.filter((b) => b.spanHours > 1);

    expect(aggregated).toHaveLength(1);
    expect(trueHours).toHaveLength(1);
    // Day total must still reconcile across both.
    expect(buckets.reduce((s, b) => s + b.spend, 0)).toBe(1_100_000);
    // But the hourly series must not include the 1M lump.
    expect(trueHours[0]!.spend).toBe(100_000);
  });

  it('keeps campaign rollup and adgroup rows as parallel decompositions', () => {
    const head = csv({ spend: [0, 100, 200] });
    const tail = csv({ spend: [0, 40, 80] }, 'A1').split('\n').slice(1).join('\n');
    const { buckets } = parseHourlyExport(`${head}\n${tail}`);

    const rollupSpend = buckets
      .filter((b) => b.adgroupExternalId === null)
      .reduce((s, b) => s + b.spend, 0);
    const adgroupSpend = buckets
      .filter((b) => b.adgroupExternalId !== null)
      .reduce((s, b) => s + b.spend, 0);

    // Summing both levels together would double-count; they must stay separate.
    expect(rollupSpend).toBe(200);
    expect(adgroupSpend).toBe(80);
    expect(rollupSpend + adgroupSpend).not.toBe(rollupSpend);
  });
});
