import { describe, expect, it } from 'vitest';
import { METRICS, type MetricDef, type MetricKey } from './catalog.js';

/**
 * Brief Deck PRD §3.4 turns "Wajib Bahasa Manusia" from an aspiration into a
 * build failure. Two rules are CI-enforced here:
 *
 *   1. Every pickable metric has a non-empty `labelId`.
 *   2. No `labelId` is a `MetricKey` — a raw key reaching a slide is the
 *      specific failure this rule exists to prevent.
 *
 * The band checks are the same idea applied to grading: a threshold that
 * contradicts its metric's direction would paint a red tile green, which is
 * worse than no light at all.
 */

const entries = Object.entries(METRICS) as Array<[MetricKey, MetricDef]>;

describe('metric catalog', () => {
  it.each(entries)('%s: record key matches its own `key` field', (key, def) => {
    expect(def.key).toBe(key);
  });

  it.each(entries)('%s: has a non-empty Bahasa labelId', (_key, def) => {
    expect(def.labelId.trim().length).toBeGreaterThan(0);
  });

  it('never lets a MetricKey be a label', () => {
    const keys = new Set(Object.keys(METRICS));
    for (const [key, def] of entries) {
      expect(keys.has(def.labelId), `${key} labels itself with a metric key`).toBe(false);
    }
  });

  it('keeps labelIds unique so two tiles cannot read identically', () => {
    const seen = new Map<string, MetricKey>();
    for (const [key, def] of entries) {
      const clash = seen.get(def.labelId);
      expect(clash, `${key} and ${clash} share the label "${def.labelId}"`).toBeUndefined();
      seen.set(def.labelId, key);
    }
  });

  it.each(entries)('%s: bands agree with the metric direction', (key, def) => {
    if (!def.bands) return;
    for (const [objective, band] of Object.entries(def.bands)) {
      if (!band) continue;
      if (def.goodDirection === 'up') {
        expect(band.green, `${key}/${objective}`).toBeGreaterThan(band.yellow);
      } else if (def.goodDirection === 'down') {
        expect(band.green, `${key}/${objective}`).toBeLessThan(band.yellow);
      } else {
        throw new Error(
          `${key} has bands but no good direction — a neutral metric cannot be graded ` +
            'by threshold; give it a per-client target instead',
        );
      }
    }
  });

  it('marks organic metrics as not pickable while no organic day-grain rollup exists', () => {
    // Not a judgement about the metrics — `getDailyBriefDashboard` is paid-only,
    // so an organic tile would have nothing to print. M4 revisits this with the
    // video work; until then the picker cannot offer a tile it cannot fill.
    //
    // `reach` is the single documented exception: it is surfaced as organic but
    // TikTok reports it for paid delivery too, and the brief window does read
    // it. Listed here explicitly so the exception is a decision on the record
    // rather than a hole in the rule.
    const DUAL_SURFACE: MetricKey[] = ['reach'];
    for (const [key, def] of entries) {
      if (def.surface === 'organic' && !DUAL_SURFACE.includes(key)) {
        expect(def.pickerVisible, `${key} is organic but offered in the picker`).toBe(false);
      }
    }
  });
});

describe('Market Scope keys (Strategy Report PRD §6.5, P0 corrections)', () => {
  const ttms = entries.filter(([, def]) => def.surface === 'market_scope');
  const keys = ttms.map(([key]) => key as string);

  it('generates exactly the expected families', () => {
    expect(keys.filter((k) => k.startsWith('ttms.audience.') && !k.endsWith('size_ratio'))).toHaveLength(16);
    expect(keys.filter((k) => k.endsWith('.size_ratio'))).toEqual([
      'ttms.audience.awareness.size_ratio',
      'ttms.audience.consideration.size_ratio',
    ]);
    expect(keys.filter((k) => /^ttms\.[a-z0-9_]+$/.test(k) && k !== 'ttms.halo_ratio')).toHaveLength(11);
    expect(keys.filter((k) => /^ttms\.[a-z0-9_]+\.share$/.test(k))).toHaveLength(10);
    expect(keys.filter((k) => k.startsWith('ttms.impressions.share.'))).toHaveLength(9);
    expect(keys.filter((k) => k.startsWith('strategy.'))).toEqual([
      'strategy.cost_per_1k_new.awareness',
      'strategy.cost_per_1k_new.consideration',
      'strategy.spend_cap_daily',
    ]);
    expect(ttms).toHaveLength(16 + 2 + 11 + 10 + 9 + 1 + 3);
  });

  it('carries none of the keys P0 showed the data cannot support', () => {
    // move_on_rate → size_ratio (P0 §6.2); per-metric insight rank is never
    // stored (P0 §2); Conversion has no daily flow to cost (P0 §6.3).
    expect(keys.some((k) => k.includes('move_on'))).toBe(false);
    expect(keys.filter((k) => /^ttms\.[a-z0-9_]+\.rank$/.test(k))).toEqual([]);
    expect(keys).not.toContain('strategy.cost_per_1k_new.conversion');
    expect(keys).not.toContain('ttms.nsr.share');
  });

  it('never stacks content types: their shares are neutral, not "more is better"', () => {
    for (const [key, def] of ttms) {
      if (key.startsWith('ttms.impressions.share.')) expect(def.goodDirection, key).toBe('neutral');
    }
  });

  it('keeps every Market Scope key out of the deck picker', () => {
    for (const [key, def] of ttms) expect(def.pickerVisible, key).toBe(false);
  });

  it('ranks read lower-is-better and format as #n', () => {
    for (const [key, def] of ttms) {
      if (key.endsWith('.rank')) {
        expect(def.format, key).toBe('rank');
        expect(def.goodDirection, key).toBe('down');
      }
    }
  });
});
