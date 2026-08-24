import { METRICS, type BriefObjective, type MetricCategory, type MetricKey } from '@tempo/core';
import { metricLabel } from './copy.js';
import { MAX_TILES, solveKpiGrid, type GridSolution } from './grid.js';
import {
  MAX_SPEC_METRICS,
  MIN_SPEC_METRICS,
  OBJECTIVE_METRICS,
  ReportSpecSchema,
  disallowedMetrics,
  type ReportSpec,
} from './spec.js';

/**
 * The spec editor's operations, as pure functions (Brief Deck PRD §3.3, M6).
 *
 * The editor is a UI over these — it must not restate a validation rule in the
 * client. Every operation here returns a new spec and refuses to produce one
 * the schema would reject, so the "can I save this?" question has a single
 * answer no matter which surface asks it.
 *
 * Slot Swap is an array splice on `metrics`, exactly as the PRD says: the grid
 * solver re-derives the layout from the new order. There is no position to
 * persist and no layout state to keep in sync.
 *
 * Reachable as `@tempo/reports/spec-editor` as well as through the barrel.
 * The editor is a **client component**, and the barrel re-exports the Phase 1.5
 * report model, which pulls in `@tempo/db` and therefore `pg` — a module graph
 * no browser bundle can resolve. This file imports only `@tempo/core` and zod,
 * so the subpath is safe from the client. (When K2 removes that model at M7 the
 * barrel loosens, but a subpath that states its own constraint is better than
 * one that happens to work.)
 */

export type { ReportSpec } from './spec.js';
export { MIN_SPEC_METRICS, MAX_SPEC_METRICS, OBJECTIVE_METRICS } from './spec.js';

export interface PaletteEntry {
  metric: MetricKey;
  /** The Bahasa label a slide would print for it. */
  label: string;
  category: MetricCategory;
  /** Already on the spec — the palette shows it, greyed, rather than hiding it. */
  inUse: boolean;
}

export interface PaletteGroup {
  category: MetricCategory;
  entries: PaletteEntry[];
}

/** Grouping order — money and outcome first, because that is what gets picked. */
const CATEGORY_ORDER: MetricCategory[] = ['hasil', 'biaya', 'efisiensi', 'video', 'jangkauan'];

export const CATEGORY_LABELS: Record<MetricCategory, string> = {
  biaya: 'Biaya',
  hasil: 'Hasil',
  efisiensi: 'Efisiensi',
  video: 'Video',
  jangkauan: 'Jangkauan',
};

/**
 * What an AM may put on this objective's deck.
 *
 * Filtered twice on purpose: `OBJECTIVE_METRICS` is the honesty rule (an
 * awareness deck cannot offer `roas`), and `pickerVisible` is the capability
 * rule (nothing can fill an organic tile from the paid rollup yet). Offering a
 * metric the save would reject, or one that renders as "—", would both be the
 * editor lying about what it can do.
 */
export function paletteFor(objective: BriefObjective, spec?: ReportSpec): PaletteGroup[] {
  const inUse = new Set(spec?.metrics ?? []);
  const allowed = OBJECTIVE_METRICS[objective].filter((key) => METRICS[key].pickerVisible);

  return CATEGORY_ORDER.map((category) => ({
    category,
    entries: allowed
      .filter((key) => METRICS[key].category === category)
      .map((key) => ({
        metric: key,
        label: metricLabel(key, objective),
        category,
        inUse: inUse.has(key),
      })),
  })).filter((group) => group.entries.length > 0);
}

/** A spec is `custom` the moment an AM edits it — the preset name would lie. */
function asCustom(spec: ReportSpec, metrics: MetricKey[]): ReportSpec {
  return { ...spec, preset: 'custom', metrics };
}

/**
 * Replace the metric in one slot (the Slot Swap). Dropping a metric that is
 * already on the spec *moves* it into this slot rather than duplicating it —
 * two tiles showing the same number is never what the drop meant.
 */
export function replaceMetric(spec: ReportSpec, index: number, metric: MetricKey): ReportSpec {
  if (index < 0 || index >= spec.metrics.length) return spec;
  if (spec.metrics[index] === metric) return spec;

  const metrics = [...spec.metrics];
  const existing = metrics.indexOf(metric);
  if (existing >= 0) {
    // Swap the two positions: the dragged metric lands here, and what was here
    // takes its old place instead of vanishing.
    metrics[existing] = metrics[index]!;
  }
  metrics[index] = metric;
  return asCustom(spec, metrics);
}

/** Append a metric. Returns the spec unchanged when it is already on it or full. */
export function addMetric(spec: ReportSpec, metric: MetricKey): ReportSpec {
  if (spec.metrics.includes(metric)) return spec;
  if (spec.metrics.length >= MAX_SPEC_METRICS) return spec;
  return asCustom(spec, [...spec.metrics, metric]);
}

/**
 * Remove a metric — unless doing so would drop below the three the grid needs.
 * Refusing here rather than at save time means the editor never shows a state
 * it cannot persist.
 */
export function removeMetric(spec: ReportSpec, index: number): ReportSpec {
  if (spec.metrics.length <= MIN_SPEC_METRICS) return spec;
  if (index < 0 || index >= spec.metrics.length) return spec;
  return asCustom(
    spec,
    spec.metrics.filter((_, i) => i !== index),
  );
}

/** Move a metric within the order. Order *is* priority (PRD §3.3). */
export function moveMetric(spec: ReportSpec, from: number, to: number): ReportSpec {
  if (from === to) return spec;
  if (from < 0 || from >= spec.metrics.length) return spec;
  if (to < 0 || to >= spec.metrics.length) return spec;

  const metrics = [...spec.metrics];
  const [moved] = metrics.splice(from, 1);
  metrics.splice(to, 0, moved!);
  return asCustom(spec, metrics);
}

/** Set or clear a per-client target — `light()`'s highest-precedence input. */
export function setTarget(spec: ReportSpec, metric: MetricKey, value: number | null): ReportSpec {
  const targets = { ...(spec.targets ?? {}) };
  if (value === null || !Number.isFinite(value)) delete targets[metric];
  else targets[metric] = value;
  return { ...spec, targets: Object.keys(targets).length > 0 ? targets : undefined };
}

export interface SpecPreview {
  grid: GridSolution;
  /** Metrics beyond the grid; they still reach Lampiran A. */
  overflow: MetricKey[];
  /** Anything the objective forbids — a save would 422 on these. */
  invalid: MetricKey[];
  /** Whether the spec is savable as it stands. */
  valid: boolean;
}

/**
 * What the editor shows next to the palette: the grid this spec produces, what
 * overflows, and whether it would save. Built from the same solver and the same
 * validator the export uses, so the preview cannot promise a deck the route
 * would refuse.
 */
export function previewSpec(spec: ReportSpec, objective: BriefObjective): SpecPreview {
  const invalid = disallowedMetrics(spec, objective);
  const parsed = ReportSpecSchema.safeParse(spec);

  if (!parsed.success || spec.metrics.length < MIN_SPEC_METRICS) {
    return {
      grid: { tiles: spec.metrics.slice(0, MAX_TILES), layout: '1x3', suggested: [], overflow: [] },
      overflow: [],
      invalid,
      valid: false,
    };
  }

  const grid = solveKpiGrid(spec.metrics, OBJECTIVE_METRICS[objective]);
  return { grid, overflow: grid.overflow, invalid, valid: invalid.length === 0 };
}
