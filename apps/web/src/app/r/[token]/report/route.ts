import { getDb, resolveReportLink } from '@tempo/db';
import { jakartaYesterday } from '@tempo/reports';
import { htmlToPdf } from '@/lib/report-pdf';
import {
  getOrGenerateSharedReport,
  isTokenShaped,
  requestedRange,
  sharedReportStatus,
  storedSharedReportHtml,
} from '@/lib/report-share';

/**
 * GET /r/:token/report?from=YYYY-MM-DD&to=YYYY-MM-DD[&wait=1|&format=pdf]
 *
 * What the shared report page (`/r/:token`) fetches. Public: the token is the
 * credential. Answers JSON —
 *
 *   200 { status: 'ready', html, generatedAt }   served from the ledger, or just generated
 *   202 { status: 'running', startedAt }         another request is generating this window
 *   200 { status: 'failed', message }            the last generation failed (shown, not retried)
 *   200 { status: 'idle' }                       (wait=1 only) nothing generated yet
 *   429 { status: 'busy' }                       this client already has its maximum running
 *
 * Without `wait`, a window with no fresh report is generated inside this
 * request (one to three minutes). `wait=1` only reports where things stand —
 * the page polls with it, so a failed run is not silently restarted per poll.
 *
 * `format=pdf` prints the stored report for the window (never generates one)
 * as an A4 attachment, the same rendering as the API route's `format=pdf`.
 */
export const runtime = 'nodejs';
// Same budget as `/api/reports/:slug/template-report` — this runs the same generation.
export const maxDuration = 600;
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const notFound = () =>
    Response.json({ status: 'not_found', message: 'Link tidak valid atau sudah dicabut.' }, { status: 404, headers: NO_STORE });
  if (!isTokenShaped(token)) return notFound();

  const { db } = getDb();
  const client = await resolveReportLink(db, token);
  if (!client) return notFound();

  const url = new URL(request.url);
  const latestDay = jakartaYesterday(new Date());
  const { range, issue } = requestedRange(url, latestDay);
  if (issue) return Response.json({ status: 'invalid', message: issue }, { status: 400, headers: NO_STORE });

  if (url.searchParams.get('format') === 'pdf') {
    const html = await storedSharedReportHtml(db, client, range);
    if (!html) return new Response('Generate the report for this period first.', { status: 409, headers: NO_STORE });
    const pdf = await htmlToPdf(html, 'a4');
    const filename = `${client.slug}-tiktok-ads-performance-report-${range.from}_${range.to}.pdf`;
    return new Response(pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer, {
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  const result =
    url.searchParams.get('wait') === '1'
      ? await sharedReportStatus(db, client, range, latestDay)
      : await getOrGenerateSharedReport(db, client, range, latestDay);

  const status = result.status === 'running' ? 202 : result.status === 'busy' ? 429 : 200;
  // The viewer is the brand, not us: the real cause (LM Studio, a missing ad
  // account, the source DB) stays in `template_report_runs.error` and the log.
  const body =
    result.status === 'failed'
      ? { status: 'failed', message: 'Laporan untuk periode ini gagal dibuat. Silakan coba lagi beberapa saat lagi.' }
      : result;
  return Response.json(body, { status, headers: NO_STORE });
}
