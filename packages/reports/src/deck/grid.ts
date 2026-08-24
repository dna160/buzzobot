import type { MetricKey } from '@tempo/core';
import type { KpiGridLayout } from './model.js';

/**
 * The adaptive KPI grid solver (Brief Deck PRD §4 S1, §12 D2).
 *
 * Rules, in full:
 *   3 metrics       → `1x3`
 *   4 metrics       → `2x2`
 *   5 metrics       → `2x3`, with the 6th auto-filled from the objective preset
 *                     and badged *disarankan* (D2's default)
 *   6 metrics       → `2x3`
 *   more than 6     → the first 6 tile; the rest overflow to Lampiran A
 *   fewer than 3    → rejected upstream by `ReportSpecSchema` (`.min(3)`), so
 *                     this function's contract starts at 3
 *
 * Deterministic by construction: the same spec always produces the same grid,
 * which is what makes the golden decks and the M6 slot-swap editor meaningful.
 * There is no packing heuristic and no measurement — a layout that depends on
 * label lengths cannot be asserted in a test.
 */

export const MAX_TILES = 6;
export const MIN_TILES = 3;

export interface GridSolution {
  /** The metrics that get a tile, in spec order. */
  tiles: MetricKey[];
  layout: KpiGridLayout;
  /** Tiles auto-filled to complete the row — badged *disarankan* on the slide. */
  suggested: MetricKey[];
  /** Spec metrics beyond the grid; they still appear in Lampiran A. */
  overflow: MetricKey[];
}

const LAYOUT_BY_COUNT: Record<number, KpiGridLayout> = {
  3: '1x3',
  4: '2x2',
  5: '2x3',
  6: '2x3',
};

/**
 * @param metrics ordered spec metrics — order *is* priority (PRD §3.3)
 * @param presetFallback the objective preset, used only to fill a fifth-tile gap
 */
export function solveKpiGrid(metrics: MetricKey[], presetFallback: MetricKey[] = []): GridSolution {
  const unique = metrics.filter((m, i) => metrics.indexOf(m) === i);

  if (unique.length < MIN_TILES) {
    throw new Error(
      `a KPI grid needs at least ${MIN_TILES} metrics, got ${unique.length} — ` +
        'ReportSpecSchema enforces this before a spec is stored',
    );
  }

  const tiles = unique.slice(0, MAX_TILES);
  const overflow = unique.slice(MAX_TILES);
  const suggested: MetricKey[] = [];

  if (tiles.length === 5) {
    // D2: auto-fill rather than leave a hole or drop to a 2x2 that would
    // silently hide the AM's fifth choice. The filler is badged, so the client
    // can see which number they asked for and which one we suggested.
    const filler = presetFallback.find((m) => !tiles.includes(m));
    if (filler) {
      tiles.push(filler);
      suggested.push(filler);
    }
  }

  const layout = LAYOUT_BY_COUNT[tiles.length];
  if (!layout) {
    // Only reachable at 5 tiles with an exhausted preset — a 5-tile 2x3 grid
    // with one empty cell is still the honest rendering, and it is better than
    // dropping a metric the AM explicitly chose.
    return { tiles, layout: '2x3', suggested, overflow };
  }
  return { tiles, layout, suggested, overflow };
}
