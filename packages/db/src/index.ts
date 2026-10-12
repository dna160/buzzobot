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
export { fetchSanitizeAndSeed, syncBrandToDomain } from './ingest/sanitize.js';
export type { FetchSanitizeOptions } from './ingest/sanitize.js';
export { triggerAutoSyncIfStale } from './ingest/auto-sync.js';
export type { AutoSyncOptions } from './ingest/auto-sync.js';
export {
  discoverPostgresBrands,
  discoverSanitizedBrands,
  deriveBrandColor,
  formatBrandName,
  formatBrandSlug,
  inferBrandNorthStar,
} from './ingest/discovery.js';
export type { DiscoveredBrand } from './ingest/discovery.js';

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

export { getDailyBriefDashboard, listDailyBriefDates } from './repositories/daily-brief.js';
export type {
  DailyBriefDashboardData,
  DayPoint,
  CampaignWindowRow,
  DailyBriefComparison,
} from './repositories/daily-brief.js';

export {
  startReportRun,
  completeReportRun,
  failReportRun,
  latestCompletedRun,
  recentReportRuns,
  getReportRun,
  writeArtifact,
  readArtifact,
  artifactDir,
  artifactMaxAgeHours,
} from './repositories/report-run.js';
export type {
  ReportRunRow,
  ReportRunKey,
  ReportRunSeed,
  ReportRunStatus,
  ReportRunTier,
} from './repositories/report-run.js';

export { listWindowVideos } from './repositories/window-videos.js';
export type { WindowVideoRow, WindowVideosOptions } from './repositories/window-videos.js';
export { cacheThumbnail, readThumbnailDataUri, mediaDir } from './ingest/thumbnails.js';

export {
  getReportSpec,
  listReportSpecs,
  upsertReportSpec,
  deleteReportSpec,
} from './repositories/report-spec.js';
export type { StoredReportSpec } from './repositories/report-spec.js';

export {
  listBenchmarks,
  upsertBenchmark,
  deleteBenchmark,
} from './repositories/report-benchmark.js';
export type { StoredBenchmark } from './repositories/report-benchmark.js';

export { getPaidTiktokAdAccountId, getPaidTiktokAdAccountIds } from './repositories/tiktok-account.js';
export { fetchTemplateReportRawData, createSourcePool } from './ingest/template-report-data.js';
export { fetchNorthStarRawData } from './ingest/north-star-data.js';
export type {
  NorthStarRawData,
  NorthStarTotals,
  NorthStarCampaignRow,
  NorthStarCreativeRow,
} from './ingest/north-star-data.js';
export { listCandidateBrandAccounts, type CandidateBrandAccount } from './ingest/industry-peers.js';
export {
  upsertBrandIndustryTags,
  getBrandIndustry,
  listPeersByIndustry,
  listTaggedIndustries,
  clearBrandIndustryTags,
  type BrandIndustryTagInput,
} from './repositories/brand-industry.js';
export type {
  TemplateReportRawData,
  TemplateReportPeriodTotals,
  TemplateReportGmvMaxTotals,
  TemplateReportGmvMaxCampaignRow,
  TemplateReportCampaignRow,
  TemplateReportProductRow,
  TemplateReportCreativeRow,
} from './ingest/template-report-data.js';

export { recentSyncRuns } from './repositories/sync.js';
export { getSetting, setSetting, SETTINGS_KEYS } from './repositories/settings.js';
