import { BriefObjective, METRICS, type MetricKey } from '@tempo/core';
import { describe, expect, it } from 'vitest';
import {
  addMetric,
  moveMetric,
  paletteFor,
  previewSpec,
  removeMetric,
  replaceMetric,
  setTarget,
} from './spec-editor.js';
import {
  MAX_SPEC_METRICS,
  MIN_SPEC_METRICS,
  OBJECTIVE_METRICS,
  defaultReportSpec,
  parseReportSpec,
  type ReportSpec,
} from './spec.js';

/**
 * M6's exit criterion (PRD §9): an AM builds, saves, and exports a custom spec
 * without code, and a slot swap re-renders correctly.
 *
 * The operations are tested rather than the UI, because the rule they enforce
 * is the product rule — an editor that could produce an unsavable spec would be
 * lying to the person using it, whatever the buttons look like.
 */

const gmv = () => defaultReportSpec(BriefObjective.Gmv);
const awareness = () => defaultReportSpec(BriefObjective.Awareness);

describe('paletteFor', () => {
  it('offers only metrics this objective is allowed to show', () => {
    const offered = paletteFor(BriefObjective.Awareness).flatMap((g) => g.entries.map((e) => e.metric));
    expect(offered).not.toContain('roas');
    expect(offered).not.toContain('conversionValue');
    expect(offered).toContain('vtr6s');
  });

  it('never offers a metric that nothing can fill', () => {
    for (const objective of [BriefObjective.Awareness, BriefObjective.Gmv, BriefObjective.Install]) {
      for (const group of paletteFor(objective)) {
        for (const entry of group.entries) {
          expect(METRICS[entry.metric].pickerVisible, entry.metric).toBe(true);
        }
      }
    }
  });

  it('offers everything the save would accept — no silent gap', () => {
    const offered = new Set(
      paletteFor(BriefObjective.Gmv).flatMap((g) => g.entries.map((e) => e.metric)),
    );
    const allowedAndFillable = OBJECTIVE_METRICS[BriefObjective.Gmv].filter(
      (m) => METRICS[m].pickerVisible,
    );
    expect([...offered].sort()).toEqual([...allowedAndFillable].sort());
  });

  it('labels every entry in Bahasa and marks what is already in use', () => {
    const spec = gmv();
    const entries = paletteFor(BriefObjective.Gmv, spec).flatMap((g) => g.entries);
    for (const entry of entries) {
      expect(entry.label).not.toBe(entry.metric);
      expect(entry.inUse).toBe(spec.metrics.includes(entry.metric));
    }
  });
});

describe('replaceMetric — the slot swap', () => {
  it('puts the new metric in the slot', () => {
    const next = replaceMetric(gmv(), 0, 'cpm');
    expect(next.metrics[0]).toBe('cpm');
  });

  it('swaps rather than duplicating when the metric is already on the spec', () => {
    const spec = gmv();
    const [first, second] = [spec.metrics[0]!, spec.metrics[1]!];

    const next = replaceMetric(spec, 0, second);

    expect(next.metrics[0]).toBe(second);
    expect(next.metrics[1]).toBe(first);
    // Two tiles showing the same number is never what a drop meant.
    expect(new Set(next.metrics).size).toBe(next.metrics.length);
  });

  it('marks an edited spec as custom — the preset name would be a lie', () => {
    expect(replaceMetric(gmv(), 0, 'cpm').preset).toBe('custom');
  });

  it('ignores an out-of-range slot instead of growing the spec', () => {
    const spec = gmv();
    expect(replaceMetric(spec, 99, 'cpm')).toBe(spec);
    expect(replaceMetric(spec, -1, 'cpm')).toBe(spec);
  });
});

describe('add / remove / move', () => {
  it('appends a metric and refuses a duplicate', () => {
    const spec = gmv();
    const added = addMetric(spec, 'frequency');
    expect(added.metrics.at(-1)).toBe('frequency');
    expect(addMetric(added, 'frequency')).toBe(added);
  });

  it('refuses to grow past the schema maximum', () => {
    let spec: ReportSpec = { ...gmv(), metrics: OBJECTIVE_METRICS[BriefObjective.Gmv].slice(0, 3) };
    for (const metric of OBJECTIVE_METRICS[BriefObjective.Gmv]) spec = addMetric(spec, metric);
    expect(spec.metrics.length).toBeLessThanOrEqual(MAX_SPEC_METRICS);
  });

  it('refuses to shrink below a renderable grid', () => {
    let spec = gmv();
    while (spec.metrics.length > MIN_SPEC_METRICS) spec = removeMetric(spec, spec.metrics.length - 1);

    expect(spec.metrics).toHaveLength(MIN_SPEC_METRICS);
    // The editor never shows a state it could not save.
    expect(removeMetric(spec, 0)).toBe(spec);
    expect(() => parseReportSpec(spec, BriefObjective.Gmv)).not.toThrow();
  });

  it('reorders without losing or duplicating a metric', () => {
    const spec = gmv();
    const moved = moveMetric(spec, 0, 3);

    expect(moved.metrics[3]).toBe(spec.metrics[0]);
    expect([...moved.metrics].sort()).toEqual([...spec.metrics].sort());
  });

  it('treats order as priority — moving changes which metrics tile', () => {
    const spec = gmv();
    const buried = spec.metrics[8]!;
    const promoted = moveMetric(spec, 8, 0);

    expect(previewSpec(promoted, BriefObjective.Gmv).grid.tiles).toContain(buried);
    expect(previewSpec(spec, BriefObjective.Gmv).grid.tiles).not.toContain(buried);
  });
});

describe('setTarget', () => {
  it('sets and clears a per-client target', () => {
    const withTarget = setTarget(gmv(), 'roas', 4);
    expect(withTarget.targets).toEqual({ roas: 4 });

    const cleared = setTarget(withTarget, 'roas', null);
    // Absent, not an empty object: `targets: {}` would serialise as a
    // configuration nobody made.
    expect(cleared.targets).toBeUndefined();
  });

  it('keeps a spec with targets savable', () => {
    const spec = setTarget(gmv(), 'roas', 4);
    expect(() => parseReportSpec(spec, BriefObjective.Gmv)).not.toThrow();
  });
});

describe('previewSpec', () => {
  it('shows the grid the deck will actually build', () => {
    const spec = gmv();
    const preview = previewSpec(spec, BriefObjective.Gmv);

    expect(preview.valid).toBe(true);
    expect(preview.grid.tiles).toEqual(spec.metrics.slice(0, 6));
    expect(preview.overflow).toEqual(spec.metrics.slice(6));
  });

  it('flags a metric the objective forbids before a save can 422', () => {
    const spec: ReportSpec = { ...awareness(), metrics: ['impressions', 'reach', 'roas'] };
    const preview = previewSpec(spec, BriefObjective.Awareness);

    expect(preview.invalid).toEqual(['roas']);
    expect(preview.valid).toBe(false);
    expect(() => parseReportSpec(spec, BriefObjective.Awareness)).toThrow();
  });

  it('reports an unsavable spec rather than throwing at the editor', () => {
    const spec: ReportSpec = { ...gmv(), metrics: ['roas', 'spend'] as MetricKey[] };
    expect(previewSpec(spec, BriefObjective.Gmv).valid).toBe(false);
  });

  it('agrees with the validator on every reachable edit', () => {
    // Property: whatever sequence of edits produced it, `valid` and
    // `parseReportSpec` must never disagree.
    let spec = gmv();
    for (const metric of OBJECTIVE_METRICS[BriefObjective.Gmv]) {
      spec = addMetric(spec, metric);
      spec = moveMetric(spec, spec.metrics.length - 1, 0);
      const preview = previewSpec(spec, BriefObjective.Gmv);
      let saves = true;
      try {
        parseReportSpec(spec, BriefObjective.Gmv);
      } catch {
        saves = false;
      }
      expect(preview.valid).toBe(saves);
    }
  });
});
