import { BriefObjective, type MetricKey } from '@tempo/core';
import { describe, expect, it } from 'vitest';
import { MAX_TILES, solveKpiGrid } from './grid.js';
import { presetMetricsFor } from './spec.js';

/** Brief Deck PRD §9 item 2: same spec, same grid. Every time. */

const AWARENESS_PRESET = presetMetricsFor(BriefObjective.Awareness);

describe('solveKpiGrid()', () => {
  it.each([
    [3, '1x3'],
    [4, '2x2'],
    [6, '2x3'],
  ])('lays %i metrics out as %s', (count, layout) => {
    const metrics = AWARENESS_PRESET.slice(0, count);
    expect(solveKpiGrid(metrics, AWARENESS_PRESET).layout).toBe(layout);
  });

  it('auto-fills a sixth tile for a 5-metric spec and badges it', () => {
    const five = AWARENESS_PRESET.slice(0, 5);
    const solution = solveKpiGrid(five, AWARENESS_PRESET);

    expect(solution.tiles).toHaveLength(6);
    expect(solution.layout).toBe('2x3');
    expect(solution.suggested).toHaveLength(1);
    // The AM's five choices keep their order and priority; only the filler is new.
    expect(solution.tiles.slice(0, 5)).toEqual(five);
    expect(five).not.toContain(solution.suggested[0]);
  });

  it('renders a 5-metric grid honestly when the preset has nothing left to fill with', () => {
    const five = AWARENESS_PRESET.slice(0, 5);
    const solution = solveKpiGrid(five, five);
    expect(solution.tiles).toEqual(five);
    expect(solution.suggested).toEqual([]);
    expect(solution.layout).toBe('2x3');
  });

  it('overflows past six to the appendix rather than shrinking tiles', () => {
    const nine = AWARENESS_PRESET.slice(0, 9);
    const solution = solveKpiGrid(nine, AWARENESS_PRESET);

    expect(solution.tiles).toHaveLength(MAX_TILES);
    expect(solution.overflow).toEqual(nine.slice(MAX_TILES));
    expect([...solution.tiles, ...solution.overflow]).toEqual(nine);
  });

  it('de-duplicates before counting, so a repeated metric cannot change the layout', () => {
    const withDupe = [
      AWARENESS_PRESET[0]!,
      AWARENESS_PRESET[1]!,
      AWARENESS_PRESET[0]!,
      AWARENESS_PRESET[2]!,
    ] as MetricKey[];
    expect(solveKpiGrid(withDupe, AWARENESS_PRESET).layout).toBe('1x3');
  });

  it('is deterministic: the same spec produces an identical solution', () => {
    const metrics = AWARENESS_PRESET.slice(0, 5);
    expect(solveKpiGrid(metrics, AWARENESS_PRESET)).toEqual(
      solveKpiGrid(metrics, AWARENESS_PRESET),
    );
  });

  it('rejects a grid below the schema minimum instead of rendering a lonely tile', () => {
    expect(() => solveKpiGrid(AWARENESS_PRESET.slice(0, 2), AWARENESS_PRESET)).toThrow(
      /at least 3 metrics/,
    );
  });
});
