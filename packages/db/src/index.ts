/**
 * @tempo/db — persistence and read-models.
 *
 * Owns the Drizzle schema, the auto-selecting database client (Postgres or
 * embedded PGlite), the ingestion write pipeline, and the dashboard
 * read-models consumed by the API layer.
 */

export * as schema from './schema.js';
export { getDb, resolvePgliteDir, __resetDbForTests } from './client.js';
export type { Database, DbHandle, DbBackend } from './client.js';

export { ingestAccount } from './ingest/pipeline.js';
export type { IngestResult } from './ingest/pipeline.js';
export { ensureDemoTenant, listConnectedAccounts } from './ingest/bootstrap.js';
export type { DemoTenant } from './ingest/bootstrap.js';
export { fetchSanitizeAndSeed } from './ingest/sanitize.js';
export type { FetchSanitizeOptions } from './ingest/sanitize.js';

export {
  getClientBySlug,
  listClients,
  getDashboard,
  emptyRollups,
} from './repositories/dashboard.js';
export type {
  ClientSummary,
  DashboardData,
  KpiCard,
  TimeseriesPoint,
  CampaignRow,
  VideoRow,
} from './repositories/dashboard.js';
export { getHourlyDashboard, listHourlyDates } from './repositories/hourly.js';
export type {
  HourlyDashboardData,
  HourPoint,
  PacingPoint,
  CampaignBreakdown,
  AdgroupBreakdown,
  DayOverDaySeries,
  Coverage,
  Comparison,
  Totals,
} from './repositories/hourly.js';

export { recentSyncRuns } from './repositories/sync.js';
export { getSetting, setSetting, SETTINGS_KEYS } from './repositories/settings.js';
