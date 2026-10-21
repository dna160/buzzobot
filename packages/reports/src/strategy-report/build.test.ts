import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEngineContent } from '../deck/engine-content.js';
import { buildStrategyReportModel, NotAStrategyReportError, SECTION } from './build.js';
import { renderStrategyReportHtml } from './render.js';

/**
 * The renderer against real engine output: instant-tier runs of BARDI's frozen
 * 10 Oct 2026 frame (`tempo-engine/scripts/dump_strategy_content.py`), once per
 * class. A change to the engine's content shape fails here, not on a client's PDF.
 */

const load = (cls: 'shop' | 'brand') =>
  parseEngineContent(
    JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/engine-content.strategy.${cls}.json`, import.meta.url)), 'utf8')),
  ).content;

const ctx = { clientName: 'BARDI - TikTok', slug: 'bardi-tiktok', runId: 'run_fixture' };

describe('buildStrategyReportModel', () => {
  it('parses the engine fixture as v2 strategy content', () => {
    const c = load('shop');
    expect(c.brief_type).toBe('strategy');
    expect(c.action_plan).toHaveLength(3);
  });

  it('builds every section in the class order, T1/T2 at the head', () => {
    const m = buildStrategyReportModel(load('shop'), ctx);
    expect(m.sections.map((s) => s.id)).toEqual([103, 104, 106, 105, 107, 108, 109, 110]);
    expect(m.verdict.chips).toHaveLength(3);
    expect(m.meta).toMatchObject({ reportClass: 'shop', classLabel: 'Shop-heavy', plan: 'Lite', asOf: '2026-10-10' });
  });

  it('reorders and retitles T6 for the brand class (PRD §5.3)', () => {
    const shop = buildStrategyReportModel(load('shop'), ctx);
    const brand = buildStrategyReportModel(load('brand'), ctx);
    expect(brand.sections.map((s) => s.id)).toEqual([106, 103, 105, 104, 107, 108, 109, 110]);
    expect(shop.sections.find((s) => s.id === SECTION.T6)!.title).toBe('Konversi & product card');
    expect(brand.sections.find((s) => s.id === SECTION.T6)!.title).toBe('Share of Voice & peringkat');
    expect(brand.sections.find((s) => s.id === SECTION.T6)!.visual?.kind).toBe('ranklist');
    expect(brand.meta.classOverridden).toBe(true);
  });

  it('carries the solver numbers into the action rows untouched', () => {
    const [first] = buildStrategyReportModel(load('shop'), ctx).actions;
    expect(first).toMatchObject({ rank: 1, priority: 'P0', leverLabel: 'Penargetan tahap', confidenceLabel: 'Keyakinan sedang' });
    expect(first!.langkah).toContain('4,47%');
    expect(first!.langkah).toContain('9,47%');
    expect(first!.stake).toMatch(/orang/);
    expect(first!.sources).not.toMatch(/t0\d_|ttms\./); // plain language, never ids or keys
  });

  it('grades the funnel against the benchmark with light()', () => {
    const t3 = buildStrategyReportModel(load('shop'), ctx).sections.find((s) => s.id === SECTION.T3)!;
    expect(t3.visual?.kind).toBe('funnel');
    if (t3.visual?.kind !== 'funnel') return;
    const cons = t3.visual.bars.find((b) => b.stage === 'Consideration')!;
    expect(cons.ratio).toBeCloseTo(5801 / 129635, 6);
    expect(cons.light).toBe('red'); // 4.47% vs 15.68%
  });

  it('never draws a spend cap the engine did not find', () => {
    const t4 = buildStrategyReportModel(load('shop'), ctx).sections.find((s) => s.id === SECTION.T4)!;
    expect(t4.visual?.kind).toBe('spend');
    if (t4.visual?.kind === 'spend') expect(t4.visual.chart.showKnee).toBe(false); // BARDI R² ≈ 0
  });

  it('refuses non-strategy content', () => {
    const c = { ...load('shop'), brief_type: 'gmv' };
    expect(() => buildStrategyReportModel(c, ctx)).toThrow(NotAStrategyReportError);
  });
});

describe('renderStrategyReportHtml', () => {
  const html = renderStrategyReportHtml(buildStrategyReportModel(load('shop'), ctx));

  it('is an A4 Bahasa document', () => {
    expect(html).toContain('<html lang="id">');
    expect(html).toContain('size: A4');
    expect(html).toContain('Vonis minggu ini');
    expect(html).toContain('Keputusan minggu ini');
    expect(html).toContain('Lampiran A');
  });

  it('prints no internal identifiers or broken values', () => {
    expect(html).not.toMatch(/undefined|NaN|\[object Object\]/);
    expect(html).not.toMatch(/ttms\.audience|claim_frame|stage_leak/);
  });

  it('shows Lite-locked signals as locked rows and says which tier wrote it', () => {
    expect(html).toContain('Terkunci');
    expect(html).toContain('tier instan');
    expect(html).toContain('run run_fixture');
  });

  it('draws the charts inline', () => {
    expect((html.match(/<svg /g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
