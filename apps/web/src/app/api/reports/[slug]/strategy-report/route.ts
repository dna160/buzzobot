import {
  completeReportRun,
  failReportRun,
  getClientBySlug,
  getDb,
  latestCompletedRun,
  readArtifact,
  resolveStrategyWindow,
  startReportRun,
  writeArtifact,
} from '@tempo/db';
import { authenticate, corsHeaders, preflight } from '@/lib/api-auth';
import { htmlToPdf } from '@/lib/report-pdf';
import { assembleStrategyReport, requestStrategyRun, StrategyEngineError } from '@/lib/strategy-report-pipeline';
import { recordStrategyRun } from '@/lib/strategy-actions';

/**
 * `GET /api/reports/:slug/strategy-report` — the Tempo Strategy Report
 * (Strategy Report PRD §9.4).
 *
 *   ?format=html|pdf|json   default html (the panel opens it in a tab)
 *   ?tier=instant|full      instant = templates, zero model calls (≤ 10 s);
 *                           full = narrators, critics, Action Phraser, synthesist
 *   ?days=28                window length (TTMS days)
 *   ?date=YYYY-MM-DD        last day of the window (clamped to the settled TTMS day)
 *   ?class=brand|shop       preview a class without saving an override
 *   ?fresh=1                skip the stored full-tier PDF
 *
 * Same auth as every report route: same-origin passes, external callers need a
 * key. Every generation is recorded in `report_runs` (objective `strategy`);
 * full-tier PDFs are stored and served warm, which is what the Monday cron
 * pre-generates.
 */
export const runtime = 'nodejs';
// PRD G4: full tier ≤ 10 min p95 on the local 12B. Must outlast it.
export const maxDuration = 660;
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const OBJECTIVE = 'strategy';

export async function OPTIONS(request: Request) {
  return preflight(request);
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const cors = corsHeaders(request);
  const auth = authenticate(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status ?? 401, headers: cors });

  const { slug } = await params;
  const url = new URL(request.url);
  const fmt = url.searchParams.get('format');
  const format = fmt === 'pdf' || fmt === 'json' ? fmt : 'html';
  const tier = url.searchParams.get('tier') === 'full' ? 'full' : 'instant';
  const daysParam = Number(url.searchParams.get('days'));
  const windowDays = Number.isInteger(daysParam) && daysParam >= 14 && daysParam <= 90 ? daysParam : 28;
  const dateParam = url.searchParams.get('date');
  const endDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : undefined;
  const clsParam = url.searchParams.get('class');
  const reportClass = clsParam === 'brand' || clsParam === 'shop' ? clsParam : undefined;
  const fresh = url.searchParams.get('fresh') === '1';

  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) return new Response(`Client "${slug}" not found`, { status: 404, headers: cors });

  const window = await resolveStrategyWindow(db, client.id, { endDate, days: windowDays });
  if (!window) {
    return new Response(`"${slug}" has no TikTok Market Scope account linked — the Strategy Report needs one.`, {
      status: 404,
      headers: cors,
    });
  }
  const runKey = { clientId: client.id, objective: OBJECTIVE, periodStart: window.periodStart, periodEnd: window.periodEnd, tier } as const;

  // A stored full-tier PDF for this exact window is the whole point of the
  // weekly cron. A class preview is never cached: it is not the client's report.
  if (tier === 'full' && format === 'pdf' && !fresh && !reportClass) {
    const cached = await latestCompletedRun(db, runKey);
    const bytes = await readArtifact(cached?.artifactPath);
    if (cached && bytes) {
      return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
        headers: {
          ...cors,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${client.slug}-tempo-strategy-${cached.runId ?? cached.id}.pdf"`,
          'Cache-Control': 'no-store',
          'X-Engine-Run-Id': cached.runId ?? '',
          'X-Report-Artifact': 'pregenerated',
          'X-Report-Generated-At': cached.startedAt.toISOString(),
        },
      });
    }
  }

  const runRowId = format === 'pdf' && !reportClass ? await startReportRun(db, runKey) : null;
  let result;
  try {
    result = await requestStrategyRun({ slug, tier, windowDays, endDate, reportClass });
  } catch (err) {
    const status = err instanceof StrategyEngineError ? err.status : 502;
    if (runRowId) await failReportRun(db, runRowId, (err as Error).message);
    return new Response((err as Error).message, { status, headers: cors });
  }

  let report;
  try {
    report = assembleStrategyReport({ content: result.content, runId: result.runId, clientName: client.name, slug });
  } catch (err) {
    console.error('[strategy-report] engine content failed validation:', err);
    if (runRowId) await failReportRun(db, runRowId, 'content contract');
    return new Response('Strategy report content did not match the engine contract', { status: 502, headers: cors });
  }

  // PRD §5.6 / Q3: every client-facing run records its actions as `proposed`
  // (only an explicit accept starts the loop) and writes its T11 measurements of
  // running actions back. A class preview writes nothing.
  if (!reportClass) await recordStrategyRun(db, client.id, result.runId, result.content);

  const baseHeaders = { ...cors, 'X-Engine-Run-Id': result.runId, 'Cache-Control': 'no-store' };
  if (format === 'json') {
    return Response.json({ run_id: result.runId, status: result.status, tier, report: report.model }, { headers: baseHeaders });
  }
  if (format === 'html') {
    return new Response(report.html, { headers: { ...baseHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const filename = `${client.slug}-tempo-strategy-${result.runId}.pdf`;
  try {
    const pdf = await htmlToPdf(report.html, 'deck');
    let artifact: { path: string; bytes: number } | null = null;
    if (tier === 'full') {
      try {
        artifact = await writeArtifact(filename, pdf);
      } catch (err) {
        console.error('[strategy-report] storing the artifact failed:', err);
      }
    }
    if (runRowId) {
      await completeReportRun(db, runRowId, {
        artifactPath: artifact?.path ?? null,
        artifactBytes: artifact?.bytes ?? pdf.byteLength,
        runId: result.runId,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
      });
    }
    return new Response(pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer, {
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Report-Artifact': artifact ? 'stored' : 'live',
      },
    });
  } catch (err) {
    console.error('[strategy-report] PDF generation failed:', err);
    if (runRowId) await failReportRun(db, runRowId, (err as Error).message);
    return new Response('Failed to generate the PDF', { status: 500, headers: cors });
  }
}
