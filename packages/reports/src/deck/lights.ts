import { METRICS, type BriefObjective, type MetricDef, type MetricKey } from '@tempo/core';
import type { Light } from './model.js';

/**
 * One grading substrate for the whole system (Brief Deck PRD §3.5).
 *
 * Semantics, from Plan_Template: **green = tambah anggaran · yellow =
 * pertahankan · red = evaluasi.** Resolution order, highest precedence first:
 *
 *   1. a per-client `target` for this metric,
 *   2. the metric's objective `band` from the catalog,
 *   3. a delta-only heuristic (movement, when there is no absolute standard),
 *   4. `none` — **never guess**.
 *
 * Step 4 is the important one. A light is a claim printed to a client, and a
 * fabricated threshold is the same class of error as a fabricated number. Most
 * metrics in the catalog carry no band on purpose, so most account-level tiles
 * grade from movement or not at all until an AM sets a target (M6).
 *
 * PRD §11 R8 names the failure this function prevents: two grading
 * vocabularies drifting apart. Adding a second threshold source anywhere else
 * is a review-blocking offence — dashboard deltas and any future scoreboard
 * grade through here or not at all.
 */

/** How close to a target still counts as "on track" rather than "off". */
export const TARGET_YELLOW_TOLERANCE = 0.1;

/** A delta this small is noise, not movement. */
export const DELTA_FLAT_THRESHOLD = 0.02;
/** Below this, movement is real but not yet worth a green or a red. */
export const DELTA_MATERIAL_THRESHOLD = 0.1;

export interface LightInput {
  /** The metric's value this window; `null` means not reported. */
  value: number | null;
  /** Fractional period-over-period change, e.g. `0.12` for +12%. */
  delta?: number | null;
  /** Per-client target for this metric, from `ReportSpec.targets`. */
  target?: number | null;
  objective: BriefObjective;
}

function gradeAgainstTarget(value: number, target: number, def: MetricDef): Light | null {
  if (def.goodDirection === 'neutral') {
    // A neutral metric (frequency) has a *band* around its target, not a
    // direction: both too far below and too far above are off-target.
    const drift = Math.abs(value - target) / Math.abs(target || 1);
    if (drift <= TARGET_YELLOW_TOLERANCE) return 'green';
    if (drift <= TARGET_YELLOW_TOLERANCE * 3) return 'yellow';
    return 'red';
  }
  const ratio = value / target;
  if (def.goodDirection === 'up') {
    if (ratio >= 1) return 'green';
    if (ratio >= 1 - TARGET_YELLOW_TOLERANCE) return 'yellow';
    return 'red';
  }
  if (ratio <= 1) return 'green';
  if (ratio <= 1 + TARGET_YELLOW_TOLERANCE) return 'yellow';
  return 'red';
}

function gradeAgainstBand(value: number, def: MetricDef, objective: BriefObjective): Light | null {
  const band = def.bands?.[objective];
  if (!band) return null;
  if (def.goodDirection === 'up') {
    if (value >= band.green) return 'green';
    if (value >= band.yellow) return 'yellow';
    return 'red';
  }
  if (def.goodDirection === 'down') {
    if (value <= band.green) return 'green';
    if (value <= band.yellow) return 'yellow';
    return 'red';
  }
  // Guarded in the catalog's own tests; unreachable unless a band is added to
  // a neutral metric, in which case grading it would be a guess.
  return null;
}

function gradeAgainstDelta(delta: number, def: MetricDef): Light {
  if (def.goodDirection === 'neutral') return 'none';
  const favourable = def.goodDirection === 'up' ? delta : -delta;
  if (Math.abs(delta) < DELTA_FLAT_THRESHOLD) return 'yellow';
  if (favourable >= DELTA_MATERIAL_THRESHOLD) return 'green';
  if (favourable <= -DELTA_MATERIAL_THRESHOLD) return 'red';
  return 'yellow';
}

/**
 * Grade one value. Pure and total: every input returns a `Light`, and an input
 * that supports no honest judgement returns `'none'`.
 */
export function light(metric: MetricKey, input: LightInput): Light {
  const def = METRICS[metric];
  if (!def) return 'none';
  const { value, delta, target, objective } = input;

  if (value === null || !Number.isFinite(value)) return 'none';

  if (target !== null && target !== undefined && Number.isFinite(target) && target !== 0) {
    const graded = gradeAgainstTarget(value, target, def);
    if (graded) return graded;
  }

  const banded = gradeAgainstBand(value, def, objective);
  if (banded) return banded;

  if (delta !== null && delta !== undefined && Number.isFinite(delta)) {
    return gradeAgainstDelta(delta, def);
  }

  return 'none';
}

/**
 * Row-level grading for a campaign or video table. PRD §3.5: at this
 * granularity the red row *is* the culprit, so a red row also carries an
 * action — but the action is only as specific as the evidence behind it.
 * G04 (zero-yield) and G05 (marginal return) findings upgrade a generic action
 * to a named one; that upgrade happens in `build.ts`, where the findings are,
 * not here.
 */
export function rowLight(
  metric: MetricKey,
  value: number | null,
  objective: BriefObjective,
  target?: number | null,
): Light {
  return light(metric, { value, objective, target });
}

/** For the arrow glyph next to a delta — movement, not judgement. */
export function deltaDirection(delta: number | null | undefined): 'up' | 'down' | 'flat' {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return 'flat';
  if (Math.abs(delta) < DELTA_FLAT_THRESHOLD) return 'flat';
  return delta > 0 ? 'up' : 'down';
}
