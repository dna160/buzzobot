import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BriefObjective } from '@tempo/core';
import { describe, expect, it } from 'vitest';
import { buildDeckModel } from './build.js';
import { parseEngineContent } from './engine-content.js';
import { buildDashboardFixture } from './fixtures/dashboard.js';
import { SLIDE_HEIGHT_MM, SLIDE_WIDTH_MM, renderDeckHtml } from './render.js';
import { defaultReportSpec } from './spec.js';

/**
 * Structural goldens (PRD §9 item 4). These assert the properties a deck must
 * hold no matter what the analysis said — geometry, self-containment, escaping,
 * one slide per page — rather than pinning a byte-for-byte snapshot that any
 * copy change would break for no reason.
 */

const RAW = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/engine-content.gmv.instant.json', import.meta.url)),
    'utf8',
  ),
) as unknown;

function html(): string {
  const parsed = parseEngineContent(RAW);
  return renderDeckHtml(
    buildDeckModel({
      content: parsed.content,
      contentVersion: parsed.version,
      dashboard: buildDashboardFixture(),
      spec: defaultReportSpec(BriefObjective.Gmv),
      objective: BriefObjective.Gmv,
      runId: 'run_fixture_gmv_instant',
      tier: 'instant',
      generatedAt: '2026-08-17T02:00:00.000Z',
      windowDays: 7,
    }),
  );
}

describe('renderDeckHtml', () => {
  it('sets 16:9 landscape page geometry with no margin', () => {
    expect(html()).toContain(`@page { size: ${SLIDE_WIDTH_MM}mm ${SLIDE_HEIGHT_MM}mm; margin: 0; }`);
    expect(SLIDE_WIDTH_MM / SLIDE_HEIGHT_MM).toBeCloseTo(16 / 9, 3);
  });

  it('renders one page-breaking section per slide', () => {
    const doc = html();
    const sections = doc.match(/<section class="slide/g) ?? [];
    expect(sections).toHaveLength(7);
    expect(doc).toContain('break-after: page');
    expect(doc).toContain('break-inside: avoid');
  });

  it('is self-contained: no network request at render time', () => {
    const doc = html();
    expect(doc).not.toMatch(/<script/i);
    expect(doc).not.toMatch(/https?:\/\//);
    expect(doc).not.toMatch(/<link\b/i);
    expect(doc).not.toMatch(/<img\b/i);
  });

  it('draws charts as inline SVG', () => {
    expect(html()).toContain('<svg');
  });

  it('carries the tier badge on the cover and the provenance footer on every slide', () => {
    const doc = html();
    expect(doc).toContain('Ringkas');
    expect((doc.match(/class="footer"/g) ?? []).length).toBe(6); // every slide but the cover
    expect(doc).toContain('run_fixture_gmv_instant');
    expect(doc).toContain('Mesin analitik 0.1.0');
  });

  it('applies the client brand colour', () => {
    expect(html()).toContain('--brand: #7A3AA7');
  });

  it('prints Bahasa labels, never a metric key', () => {
    const doc = html();
    expect(doc).toContain('Omzet (GMV)');
    expect(doc).not.toMatch(/>conversionValue</);
    expect(doc).not.toMatch(/>vtr6s</);
  });

  it('escapes content that reaches it from the engine', () => {
    const parsed = parseEngineContent(RAW);
    const injected = structuredClone(parsed.content);
    // Both prose paths that actually render: the narrated section draft (which
    // only renders when an agent wrote it) and the per-finding card copy.
    injected.sections['2'] = {
      draft: {
        headline: '<script>alert(1)</script>',
        mechanism: 'a & b',
        evidence_refs: [],
        action: 'x',
        confidence: 'low',
      },
      narration_source: 'llm',
      narration_attempts: 1,
    };
    const firstFindingId = injected.findings[0]!.id;
    injected.card_copy[firstFindingId] = {
      headline: '<script>alert(2)</script>',
      mechanism: 'c & d',
      action: '<b>e</b>',
    };
    const doc = renderDeckHtml(
      buildDeckModel({
        content: injected,
        contentVersion: 2,
        dashboard: buildDashboardFixture(),
        spec: defaultReportSpec(BriefObjective.Gmv),
        objective: BriefObjective.Gmv,
        runId: 'r',
        tier: 'instant',
        generatedAt: '2026-08-17T02:00:00.000Z',
        windowDays: 7,
      }),
    );
    expect(doc).not.toContain('<script>alert(1)</script>');
    expect(doc).not.toContain('<script>alert(2)</script>');
    expect(doc).not.toContain('<b>e</b>');
    expect(doc).toContain('&lt;script&gt;');
    expect(doc).toContain('a &amp; b');
  });

  it('is stable — the same model renders identically', () => {
    expect(html()).toBe(html());
  });
});
