import type { BriefObjective, Currency, MetricKey } from '@tempo/core';

/**
 * `DeckModel` — the renderer-agnostic slide model (Brief Deck PRD §3.2).
 *
 * The hard rule this type exists to enforce: **no renderer reads engine JSON
 * or read-model rows directly.** Everything renders from here. That is what
 * makes the output format swappable (a pptxgenjs renderer over the same model
 * is an additive milestone, not a redesign — PRD §0.1) and what makes a golden
 * deck meaningful: a golden over `DeckModel` fails when the *analysis* changed,
 * and a golden over the HTML fails when the *rendering* changed. Blur the two
 * and neither tells you anything.
 *
 * `buildDeckModel` (build.ts) is the only place engine content, read-model rows
 * and the report spec meet, and it is pure — no I/O, no clock, no randomness.
 */

export type Light = 'green' | 'yellow' | 'red' | 'none';
export type DeckTier = 'instant' | 'full';

/** Why a section is not showing what it would normally show. */
export interface SectionFallback {
  slideId: string;
  /** Machine-readable so the provenance footer can group them. */
  reason: 'no_findings' | 'coverage_gap' | 'deterministic_copy' | 'engine_unavailable';
  detail: string;
}

export interface DeckMeta {
  clientName: string;
  clientSlug: string;
  brandColor: string;
  currency: Currency;
  objective: BriefObjective;
  /** Human-readable window, already formatted — renderers never parse dates. */
  period: string;
  windowDays: number;
  tier: DeckTier;
  runId: string;
  engineVersion: string;
  /** ISO-8601; supplied by the caller, never read from the clock in here. */
  generatedAt: string;
  /** Probe counters for the provenance footer. */
  probesExecuted: number;
  probeYieldRate: number;
  /** Per-section honesty notes, printed in the footer. */
  fallbacks: SectionFallback[];
  /** True when the engine content predates content v2 — no findings to render. */
  legacyContent: boolean;
}

export interface KpiTile {
  metric: MetricKey;
  /** Always `MetricDef.labelId` — a `MetricKey` never reaches a slide. */
  label: string;
  value: string;
  delta?: string;
  /** Direction of the delta, for the arrow glyph — not a judgement. */
  deltaDirection?: 'up' | 'down' | 'flat';
  light: Light;
  /** Set when the tile was auto-filled to complete a row (PRD §12 D2). */
  suggested?: boolean;
}

export type KpiGridLayout = '1x3' | '2x2' | '2x3';

export interface ChartSeries {
  label: string;
  color: string;
  kind: 'bar' | 'line';
  values: Array<number | null>;
}

export interface ChartSpec {
  kind: 'combo' | 'rank';
  title: string;
  labels: string[];
  series: ChartSeries[];
  /** Pre-formatted axis/point labels — the renderer formats nothing itself. */
  valueLabels?: string[][];
}

export interface TableCell {
  text: string;
  /** Right-align numerics; the renderer does not guess from content. */
  numeric?: boolean;
}

export interface TableRow {
  cells: TableCell[];
  /**
   * Row-level grading. PRD §3.5: placement is granularity-aware — account-level
   * tiles get colour only, campaign/video rows get colour *and* an action,
   * because there the red row is the culprit.
   */
  light?: Light;
  action?: string;
}

export interface TableSpec {
  title: string;
  headers: string[];
  rows: TableRow[];
  /** Rendered when `rows` is empty — never an empty table, never a fake row. */
  emptyNote?: string;
}

export interface EvidenceChip {
  label: string;
  value: string;
}

export interface FindingCard {
  findingId: string;
  light: Light;
  headline: string;
  /** Every chip is a value from the finding's `evidence`, formatted only. */
  evidenceChips: EvidenceChip[];
  mechanism: string;
  implication?: string;
  action?: string;
  footer: {
    level: string;
    confidence: string;
    /** "G01" or "Probe r2" — where the claim came from. */
    source: string;
  };
}

export interface VideoCell {
  videoId: string;
  caption: string;
  href: string;
  thumbnailSrc?: string;
  metrics: Array<{ label: string; value: string }>;
  light: Light;
}

export interface RoadmapRow {
  priority: 'P0' | 'P1' | 'P2';
  action: string;
  owner: string;
  /** From `finding.magnitude_pct`, e.g. "34% dari belanja". */
  impact: string;
  evidenceRef: string;
}

export type Block =
  | { kind: 'kpiGrid'; tiles: KpiTile[]; layout: KpiGridLayout }
  | { kind: 'chart'; spec: ChartSpec }
  | { kind: 'table'; spec: TableSpec }
  | { kind: 'findingCard'; card: FindingCard }
  | { kind: 'videoGrid'; videos: VideoCell[] }
  | { kind: 'roadmap'; rows: RoadmapRow[] }
  | { kind: 'prose'; text: string }
  /**
   * "4 dari 6 sinyal tersedia" — a counted denominator from the coverage audit.
   * Its own block kind rather than prose so the renderer can style thinness
   * consistently, and so a missing coverage line is visible in a golden.
   */
  | { kind: 'coverageNote'; text: string };

export interface Slide {
  id: string;
  title: string;
  /** Cover and appendix slides render differently from a content slide. */
  variant?: 'cover' | 'content' | 'appendix';
  blocks: Block[];
}

export interface DeckModel {
  meta: DeckMeta;
  slides: Slide[];
}
