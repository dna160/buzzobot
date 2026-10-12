import { describe, expect, it } from 'vitest';
import { buildSourceBreakdown, rankSources, type PerformanceSource } from './breakdown.js';

const src = (name: string, spend: number, output: number, channel = 'GMV Max'): PerformanceSource => ({
  name,
  channel,
  spend,
  output,
});

/** n sources with strictly decreasing efficiency (ROI n, n-1, … 1) and equal spend. */
const ladder = (n: number): PerformanceSource[] =>
  Array.from({ length: n }, (_, i) => src(`S${i + 1}`, 100, (n - i) * 100));

describe('rankSources', () => {
  it('gives a clean top 3 / bottom 3 with 6 or more sources, worst source first in the bottom', () => {
    const r = rankSources(ladder(8));
    expect(r.top.map((s) => s.name)).toEqual(['S1', 'S2', 'S3']);
    expect(r.bottom.map((s) => s.name)).toEqual(['S8', 'S7', 'S6']);
  });

  it.each([
    [6, 3, 3],
    [5, 3, 2],
    [4, 2, 2],
    [3, 2, 1],
    [2, 1, 1],
    [1, 1, 0],
  ])('with %i sources splits %i top / %i bottom, never listing one twice', (n, top, bottom) => {
    const r = rankSources(ladder(n));
    expect(r.top).toHaveLength(top);
    expect(r.bottom).toHaveLength(bottom);
    const names = [...r.top, ...r.bottom].map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('skips sources too small to judge, but keeps them in the totals', () => {
    const r = rankSources([src('big', 1000, 5000), src('mid', 1000, 1000), src('tiny', 5, 5000)]);
    expect(r.skippedCount).toBe(1);
    expect([...r.top, ...r.bottom].map((s) => s.name)).not.toContain('tiny');
    expect(r.totals.spend).toBe(2005);
  });

  it('ignores sources with no spend', () => {
    const r = rankSources([src('live', 100, 300), src('dead', 0, 0)]);
    expect(r.all.map((s) => s.name)).toEqual(['live']);
  });

  it('ranks a source that produced nothing last', () => {
    const r = rankSources([src('a', 100, 500), src('b', 100, 300), src('zero', 100, 0)]);
    expect(r.bottom[0]?.name).toBe('zero');
    expect(r.bottom[0]?.efficiency).toBe(0);
  });

  it('makes every sources impact on the blended number sum to zero', () => {
    const r = rankSources(ladder(7));
    const total = r.all.reduce((a, s) => a + s.impact, 0);
    expect(Math.abs(total)).toBeLessThan(1e-9);
    expect(r.top[0]!.impact).toBeGreaterThan(0);
    expect(r.bottom[0]!.impact).toBeLessThan(0);
  });

  it('is deterministic — ties break by spend, then name', () => {
    const tied = [src('b', 100, 200), src('a', 100, 200), src('c', 200, 400)];
    const first = rankSources(tied).all.map((s) => s.name);
    const second = rankSources([...tied].reverse()).all.map((s) => s.name);
    expect(first).toEqual(second);
    expect(first).toEqual(['c', 'a', 'b']);
  });

  it('copes with nothing at all', () => {
    const r = rankSources([]);
    expect(r.top).toEqual([]);
    expect(r.bottom).toEqual([]);
    expect(r.blended).toBeNull();
  });
});

describe('buildSourceBreakdown', () => {
  const fmt = {
    money: (n: number) => `Rp${n}`,
    output: (n: number) => `${n}`,
    efficiency: (v: number) => `${v.toFixed(2)}x`,
    impact: (r: { impact: number }) => r.impact.toFixed(2),
  };
  const build = (sources: PerformanceSource[]) =>
    buildSourceBreakdown({
      title: 't',
      intro: 'i',
      outputLabel: 'Revenue',
      efficiencyLabel: 'ROI',
      impactLabel: 'Dampak',
      sources,
      fmt,
    }).model;

  it('labels rows TOP n / BOTTOM n and tones them', () => {
    const m = build(ladder(6));
    expect(m.rows.map((r) => r.peringkat)).toEqual(['TOP 1', 'TOP 2', 'TOP 3', 'BOTTOM 1', 'BOTTOM 2', 'BOTTOM 3']);
    expect(m.rows[0]?.tone).toBe('top');
    expect(m.rows[3]?.tone).toBe('bottom');
    expect(m.rows[0]?.dampakTone).toBe('lift');
    expect(m.rows[3]?.dampakTone).toBe('drag');
  });

  it('explains the adjusted split when there are fewer than 6 sources', () => {
    const m = build(ladder(4));
    expect(m.notes.join(' ')).toMatch(/Hanya 4 sumber/);
    expect(m.notes.join(' ')).toMatch(/2 teratas/);
    expect(m.notes.join(' ')).toMatch(/2 terbawah/);
  });

  it('with fewer than 6 sources only calls a source TOP if it lifts the average and BOTTOM if it drags it', () => {
    // Skewed: two very efficient sources and three poor ones. Splitting by count
    // (3 top / 2 bottom) would have labelled a poor source "TOP".
    const m = build([
      src('great', 100, 1000),
      src('good', 100, 800),
      src('poor1', 100, 50),
      src('poor2', 100, 40),
      src('poor3', 100, 10),
    ]);
    expect(m.rows.filter((r) => r.tone === 'top').map((r) => r.sumber)).toEqual(['great', 'good']);
    expect(m.rows.filter((r) => r.tone === 'bottom').map((r) => r.sumber)).toEqual(['poor3', 'poor2', 'poor1']);
    expect(m.rows.filter((r) => r.tone === 'top').every((r) => r.dampakTone === 'lift')).toBe(true);
    expect(m.rows.filter((r) => r.tone === 'bottom').every((r) => r.dampakTone === 'drag')).toBe(true);
  });

  it('adds a subtotal row and any extra summary rows', () => {
    const m = buildSourceBreakdown({
      title: 't',
      intro: 'i',
      outputLabel: 'Revenue',
      efficiencyLabel: 'ROI',
      impactLabel: 'D',
      sources: ladder(3),
      fmt,
      extraSummaryRows: [{ label: 'Total', spend: 'x', output: 'y', efisiensi: 'z' }],
    }).model;
    expect(m.summaryRows.map((r) => r.label)).toEqual(['Subtotal semua sumber yang dinilai', 'Total']);
  });
});
