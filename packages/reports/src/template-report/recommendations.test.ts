import { describe, expect, it } from 'vitest';
import { rankSources, type PerformanceSource } from './breakdown.js';
import { buildRecommendations, proposeFunnelAllocation, type RecommendationInput } from './recommendations.js';
import type { FunnelStage } from './rubric.js';

const money = (n: number): string => `Rp${Math.round(n / 1000)}rb`;
const RANGES: Record<FunnelStage, [number, number]> = {
  awareness: [0.15, 0.35],
  consideration: [0.1, 0.25],
  conversion: [0.4, 0.6],
};

const base = (over: Partial<RecommendationInput> = {}): RecommendationInput => ({
  money,
  funnel: { spendByStage: { awareness: 25_000_000, consideration: 15_000_000, conversion: 60_000_000 }, ranges: RANGES },
  metrics: [],
  creatives: [],
  ...over,
});

const src = (name: string, spend: number, output: number): PerformanceSource => ({ name, channel: 'GMV Max', spend, output });

describe('proposeFunnelAllocation', () => {
  it('leaves an in-range split untouched', () => {
    const pct = { awareness: 0.25, consideration: 0.15, conversion: 0.6 };
    const p = proposeFunnelAllocation(pct, RANGES);
    for (const s of ['awareness', 'consideration', 'conversion'] as const) expect(p[s]).toBeCloseTo(pct[s], 9);
  });

  it('pulls an out-of-range split into range while keeping the total at 100%', () => {
    const p = proposeFunnelAllocation({ awareness: 0.05, consideration: 0.1, conversion: 0.85 }, RANGES);
    expect(p.awareness + p.consideration + p.conversion).toBeCloseTo(1, 9);
    for (const s of ['awareness', 'consideration', 'conversion'] as const) {
      expect(p[s]).toBeGreaterThanOrEqual(RANGES[s][0] - 1e-9);
      expect(p[s]).toBeLessThanOrEqual(RANGES[s][1] + 1e-9);
    }
    expect(p.conversion).toBeLessThan(0.85);
    expect(p.awareness).toBeGreaterThan(0.05);
  });
});

describe('buildRecommendations', () => {
  it('moves budget from the weakest source to the strongest, with an amount and a conservative estimate', () => {
    const ranking = rankSources([
      src('Winner', 40_000_000, 400_000_000), // ROI 10
      src('Okay', 40_000_000, 160_000_000), // ROI 4
      src('Loser', 20_000_000, 10_000_000), // ROI 0.5
    ]);
    const out = buildRecommendations(
      base({
        sources: {
          ranking,
          outputLabel: 'Revenue',
          efficiencyLabel: 'ROI',
          fmt: { money, output: money, efficiency: (v) => `${v.toFixed(1)}x` },
          isCritical: (d) => d.efficiency < 1,
        },
      }),
    );
    const move = out.rows.find((r) => r.area.startsWith('Realokasi'));
    expect(move).toBeDefined();
    expect(move?.prioritas).toBe('P1'); // donor loses money (ROI < 1)
    expect(move?.langkah).toContain('Loser');
    expect(move?.langkah).toContain('Winner');
    expect(move?.alokasi).toMatch(/Geser ±Rp/);
    expect(move?.target).toMatch(/indikatif/);
  });

  it('does not recommend a move when no source is meaningfully better than another', () => {
    const ranking = rankSources([src('a', 100_000_000, 400_000_000), src('b', 100_000_000, 410_000_000)]);
    const out = buildRecommendations(
      base({
        sources: { ranking, outputLabel: 'Revenue', efficiencyLabel: 'ROI', fmt: { money, output: money, efficiency: (v) => `${v}x` } },
      }),
    );
    expect(out.rows.some((r) => r.area.startsWith('Realokasi'))).toBe(false);
  });

  it('rebalances an out-of-range funnel and proposes the same total budget', () => {
    const out = buildRecommendations(
      base({ funnel: { spendByStage: { awareness: 5_000_000, consideration: 10_000_000, conversion: 85_000_000 }, ranges: RANGES } }),
    );
    const row = out.rows.find((r) => r.area === 'Alokasi Budget Funnel');
    expect(row).toBeDefined();
    expect(row?.alokasi).toContain('Total budget tetap');
    expect(out.funnelPlan).toHaveLength(3);
    expect(out.funnelPlan.find((p) => p.stage.startsWith('Conversion'))?.perubahan).toMatch(/^−/);
    expect(out.funnelPlan.find((p) => p.stage.startsWith('Awareness'))?.perubahan).toMatch(/^\+/);
  });

  it('keeps an in-range funnel as is', () => {
    const out = buildRecommendations(base());
    expect(out.rows.some((r) => r.area === 'Alokasi Budget Funnel')).toBe(false);
    expect(out.funnelPlan.every((p) => p.perubahan === 'Tetap')).toBe(true);
    expect(out.funnelPlanNote).toMatch(/pertahankan/i);
  });

  it('turns weak benchmark metrics into a playbook action with a target, P1 for Kritis', () => {
    const out = buildRecommendations(
      base({
        metrics: [
          { key: 'conversion:roi', label: 'ROI', section: 'Conversion', status: 'Baik', scored: true, actual: '9.6x', benchmark: '6.8x', gap: '+41%', higherIsBetter: true },
          { key: 'conversion:cvr', label: 'CVR', section: 'Conversion', status: 'Kritis', scored: true, actual: '6.9%', benchmark: '64.4%', gap: '-89%', higherIsBetter: true },
          { key: 'consideration:cost_per_atc', label: 'Cost per Add to Cart', section: 'Consideration', status: 'Waspada', scored: false, actual: 'n/a', benchmark: 'belum diatur', gap: '—', higherIsBetter: false },
        ],
      }),
    );
    const conv = out.rows.find((r) => r.area === 'Conversion');
    expect(conv?.prioritas).toBe('P1');
    expect(conv?.langkah).toContain('CVR');
    expect(conv?.target).toContain('CVR ≥ 64.4%');
    // an unscored metric must not generate advice
    expect(out.rows.some((r) => r.area === 'Consideration')).toBe(false);
  });

  it('flags underperforming creatives (refresh) and winning ones (scale)', () => {
    const out = buildRecommendations(
      base({
        creatives: [
          { name: 'Hook A', status: 'Winning' },
          { name: 'Hook B', status: 'Underperform' },
        ],
      }),
    );
    const creative = out.rows.filter((r) => r.area === 'Creative');
    expect(creative.map((r) => r.prioritas).sort()).toEqual(['P2', 'P3']);
  });

  it('orders by priority and is fully deterministic', () => {
    const mk = (): RecommendationInput => base({
      funnel: { spendByStage: { awareness: 5_000_000, consideration: 10_000_000, conversion: 85_000_000 }, ranges: RANGES },
      metrics: [
        { key: 'awareness:cpm', label: 'CPM', section: 'Awareness', status: 'Waspada', scored: true, actual: '7Rb', benchmark: '6Rb', gap: '+10%', higherIsBetter: false },
        { key: 'conversion:cvr', label: 'CVR', section: 'Conversion', status: 'Kritis', scored: true, actual: '1%', benchmark: '5%', gap: '-80%', higherIsBetter: true },
      ],
      creatives: [{ name: 'A', status: 'Winning' }],
    });
    const a = buildRecommendations(mk());
    const b = buildRecommendations(mk());
    expect(a).toEqual(b);
    const order = a.rows.map((r) => r.prioritas);
    expect(order).toEqual([...order].sort());
  });

  it('says there is nothing to judge, rather than "all good", when the period has no spend', () => {
    const out = buildRecommendations(
      base({ funnel: { spendByStage: { awareness: 0, consideration: 0, conversion: 0 }, ranges: RANGES } }),
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]?.area).toBe('Data Periode');
    expect(out.rows[0]?.langkah).toMatch(/Tidak ada spend/);
    expect(out.rows[0]?.prioritas).toBe('P1');
  });

  it('never returns an empty table', () => {
    const out = buildRecommendations(base());
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.rows[0]?.area).toBe('Keseluruhan');
  });

  it('caps the table at 8 rows', () => {
    const metrics = Array.from({ length: 12 }, (_, i) => ({
      key: `x:${i}`,
      label: `M${i}`,
      section: `Section ${i}`,
      status: 'Waspada' as const,
      scored: true,
      actual: '1',
      benchmark: '2',
      gap: '-50%',
      higherIsBetter: true,
    }));
    expect(buildRecommendations(base({ metrics })).rows.length).toBeLessThanOrEqual(8);
  });
});
