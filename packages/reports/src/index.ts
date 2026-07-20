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
