import { getDb, resolveReportLink } from '@tempo/db';
import { defaultReportRange, jakartaYesterday } from '@tempo/reports';
import { isTokenShaped, requestedRange } from '@/lib/report-share';
import { renderShareNotFound, renderSharePage } from '@/lib/report-share-page';

/**
 * GET /r/:token?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * A client's shared Template Report — the stable link the portal's "Generate
 * Report" opens, and what is sent on to the brand. Public: the token is the
 * credential (issued by `POST /api/report-links`). With no `from`/`to` it opens
 * on this month through yesterday (Asia/Jakarta), or the whole previous month
 * on the 1st. The page loads at once and fetches the report itself from
 * `/r/:token/report`, so a first-time window's one-to-three-minute generation
 * is a spinner rather than a blank tab.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const client = isTokenShaped(token) ? await resolveReportLink(getDb().db, token) : null;
  if (!client) return new Response(renderShareNotFound(), { status: 404, headers: HEADERS });

  const latestDay = jakartaYesterday(new Date());
  const requested = requestedRange(new URL(request.url), latestDay);
  // A bad window in the URL opens on the default instead, with the reason shown.
  const range = requested.issue ? defaultReportRange(latestDay) : requested.range;

  return new Response(renderSharePage({ token, client, latestDay, range, issue: requested.issue }), {
    headers: HEADERS,
  });
}
