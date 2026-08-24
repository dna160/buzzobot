import { BriefObjective, METRICS, type MetricKey } from '@tempo/core';
import { describe, expect, it } from 'vitest';
import {
  OBJECTIVE_METRICS,
  REPORT_SPEC_PRESETS,
  ReportSpecObjectiveError,
  defaultReportSpec,
  disallowedMetrics,
  parseReportSpec,
  resolveReportSpec,
} from './spec.js';

const OBJECTIVES = [BriefObjective.Awareness, BriefObjective.Gmv, BriefObjective.Install];

describe('ReportSpec', () => {
  it('rejects an awareness spec that reaches for GMV metrics with a 422', () => {
    const spec = {
      version: 1,
      preset: 'custom',
      metrics: ['impressions', 'reach', 'roas', 'conversionValue'],
    };
    try {
      parseReportSpec(spec, BriefObjective.Awareness);
      throw new Error('expected a ReportSpecObjectiveError');
    } catch (error) {
      expect(error).toBeInstanceOf(ReportSpecObjectiveError);
      expect((error as ReportSpecObjectiveError).status).toBe(422);
      expect((error as ReportSpecObjectiveError).offending).toEqual(['roas', 'conversionValue']);
    }
  });

  it('rejects a target for a metric the objective cannot show', () => {
    const spec = {
      version: 1,
      preset: 'custom',
      metrics: ['impressions', 'reach', 'vtr6s'],
      targets: { roas: 3 },
    };
    expect(() => parseReportSpec(spec, BriefObjective.Awareness)).toThrow(ReportSpecObjectiveError);
  });

  it('rejects a spec below three metrics — the grid has no smaller honest layout', () => {
    expect(() =>
      parseReportSpec(
        { version: 1, preset: 'custom', metrics: ['impressions', 'reach'] },
        BriefObjective.Awareness,
      ),
    ).toThrow();
  });

  it('defaults the appendix with the internal layer off (D4)', () => {
    const spec = parseReportSpec(
      { version: 1, preset: 'views', metrics: ['impressions', 'reach', 'vtr6s'] },
      BriefObjective.Awareness,
    );
    expect(spec.appendix).toEqual({ rawTable: true, allVideos: true, internal: false });
  });

  it.each(OBJECTIVES)('%s: its own preset validates against its own objective', (objective) => {
    expect(() => parseReportSpec(defaultReportSpec(objective), objective)).not.toThrow();
  });

  it.each(OBJECTIVES)('%s: allowed metrics all exist in the catalog', (objective) => {
    for (const key of OBJECTIVE_METRICS[objective]) {
      expect(METRICS[key], `${key} is allowed for ${objective} but not in the catalog`).toBeDefined();
    }
  });

  it.each(OBJECTIVES)('%s: every allowed metric is pickable', (objective) => {
    // An allowed metric that no picker can offer and no tile can fill would be
    // a promise the deck cannot keep.
    for (const key of OBJECTIVE_METRICS[objective]) {
      expect(METRICS[key].pickerVisible, `${key} allowed for ${objective} but not pickable`).toBe(
        true,
      );
    }
  });

  it('keeps awareness free of every outcome and revenue metric', () => {
    const forbidden: MetricKey[] = ['roas', 'conversionValue', 'conversions', 'cpa', 'conversionRate'];
    for (const key of forbidden) {
      expect(OBJECTIVE_METRICS[BriefObjective.Awareness]).not.toContain(key);
    }
  });

  it('keeps revenue out of the install objective — Tempo has no install revenue column', () => {
    expect(OBJECTIVE_METRICS[BriefObjective.Install]).not.toContain('roas');
    expect(OBJECTIVE_METRICS[BriefObjective.Install]).not.toContain('conversionValue');
  });

  it.each(Object.entries(REPORT_SPEC_PRESETS))('preset %s has enough metrics to tile', (_name, metrics) => {
    expect(metrics.length).toBeGreaterThanOrEqual(6);
  });
});

describe('resolveReportSpec()', () => {
  it('falls back to the objective preset when nothing is stored', () => {
    expect(resolveReportSpec(null, BriefObjective.Gmv)).toEqual(defaultReportSpec(BriefObjective.Gmv));
  });

  it('falls back — and reports — rather than failing the export on a stale spec', () => {
    let reported: unknown = null;
    const stale = { version: 1, preset: 'jualan', metrics: ['roas', 'conversions', 'spend'] };

    const resolved = resolveReportSpec(stale, BriefObjective.Awareness, (e) => {
      reported = e;
    });

    expect(resolved).toEqual(defaultReportSpec(BriefObjective.Awareness));
    expect(reported).toBeInstanceOf(ReportSpecObjectiveError);
  });
});

describe('disallowedMetrics()', () => {
  it('returns an empty list for a conforming spec', () => {
    expect(disallowedMetrics(defaultReportSpec(BriefObjective.Gmv), BriefObjective.Gmv)).toEqual([]);
  });
});
