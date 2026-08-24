import { BriefObjective, METRICS, type MetricKey } from '@tempo/core';
import { describe, expect, it } from 'vitest';
import { DELTA_FLAT_THRESHOLD, deltaDirection, light } from './lights.js';

/**
 * Property tests across direction × bands × targets (Brief Deck PRD §9 item 3).
 * The properties matter more than the individual cases: a grading function that
 * is right on the examples and wrong on the ordering paints a client's worst
 * campaign green.
 */

const ALL_KEYS = Object.keys(METRICS) as MetricKey[];
const OBJECTIVES = [BriefObjective.Awareness, BriefObjective.Gmv, BriefObjective.Install];
const SAMPLE_VALUES = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 10, 1_000, 1_000_000];

describe('light()', () => {
  it('never guesses: no band, no target, no delta means none', () => {
    for (const key of ALL_KEYS) {
      for (const objective of OBJECTIVES) {
        if (METRICS[key].bands?.[objective]) continue;
        expect(light(key, { value: 42, objective })).toBe('none');
      }
    }
  });

  it('returns none for an unreported value regardless of target', () => {
    expect(light('roas', { value: null, objective: BriefObjective.Gmv, target: 4 })).toBe('none');
    expect(light('cpa', { value: Number.NaN, objective: BriefObjective.Gmv, delta: -0.5 })).toBe(
      'none',
    );
  });

  it('is total — every metric × objective × value returns a valid light', () => {
    for (const key of ALL_KEYS) {
      for (const objective of OBJECTIVES) {
        for (const value of SAMPLE_VALUES) {
          const result = light(key, { value, objective, delta: 0.3, target: 2 });
          expect(['green', 'yellow', 'red', 'none']).toContain(result);
        }
      }
    }
  });

  describe('bands', () => {
    // roas is the one banded metric (green >= 3, yellow >= 2 — the convention
    // insights.ts has used since Phase 1.5).
    it('grades an up-metric by its band', () => {
      const gmv = { objective: BriefObjective.Gmv };
      expect(light('roas', { ...gmv, value: 4 })).toBe('green');
      expect(light('roas', { ...gmv, value: 3 })).toBe('green');
      expect(light('roas', { ...gmv, value: 2.5 })).toBe('yellow');
      expect(light('roas', { ...gmv, value: 1.2 })).toBe('red');
    });

    it('does not apply one objective band to another objective', () => {
      // An awareness deck cannot show roas at all (ReportSpec 422s it), and the
      // band is scoped so it cannot leak in through some other path either.
      expect(light('roas', { value: 4, objective: BriefObjective.Awareness })).toBe('none');
    });

    it('is monotonic in the good direction', () => {
      const grades = SAMPLE_VALUES.map((value) =>
        light('roas', { value, objective: BriefObjective.Gmv }),
      );
      const rank = { red: 0, yellow: 1, green: 2, none: -1 } as const;
      for (let i = 1; i < grades.length; i += 1) {
        expect(rank[grades[i]!]).toBeGreaterThanOrEqual(rank[grades[i - 1]!]);
      }
    });
  });

  describe('targets', () => {
    it('take precedence over bands', () => {
      // Band would say green (>= 3); a stretch target of 6 says otherwise.
      expect(light('roas', { value: 3, objective: BriefObjective.Gmv, target: 6 })).toBe('red');
    });

    it('invert correctly for a down-metric', () => {
      const gmv = { objective: BriefObjective.Gmv, target: 100 };
      expect(light('cpa', { ...gmv, value: 80 })).toBe('green');
      expect(light('cpa', { ...gmv, value: 105 })).toBe('yellow');
      expect(light('cpa', { ...gmv, value: 200 })).toBe('red');
    });

    it('treat a neutral metric as a band around the target, not a direction', () => {
      // Symmetric around the target: 10% drift is on-track, up to 30% is
      // worth watching, past that is off in either direction.
      const aware = { objective: BriefObjective.Awareness, target: 3 };
      expect(light('frequency', { ...aware, value: 3 })).toBe('green');
      expect(light('frequency', { ...aware, value: 3.2 })).toBe('green');
      expect(light('frequency', { ...aware, value: 3.6 })).toBe('yellow');
      expect(light('frequency', { ...aware, value: 2.4 })).toBe('yellow');
      expect(light('frequency', { ...aware, value: 9 })).toBe('red');
      expect(light('frequency', { ...aware, value: 0.2 })).toBe('red');
    });

    it('ignores a zero target rather than dividing by it', () => {
      expect(light('roas', { value: 4, objective: BriefObjective.Gmv, target: 0 })).toBe('green');
    });
  });

  describe('delta heuristic', () => {
    it('grades movement when there is no absolute standard', () => {
      const aware = { objective: BriefObjective.Awareness, value: 1000 };
      expect(light('impressions', { ...aware, delta: 0.4 })).toBe('green');
      expect(light('impressions', { ...aware, delta: 0.005 })).toBe('yellow');
      expect(light('impressions', { ...aware, delta: -0.4 })).toBe('red');
    });

    it('inverts for a down-metric', () => {
      const gmv = { objective: BriefObjective.Gmv, value: 50 };
      expect(light('cpc', { ...gmv, delta: -0.3 })).toBe('green');
      expect(light('cpc', { ...gmv, delta: 0.3 })).toBe('red');
    });

    it('refuses to grade a neutral metric by movement alone', () => {
      // Frequency moving up is not good or bad on its own — the engine's A01
      // generator flags both over-exposure and under-saturation.
      expect(light('frequency', { value: 4, objective: BriefObjective.Awareness, delta: 0.5 })).toBe(
        'none',
      );
    });
  });
});

describe('deltaDirection()', () => {
  it('reports movement, not judgement', () => {
    expect(deltaDirection(0.3)).toBe('up');
    expect(deltaDirection(-0.3)).toBe('down');
    expect(deltaDirection(DELTA_FLAT_THRESHOLD / 2)).toBe('flat');
    expect(deltaDirection(null)).toBe('flat');
    expect(deltaDirection(undefined)).toBe('flat');
  });
});
