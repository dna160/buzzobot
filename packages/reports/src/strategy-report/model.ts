import type { Light } from '../deck/model.js';

/**
 * `StrategyReportModel` — the only thing the Strategy Report renderer reads
 * (the deck's hard rule, Brief Deck PRD §0, applied to this report). Built by
 * `buildStrategyReportModel` from engine content alone: every number here is
 * one the engine computed and exported; the model only arranges and formats.
 */

export type ReportClass = 'brand' | 'shop';
export type ChipStatus = 'critical' | 'watch' | 'good' | 'off_track' | 'on_track' | 'unknown';

export interface StrategyReportMeta {
  clientName: string;
  slug: string;
  brandName: string;
  reportClass: ReportClass;
  classLabel: string;
  /** "Kelas ditetapkan oleh AM" when the AM overrode the inference (PRD §5.2). */
  classOverridden: boolean;
  vertical: string | null;
  plan: 'Lite' | 'Full';
  asOf: string;
  windowStart: string;
  windowEnd: string;
  tier: 'instant' | 'full';
  runId: string | null;
  engineVersion: string;
  promptVersion: string | null;
  degraded: string[];
}

export interface VerdictChipModel {
  label: string;
  value: string;
  status: ChipStatus;
}

export interface ActionRowModel {
  rank: number;
  priority: 'P0' | 'P1' | 'P2';
  leverLabel: string;
  langkah: string;
  dasar: string;
  cara: string;
  gagalJika: string;
  stake: string | null;
  confidenceLabel: string;
  /** Plain-language sources, never a finding id or metric key. */
  sources: string;
}

export interface FunnelBarModel {
  stage: string;
  total: number | null;
  benchTotal: number | null;
  rankLabel: string;
  /** Size ratio of the next stage to this one, graded against the benchmark's with `light()`. */
  ratio: number | null;
  benchRatio: number | null;
  light: Light;
}

export interface SpendChartModel {
  stageLabel: string;
  lagDays: number;
  points: Array<{ spend: number; new: number }>;
  fit: { a: number; b: number; r2: number; knee: number } | null;
  /** A cap is drawn only when the engine found a knee worth acting on. */
  showKnee: boolean;
}

export interface RankChartModel {
  stageLabel: string;
  weekly: Array<{ date: string; rank: number }>;
  target: number | null;
  deadline: string | null;
  projected: number | null;
  projectedLow: number | null;
  projectedHigh: number | null;
  listSize: number | null;
}

export interface MixRowModel {
  label: string;
  share: number;
  benchShare: number | null;
}

export interface ContentMixModel {
  paid: number;
  nonPaid: number;
  subtypes: MixRowModel[];
}

export interface SignalRowModel {
  status: 'investigate' | 'watch' | 'good' | 'locked';
  title: string;
  detail: string;
}

export interface LogRowModel {
  startedAt: string;
  langkah: string;
  measured: string;
  category: string;
  verdict: 'worked' | 'weak' | 'failed' | 'running';
}

export interface RankListRowModel {
  rank: number;
  brand: string;
  movement: string;
  own: boolean;
}

export interface TableModel {
  head: string[];
  rows: string[][];
}

export type SectionVisual =
  | { kind: 'funnel'; bars: FunnelBarModel[] }
  | { kind: 'spend'; chart: SpendChartModel }
  | { kind: 'rank'; chart: RankChartModel }
  | { kind: 'mix'; mix: ContentMixModel }
  | { kind: 'ranklist'; rows: RankListRowModel[]; stageLabel: string; n: number | null };

export interface StrategySectionModel {
  id: number;
  key: string;
  title: string;
  headline: string;
  paragraphs: string[];
  visual: SectionVisual | null;
  signals: SignalRowModel[];
  log: LogRowModel[];
  table: TableModel | null;
  notes: string[];
}

export interface StrategyReportModel {
  meta: StrategyReportMeta;
  verdict: { headline: string; paragraph: string; chips: VerdictChipModel[] };
  actions: ActionRowModel[];
  /** In the class's own order (PRD §5.3), T1/T2 excluded — they head the report. */
  sections: StrategySectionModel[];
}
