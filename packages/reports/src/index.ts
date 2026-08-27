/**
 * @tempo/reports — the Brief Deck.
 *
 * One landscape 16:9 deck per client per objective
 * (docs/architecture/PRD_tempo_brief_deck.md). `buildDeckModel` is the only
 * place engine content, read-model rows and the report spec meet;
 * `renderDeckHtml` reads nothing but the resulting `DeckModel`. That boundary
 * is what keeps the output format swappable — the PDF conversion itself lives
 * in the app layer (headless Chromium), so this package stays pure.
 *
 * M7 deleted the Phase 1.5 daily report, the fact-sheet narrative stack and the
 * report copy monolith once the deck replaced them (PRD §1, K1/K2/K3/K7). It
 * also deleted the hourly document, and that one turned out to have no
 * successor: the deck is day-grain and reads no `paid_hourly_metrics`, so a
 * premium client's intraday telemetry had no document at all. `renderHourlyHtml`
 * is that document restored — deck-independent, engine-independent, and
 * rendering only what the intraday read-model already derived.
 *
 * `BriefObjective` and friends come from `@tempo/core` and are re-exported so
 * a caller that already depends on this package need not add another import.
 */

export { BriefObjective, OBJECTIVE_NORTH_STAR, NORTH_STAR_OBJECTIVE, isBriefObjective } from '@tempo/core';
export { comboChart, type ComboPoint, type ComboOptions } from './charts.js';
export { renderHourlyHtml, type HourlyReportOptions } from './hourly.js';

export {
  parseEngineContent,
  selectedFindings,
  ENGINE_CONTENT_VERSION,
  EngineBriefContentV2Schema,
  type EngineBriefContentV2,
  type EngineFinding,
  type EngineCoverageAudit,
  type EngineSectionRanking,
  type EngineTier,
} from './deck/engine-content.js';
export type {
  DeckModel,
  DeckMeta,
  DeckTier,
  Slide,
  Block,
  KpiTile,
  KpiGridLayout,
  ChartSpec,
  TableSpec,
  TableRow,
  FindingCard,
  VideoCell,
  RoadmapRow,
  SectionFallback,
  Light,
} from './deck/model.js';
export { buildDeckModel, type BuildDeckInput } from './deck/build.js';
export { renderDeckHtml, SLIDE_WIDTH_MM, SLIDE_HEIGHT_MM } from './deck/render.js';
export { DECK_COPY, metricLabel, objectiveLabel, tierBadge } from './deck/copy.js';
export { light, rowLight, deltaDirection } from './deck/lights.js';
export { solveKpiGrid, type GridSolution } from './deck/grid.js';
export {
  paletteFor,
  previewSpec,
  replaceMetric,
  addMetric,
  removeMetric,
  moveMetric,
  setTarget,
  CATEGORY_LABELS,
  type PaletteEntry,
  type PaletteGroup,
  type SpecPreview,
} from './deck/spec-editor.js';
export {
  ReportSpecSchema,
  MetricKeySchema,
  OBJECTIVE_METRICS,
  REPORT_SPEC_PRESETS,
  PRESET_BY_OBJECTIVE,
  ReportSpecObjectiveError,
  parseReportSpec,
  defaultReportSpec,
  resolveReportSpec,
  presetMetricsFor,
  disallowedMetrics,
  MIN_SPEC_METRICS,
  MAX_SPEC_METRICS,
  type ReportSpec,
  type ReportSpecPreset,
} from './deck/spec.js';
