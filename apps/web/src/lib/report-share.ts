import {
  artifactMaxAgeHours,
  claimTemplateReportRun,
  completeTemplateReportRun,
  countRunningTemplateReportRuns,
  createSourcePool,
  failTemplateReportRun,
  getPaidTiktokAdAccountIds,
  latestCompletedTemplateReportRun,
  latestTemplateReportRun,
  readArtifact,
  writeArtifact,
  type ClientSummary,
  type getDb,
  type TemplateReportRunKey,
} from '@tempo/db';
import { defaultReportRange, reportRangeIssue, type ReportDateRange } from '@tempo/reports';
import { generateTemplateReport, NarrativeGenerationError } from '@/lib/template-report-generate';

/**
 * The shared Template Report link (`/r/:token`): what a brand's own people
 * open from the portal's "Generate Report", with no Tempo login.
 *
 * Every window is generated once and then served from the ledger
 * (`template_report_runs` + an HTML file), because a generation costs minutes
 * of LM Studio time and must not be something holding a link can trigger on
 * every refresh. The report is always the client's own north-star template,
 * graded against its stored benchmarks — the same defaults an AM starts on in
 * the Template Report panel.
 *
 * Generation runs inside the request that asked for it, never as a detached
 * promise (same rule as the full-tier deck route). If a proxy in front of
 * Tempo gives up on that request first, Node keeps executing the handler, the
 * result still lands in the ledger, and the page's poll picks it up.
 */

type Db = ReturnType<typeof getDb>['db'];

/** Widest window a link may ask for — a year, plus the leap day. */
export const SHARE_MAX_RANGE_DAYS = 366;

/** Concurrent generations one client's link may have going, across all windows. */
const MAX_RUNNING_PER_CLIENT = 2;

/**
 * A window that ended at least this many days before the newest data day is
 * settled: late conversions have landed, so its report is kept for good.
 * Anything more recent is regenerated once its artifact is older than
 * `DECK_ARTIFACT_MAX_AGE_HOURS` (default 24h) — the same freshness rule decks use.
 */
const SETTLED_AFTER_DAYS = 7;

export type SharedReportResult =
  | { status: 'ready'; html: string; generatedAt: Date }
  | { status: 'running'; startedAt: Date | null }
  | { status: 'idle' }
  | { status: 'failed'; message: string }
  | { status: 'busy' };

/** Cheap shape check before a token reaches the database — 32 bytes of base64url is 43 characters. */
export function isTokenShaped(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/**
 * The window a `/r/:token` request asks for: `?from=&to=`, or the default
 * (this month through yesterday, WIB) when both are absent.
 */
export function requestedRange(
  url: URL,
  latestDay: string,
): { range: ReportDateRange; issue: string | null; explicit: boolean } {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from && !to) return { range: defaultReportRange(latestDay), issue: null, explicit: false };
  if (!from || !to) return { range: defaultReportRange(latestDay), issue: 'from and to must be given together', explicit: true };
  const range = { from, to };
  return { range, issue: reportRangeIssue(range, latestDay, SHARE_MAX_RANGE_DAYS), explicit: true };
}

/** Public URL for a token. `REPORT_SHARE_BASE_URL` is the externally reachable origin; Tempo itself is internal. */
export function shareUrl(request: Request, token: string): string {
  const base = (process.env.REPORT_SHARE_BASE_URL ?? new URL(request.url).origin).replace(/\/+$/, '');
  return `${base}/r/${encodeURIComponent(token)}`;
}

export function shareRunKey(client: ClientSummary, range: ReportDateRange): TemplateReportRunKey {
  return {
    clientId: client.id,
    template: client.northStar,
    benchmarkMode: 'industry',
    periodStart: range.from,
    periodEnd: range.to,
  };
}

function addOneDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function wholeDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The stored report for this window if one is fresh enough to serve. */
async function servable(
  db: Db,
  key: TemplateReportRunKey,
  latestDay: string,
): Promise<{ html: string; generatedAt: Date } | null> {
  const settled = wholeDaysBetween(key.periodEnd, latestDay) >= SETTLED_AFTER_DAYS;
  const run = await latestCompletedTemplateReportRun(db, key, settled ? null : artifactMaxAgeHours());
  if (!run) return null;
  const bytes = await readArtifact(run.artifactPath);
  return bytes ? { html: bytes.toString('utf8'), generatedAt: run.finishedAt ?? run.startedAt } : null;
}

/**
 * Where a window stands, without starting anything — what the page polls with
 * while a generation is in flight, so a failed run is reported rather than
 * silently retried on every poll.
 */
export async function sharedReportStatus(
  db: Db,
  client: ClientSummary,
  range: ReportDateRange,
  latestDay: string,
): Promise<SharedReportResult> {
  const key = shareRunKey(client, range);
  const ready = await servable(db, key, latestDay);
  if (ready) return { status: 'ready', ...ready };

  const latest = await latestTemplateReportRun(db, key);
  if (latest?.status === 'running') return { status: 'running', startedAt: latest.startedAt };
  if (latest?.status === 'failed') return { status: 'failed', message: latest.error ?? 'Generation failed' };
  return { status: 'idle' };
}

/**
 * Serve the window, or generate it now. Returns `running` when another request
 * already holds this window's generation, and `busy` when the client is at its
 * concurrency cap.
 */
export async function getOrGenerateSharedReport(
  db: Db,
  client: ClientSummary,
  range: ReportDateRange,
  latestDay: string,
): Promise<SharedReportResult> {
  const key = shareRunKey(client, range);
  const ready = await servable(db, key, latestDay);
  if (ready) return { status: 'ready', ...ready };

  if ((await countRunningTemplateReportRuns(db, client.id)) >= MAX_RUNNING_PER_CLIENT) {
    const latest = await latestTemplateReportRun(db, key);
    return latest?.status === 'running' ? { status: 'running', startedAt: latest.startedAt } : { status: 'busy' };
  }

  const runId = await claimTemplateReportRun(db, key);
  if (!runId) {
    const latest = await latestTemplateReportRun(db, key);
    return { status: 'running', startedAt: latest?.startedAt ?? null };
  }

  const fail = async (message: string): Promise<SharedReportResult> => {
    await failTemplateReportRun(db, runId, message);
    return { status: 'failed', message };
  };

  const tiktokAdAccountIds = await getPaidTiktokAdAccountIds(db, client.id);
  if (tiktokAdAccountIds.length === 0) return fail(`"${client.slug}" has no TikTok ad account on record`);

  const pool = createSourcePool();
  if (!pool) return fail('Source TikTok database is not configured (DB_HOST/DB_NAME/DB_USER)');

  try {
    const report = await generateTemplateReport({
      db,
      pool,
      client,
      tiktokAdAccountIds,
      template: client.northStar,
      benchmarkMode: 'industry',
      windowStart: range.from,
      windowEnd: addOneDay(range.to),
    });
    const artifact = await writeArtifact(
      `${client.slug}-template-report-${key.template}-${range.from}_${range.to}-${runId}.html`,
      Buffer.from(report.html, 'utf8'),
    );
    await completeTemplateReportRun(db, runId, { artifactPath: artifact.path, artifactBytes: artifact.bytes });
    return { status: 'ready', html: report.html, generatedAt: new Date() };
  } catch (err) {
    if (!(err instanceof NarrativeGenerationError)) {
      console.error('[report-share] generation failed:', err);
    }
    return fail((err as Error).message);
  } finally {
    await pool.end();
  }
}

/** The newest stored report for a window regardless of age — the PDF button prints what is on screen. */
export async function storedSharedReportHtml(db: Db, client: ClientSummary, range: ReportDateRange): Promise<string | null> {
  const run = await latestCompletedTemplateReportRun(db, shareRunKey(client, range), null);
  const bytes = run ? await readArtifact(run.artifactPath) : null;
  return bytes ? bytes.toString('utf8') : null;
}
