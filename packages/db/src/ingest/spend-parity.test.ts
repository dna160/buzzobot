import { describe, expect, it } from 'vitest';
import { compareSpend, defaultParityWindow, type ClientSpend, type SourceSpend } from './spend-parity.js';

const client = (slug: string, tempo: number, adAccountIds = [slug]): ClientSpend => ({
  clientId: slug,
  slug,
  adAccountIds,
  tempo,
});
const src = (cost: number, cash: number, gmvMax: number, usdDays = 0): SourceSpend => ({ cost, cash, gmvMax, usdDays });

describe('compareSpend', () => {
  it("fails BARDI as it was before the fix: GMV Max missing from Tempo", () => {
    // 28 days to 10 Oct 2026, from P0_DISCOVERY.md §5.
    const [r] = compareSpend([client('bardi', 11_109_092)], new Map([['bardi', src(11_109_092, 5_807_887, 37_487_472)]]));
    expect(r!.ok).toBe(false);
    expect(r!.sourceGross).toBe(48_596_564);
    expect(r!.portalCost).toBe(43_295_359);
    expect(r!.diffPct).toBeCloseTo(-0.7714, 4);
  });

  it('passes BARDI once GMV Max is booked, and reports credits without failing on them', () => {
    const [r] = compareSpend([client('bardi', 48_596_564)], new Map([['bardi', src(11_109_092, 5_807_887, 37_487_472)]]));
    expect(r!.ok).toBe(true);
    expect(r!.credits).toBe(5_301_205);
  });

  it('passes the 0.006% product-campaign vs analytics noise (Evedaily)', () => {
    const [r] = compareSpend([client('eve', 823_140_966)], new Map([['eve', src(798_375, 784_384, 822_390_644)]]));
    expect(r!.ok).toBe(true);
  });

  it('sums every ad account of a multi-account client', () => {
    const [r] = compareSpend(
      [client('kanzler', 300, ['a', 'b'])],
      new Map([
        ['a', src(100, 100, 0)],
        ['b', src(50, 40, 150)],
      ]),
    );
    expect(r!.sourceGross).toBe(300);
    expect(r!.portalCost).toBe(290);
    expect(r!.ok).toBe(true);
  });

  it('passes two zeros and flags Tempo spend with no source', () => {
    const rows = compareSpend([client('dormant', 0), client('orphan', 5_000)], new Map());
    expect(rows.map((r) => [r.slug, r.ok, r.diffPct])).toEqual([
      ['dormant', true, null],
      ['orphan', false, null],
    ]);
  });

  it('honours a custom tolerance', () => {
    const rows = compareSpend([client('x', 1_010_000)], new Map([['x', src(1_000_000, 1_000_000, 0)]]), 0.02);
    expect(rows[0]!.ok).toBe(true);
  });
});

describe('defaultParityWindow', () => {
  it('is 28 days ending 3 days before today, UTC', () => {
    expect(defaultParityWindow(new Date('2026-10-21T02:00:00+07:00'))).toEqual({ from: '2026-09-20', to: '2026-10-17' });
  });
});
