import { describe, expect, it } from 'vitest';
import { parseCsv, parseHourlyExport } from './parse.js';

/** Build a one-row CSV with a given cumulative spend series. */
function csvWith(
  series: Record<string, number[]>,
  opts: { adgroupId?: string; campaignId?: string; date?: string } = {},
) {
  const cols = ['campaign_id', 'date', 'adgroup_id', 'metrics'];
  for (let h = 0; h <= 24; h += 1) {
    cols.push(`h${String(h).padStart(2, '0')}`);
    if (h < 24) cols.push(`d${String(h).padStart(2, '0')}`);
  }
  cols.push('campaign_name', 'adgroup_name');

  const lines = [cols.join(',')];
  for (const [metric, cumulative] of Object.entries(series)) {
    const cells: string[] = [
      opts.campaignId ?? 'C1',
      opts.date ?? '2026-07-18',
      `"${opts.adgroupId ?? ''}"`,
      metric,
    ];
    for (let h = 0; h <= 24; h += 1) {
      cells.push(String(cumulative[h] ?? 0));
      if (h < 24) {
        const prev = h === 0 ? 0 : (cumulative[h - 1] ?? 0);
        cells.push(String((cumulative[h] ?? 0) - prev));
      }
    }
    cells.push('Test Campaign', opts.adgroupId ? 'Test Adgroup' : '');
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}

describe('parseCsv', () => {
  it('handles quoted empty fields and embedded commas', () => {
    const rows = parseCsv('a,b,c\n1,"","x,y"\n');
    expect(rows[1]).toEqual(['1', '', 'x,y']);
  });

  it('handles escaped double quotes', () => {
    const rows = parseCsv('a\n"say ""hi"""\n');
    expect(rows[1]).toEqual(['say "hi"']);
  });
});

describe('parseHourlyExport', () => {
  it('reconstructs per-hour deltas from the cumulative series', () => {
    // Spend accrues 100/hr from hour 1 through hour 4.
    const cumulative = [0, 100, 200, 300, 400];
    const { buckets } = parseHourlyExport(csvWith({ spend: cumulative }));

    expect(buckets.map((b) => b.hour)).toEqual([1, 2, 3, 4]);
    expect(buckets.map((b) => b.spend)).toEqual([100, 100, 100, 100]);
  });

  it('marks the first bucket with the hours it absorbs', () => {
    // Nothing until hour 20, which then reports the whole day at once.
    const cumulative = Array(25).fill(0);
    cumulative[20] = 38_747_246;
    cumulative[21] = 41_162_204;

    const { buckets } = parseHourlyExport(csvWith({ spend: cumulative }));

    const first = buckets.find((b) => b.hour === 20)!;
    const second = buckets.find((b) => b.hour === 21)!;
    // Hour 20 stands in for hours 0..20 — 21 hours, not one.
    expect(first.spanHours).toBe(21);
    expect(first.spend).toBe(38_747_246);
    // The following hour is a genuine single hour.
    expect(second.spanHours).toBe(1);
    expect(second.spend).toBe(41_162_204 - 38_747_246);
  });

  it('treats a series starting at hour 0 as a true single hour', () => {
    const cumulative = [50, 150];
    const { buckets } = parseHourlyExport(csvWith({ spend: cumulative }));
    expect(buckets[0]!.spanHours).toBe(1);
    expect(buckets[0]!.spend).toBe(50);
  });

  it('emits no rows past the last synced hour rather than zero-filling', () => {
    // Sync stopped at hour 11 — hours 12..23 are unknown, not zero.
    const cumulative = Array(25).fill(0);
    for (let h = 1; h <= 11; h += 1) cumulative[h] = h * 1000;

    const { buckets, coverage } = parseHourlyExport(csvWith({ spend: cumulative }));

    expect(Math.max(...buckets.map((b) => b.hour))).toBe(11);
    expect(buckets).toHaveLength(11);
    expect(coverage[0]).toMatchObject({ firstHour: 1, lastHour: 11 });
  });

  it('preserves a genuine zero-spend hour in the middle of a day', () => {
    // Flat cumulative between hours 2 and 3 = a real hour with no spend.
    const cumulative = [0, 100, 200, 200, 300];
    const { buckets } = parseHourlyExport(csvWith({ spend: cumulative }));
    expect(buckets.find((b) => b.hour === 3)!.spend).toBe(0);
  });

  it('keeps campaign-level and adgroup-level rows separate', () => {
    const campaignCsv = csvWith({ spend: [0, 100, 200] });
    const adgroupCsv = csvWith({ spend: [0, 60, 120] }, { adgroupId: 'A1' })
      .split('\n')
      .slice(1)
      .join('\n');

    const { buckets, adgroups } = parseHourlyExport(`${campaignCsv}\n${adgroupCsv}`);

    const rollup = buckets.filter((b) => b.adgroupExternalId === null);
    const drill = buckets.filter((b) => b.adgroupExternalId === 'A1');
    expect(rollup).toHaveLength(2);
    expect(drill).toHaveLength(2);
    expect(adgroups).toEqual([
      { externalId: 'A1', name: 'Test Adgroup', campaignExternalId: 'C1' },
    ]);
  });

  it('ignores ratio metrics so they are never summed across hours', () => {
    const { buckets } = parseHourlyExport(csvWith({ spend: [0, 100], cpc: [0, 5], ctr: [0, 2] }));
    // Only spend is mapped; cpc/ctr must not leak into the bucket.
    expect(buckets[0]!.spend).toBe(100);
    expect(Object.values(buckets[0]!)).not.toContain(5);
  });

  it('never emits a negative hour from a non-monotonic blip', () => {
    const cumulative = [0, 100, 90, 150];
    const { buckets } = parseHourlyExport(csvWith({ spend: cumulative }));
    expect(buckets.every((b) => b.spend >= 0)).toBe(true);
  });
});
