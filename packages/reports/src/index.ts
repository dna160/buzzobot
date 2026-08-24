/**
 * @tempo/reports — client-ready report generation.
 *
 * Assembles a report model from the dashboard read-model (adding auto-generated
 * narrative + a prioritized action plan) and renders it to a self-contained,
 * print-optimized HTML document. The PDF conversion itself lives in the app
 * layer (headless Chromium), keeping this package pure and testable.
 */

export { buildReport, type ReportModel } from './model.js';
export { renderReportHtml } from './render.js';
export { buildInsights, type ReportInsights, type Recommendation, type Priority } from './insights.js';
export { comboChart, type ComboPoint, type ComboOptions } from './charts.js';
export { getCopy, isLocale, DEFAULT_LOCALE, type Locale, type ReportCopy } from './i18n.js';

export { BriefObjective, OBJECTIVE_NORTH_STAR, isBriefObjective } from './brief-objective.js';

// --- Brief Deck (docs/architecture/PRD_tempo_brief_deck.md) ----------------
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
