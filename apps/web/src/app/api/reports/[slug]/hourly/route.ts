import { getClientBySlug, getDb, getHourlyDashboard, listHourlyDates } from '@tempo/db';
import { renderHourlyHtml } from '@tempo/reports';
import { htmlToPdf } from '@/lib/report-pdf';
import { authenticate, corsHeaders, preflight } from '@/lib/api-auth';

/**
 * GET /api/reports/:slug/hourly?date=&format=
 *
 * The intraday report — the one document the Brief Deck did not replace.
 *
 * M7 removed the hourly document on the premise that the deck superseded all
 * three client documents. It superseded the day-grain ones: the deck's numbers
 * come from `getDailyBriefDashboard`, and nothing in the deck pipeline reads
 * `paid_hourly_metrics`. So the ingestion a premium client's
 * `*_daily_performance` table exists to feed had a dashboard and no deliverable.
 * This route is that deliverable, and it is deliberately *not* a deck:
 *
 *   - **No engine call.** `tempo-engine` analyses at day/window grain only
 *     (`ports/tempo_read.py`: "every aggregation in this module is at
 *     day/window grain, never hourly"). Asking it to narrate an hour-by-hour
 *     document would either fabricate or fall back to templates, and it would
 *     put a service dependency on a report that needs none. Every figure here
 *     is the read-model's own.
 *   - **No objective gate.** The 409 the deck route raises exists because
 *     presenting a GMV deck for an app-install client mislabels real data. An
 *     intraday report has no objective to mislabel — it reports the hours as
 *     they were. The client's north star only chooses which figures lead.
 *
 * Availability is therefore exactly "does this client have intraday rows",
 * which is exactly the premium tier: `discoverPostgresBrands` marks a client
 * premium iff a `<brand>_daily_performance` table exists to ingest from. A
 * standard client gets 404 with the reason, not an empty report.
 *
 * `format` is `pdf` (default), `html` (what the portal embeds) or `json` (the
 * raw read-model). Auth and CORS are the same key/origin contract as the deck
 * routes — see lib/api-auth.ts.
 */
export const runtime = 'nodejs';
// No engine call and no model call: this is read-model + Chromium only. The
// budget is the PDF render, not a narrative round trip.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function OPTIONS(request: Request) {
  return preflight(request);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const cors = corsHeaders(request);
  const auth = authenticate(request);
  if (!auth.ok) {
    return new Response(auth.message, { status: auth.status ?? 401, headers: cors });
  }

  const { slug } = await params;
  const url = new URL(request.url);
  const formatParam = url.searchParams.get('format');
  const format = formatParam === 'html' || formatParam === 'json' ? formatParam : 'pdf';
  const dateParam = url.searchParams.get('date');
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : undefined;

  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) {
    return new Response(`Client "${slug}" not found`, { status: 404, headers: cors });
  }

  // `getHourlyDashboard` resolves an unknown date to the most recent one with
  // data. That is right for the dashboard — the view should always land on
  // something — and wrong for a document: a report requested for one date and
  // rendered from another is mislabeled, and every number in it would be read
  // against the wrong day. So the fallback is honoured only when no date was
  // asked for, and an explicit miss is refused with the dates that do exist.
  const data = await getHourlyDashboard(db, client, date);
  const missed = data !== null && date !== undefined && data.date !== date;

  if (!data || missed) {
    const available = await listHourlyDates(db, client.id).catch(() => [] as string[]);
    const detail = date
      ? `No intraday data for "${slug}" on ${date}.`
      : `No intraday data ingested for "${slug}".`;
    const hint = available.length
      ? ` Available dates: ${available.slice(-14).join(', ')}.`
      : ' This client has no hourly ingestion — an intraday report needs a *_daily_performance source table.';
    return new Response(detail + hint, { status: 404, headers: cors });
  }

  const baseHeaders = {
    ...cors,
    'Cache-Control': 'no-store',
    // Says which date was actually rendered, which matters when the caller
    // omitted one and got the latest.
    'X-Report-Date': data.date,
  };

  if (format === 'json') {
    return Response.json(data, { headers: baseHeaders });
  }

  const html = renderHourlyHtml(data);

  if (format === 'html') {
    return new Response(html, {
      headers: { ...baseHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const filename = `${client.slug}-tiktok-hourly-${data.date}.pdf`;
  try {
    const pdf = await htmlToPdf(html, 'a4');
    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    return new Response(body, {
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    // The deck route learned this the hard way: a 500 with an empty body reads
    // as "nothing happened" at every caller upstream. Say what broke.
    console.error('[reports] hourly PDF generation failed:', err);
    return new Response(`Failed to render the hourly PDF: ${(err as Error).message}`, {
      status: 500,
      headers: cors,
    });
  }
}
