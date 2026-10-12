import { BENCHMARK_LAYOUT, type NorthStar } from '@tempo/core';
import { describe, expect, it } from 'vitest';
import { buildLegend, METRIC_LEGEND } from './legend.js';

const TEMPLATES: NorthStar[] = ['shop', 'vtr', 'app_install'];

describe('buildLegend', () => {
  it.each(TEMPLATES)('defines every benchmark metric the %s template can show', (template) => {
    const terms = buildLegend(template).flatMap((g) => g.entries.map((e) => e.term));
    for (const section of BENCHMARK_LAYOUT[template]) {
      for (const m of section.metrics) {
        const entry = METRIC_LEGEND[m.metric];
        expect(entry, `${template}: no legend entry for metric "${m.metric}"`).toBeDefined();
        expect(terms).toContain(entry!.term);
      }
    }
  });

  it.each(TEMPLATES)('lists each term once and gives every entry a definition (%s)', (template) => {
    const entries = buildLegend(template).flatMap((g) => g.entries);
    const terms = entries.map((e) => e.term);
    expect(new Set(terms).size).toBe(terms.length);
    for (const e of entries) expect(e.definition.length).toBeGreaterThan(10);
  });

  it('always explains statuses, the data sources and the units', () => {
    for (const template of TEMPLATES) {
      const text = JSON.stringify(buildLegend(template));
      expect(text).toContain('Kritis (merah)');
      expect(text).toContain('TTAM');
      expect(text).toContain('GMV Max');
      expect(text).toContain('Satuan angka');
    }
  });

  it('only defines terms that belong to the template', () => {
    const shop = JSON.stringify(buildLegend('shop'));
    const install = JSON.stringify(buildLegend('app_install'));
    expect(shop).toContain('ROI / ROAS');
    expect(shop).not.toContain('CPI (Cost per Install)');
    expect(install).toContain('CPI (Cost per Install)');
    expect(install).not.toContain('ROI / ROAS');
  });
});
