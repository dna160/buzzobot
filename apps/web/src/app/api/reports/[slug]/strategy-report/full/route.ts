import {
  completeReportRun,
  failReportRun,
  getClientBySlug,
  getDb,
  getReportRun,
  startReportRun,
  writeArtifact,
} from '@tempo/db';
import { authenticate, corsHeaders, preflight } from '@/lib/api-auth';
import { htmlToPdf } from '@/lib/report-pdf';
import { recordStrategyRun } from '@/lib/strategy-actions';
import { assembleStrategyReport, fetchStrategyRun, startStrategyRun, StrategyEngineError } from '@/lib/strategy-report-pipeline';

/**
 * The Strategy Report's full tier, asynchronously (Strategy Report PRD §9.4,
 * §13 #1). Mirrors the deck's `brief/[objective]/full` route:
 *
 *   POST /api/reports/:slug/strategy-report/full?days=28&date=   → starts a run, returns the ledger id
 *   GET  /api/reports/:slug/strategy-report/full?runId=…         → poll; renders and stores the PDF once ready
 *
 * The engine's `POST /v1/briefs` returns at once and runs the graph in the
 * background (`auto_approve` supplies the review decision), so no request
 * holds a connection for the ~1–10 minutes the full tier takes. The render
 * happens on the poll that finds the run approved, inside a request that is
 * waiting for it. The stored PDF is then what the sibling route serves warm
 * for `?tier=full&format=pdf` on the same window.
 *
 * A class preview is not supported here: a preview is never stored, so it has
 * no reason to be asynchronous — the sibling route renders it directly.
 */
export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const OBJECTIVE = 'strategy';

export async function OPTIONS(request: Request) {
  return preflight(request);
}

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  const cors = corsHeaders(request);
  const auth = authenticate(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status ?? 401, headers: cors });

  const { slug } = await params;
  const url = new URL(request.url);
  const daysParam = Number(url.searchParams.get('days'));
  const windowDays = Number.isInteger(daysParam) && daysParam >= 14 && daysParam <= 90 ? daysParam : 28;
  const dateParam = url.searchParams.get('date');
  const endDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : undefined;

  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) return new Response(`Client "${slug}" not found`, { status: 404, headers: cors });

  let engineRunId: string;
  try {
    engineRunId = await startStrategyRun({ slug, windowDays, endDate });
  } catch (err) {
    const status = err instanceof StrategyEngineError ? err.status : 502;
    return new Response((err as Error).message, { status, headers: cors });
  }

  // The period is unknown until the engine settles the TTMS day; it is filled
  // in by `completeReportRun`, and a null-period row is never served as cache.
  const runRowId = await startReportRun(db, { clientId: client.id, objective: OBJECTIVE, tier: 'full' }, engineRunId);
  return Response.json(
    { runId: runRowId, engineRunId, status: 'running', windowDays },
    { headers: { ...cors, 'Cache-Control': 'no-store', 'X-Engine-Run-Id': engineRunId } },
  );
}

export async function GET(request: Request, { params }: RouteParams) {
  const cors = corsHeaders(request);
  const auth = authenticate(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status ?? 401, headers: cors });

  const { slug } = await params;
  const url = new URL(request.url);
  const runRowId = url.searchParams.get('runId');
  if (!runRowId) return new Response('runId is required', { status: 400, headers: cors });

  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) return new Response(`Client "${slug}" not found`, { status: 404, headers: cors });
  const row = await getReportRun(db, runRowId);
  if (!row || row.clientId !== client.id || row.objective !== OBJECTIVE) {
    return new Response(`No run ${runRowId}`, { status: 404, headers: cors });
  }

  const json = (body: Record<string, unknown>, code = 200) =>
    Response.json(body, { status: code, headers: { ...cors, 'Cache-Control': 'no-store' } });
  const downloadUrl = (days: number) =>
    `/api/reports/${encodeURIComponent(slug)}/strategy-report?tier=full&format=pdf&days=${days}`;

  if (row.status === 'completed') {
    return json({ status: 'ready', runId: row.id, engineRunId: row.runId, downloadUrl: downloadUrl(windowOf(row)) });
  }
  if (row.status === 'failed') return json({ status: 'failed', runId: row.id, error: row.error });
  if (!row.runId) return json({ status: 'failed', runId: row.id, error: 'no engine run id' });

  const brief = await fetchStrategyRun(row.runId);
  if (!brief) return json({ status: 'running', runId: row.id, note: 'engine unreachable' });
  if (brief.status === 'failed' || brief.status === 'rejected') {
    const error = (brief.content as { error?: string } | null)?.error ?? `the run was ${brief.status}`;
    await failReportRun(db, row.id, error);
    return json({ status: 'failed', runId: row.id, error });
  }
  if (brief.status !== 'approved') {
    return json({ status: 'running', runId: row.id, engineStatus: brief.status });
  }

  try {
    const report = assembleStrategyReport({ content: brief.content, runId: row.runId, clientName: client.name, slug });
    const pdf = await htmlToPdf(report.html, 'a4');
    const artifact = await writeArtifact(`${client.slug}-tempo-strategy-${row.runId}.pdf`, pdf);
    await completeReportRun(db, row.id, {
      artifactPath: artifact.path,
      artifactBytes: artifact.bytes,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
    });
    await recordStrategyRun(db, client.id, row.runId, brief.content);
    const days = daysBetween(report.periodStart, report.periodEnd);
    return json({ status: 'ready', runId: row.id, engineRunId: row.runId, downloadUrl: downloadUrl(days), bytes: artifact.bytes });
  } catch (err) {
    console.error('[strategy-report] rendering the full report failed:', err);
    await failReportRun(db, row.id, (err as Error).message);
    return json({ status: 'failed', runId: row.id, error: (err as Error).message }, 500);
  }
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

function windowOf(row: { periodStart: string | null; periodEnd: string | null }): number {
  return row.periodStart && row.periodEnd ? daysBetween(row.periodStart, row.periodEnd) : 28;
}
