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
export {
  buildHourlyReport,
  type HourlyReportModel,
  type HourlyReportBase,
  type HourlyReportDay,
} from './hourly-model.js';
export { renderHourlyReportHtml } from './hourly-render.js';
export { buildHourlyInsights, type HourlyInsights } from './hourly-insights.js';
export { buildInsights, type ReportInsights, type Recommendation, type Priority } from './insights.js';
export { comboChart, type ComboPoint, type ComboOptions } from './charts.js';
export { getCopy, isLocale, DEFAULT_LOCALE, type Locale, type ReportCopy } from './i18n.js';

export {
  generateNarrative,
  createNarrativeProvider,
  parseAndVerify,
  toNarrative,
  type NarrativeResult,
} from './narrative/generate.js';
export {
  loadNarrativeConfig,
  NarrativeConfigSchema,
  type NarrativeConfig,
  type NarrativeProvider,
} from './narrative/provider.js';
export { buildFactSheet, type FactSheet } from './narrative/facts.js';
export { NarrativeSchema, type Narrative } from './narrative/schema.js';
export { verifyNarrative, verifyNoUnsupportedMetrics } from './narrative/verify.js';
export {
  probeLocalLlm,
  type LocalLlmProbeResult,
  type ProbeStep,
  type ProbeConfig,
} from './narrative/probe.js';

export { BriefObjective, OBJECTIVE_NORTH_STAR, isBriefObjective } from './brief-objective.js';
export {
  renderEngineBriefHtml,
  type EngineBriefContent,
  type EngineSectionDraft,
  type EngineRisk,
} from './engine-brief/render.js';
