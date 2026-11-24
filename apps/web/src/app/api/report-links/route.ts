import { getClientBySlug, getDb, issueReportLink } from '@tempo/db';
import { authenticateApiKey } from '@/lib/api-auth';
import { shareUrl } from '@/lib/report-share';

/**
 * POST /api/report-links   body: { slug, createdBy? }
 *   → { url, token, created }
 *
 * Issues (or returns) a client's shareable Template Report link — what the
 * portal's "Generate Report" calls server-side before opening `/r/:token` in a
 * new tab. Asking twice returns the same link, so one pasted into a chat stays
 * valid; `POST /api/report-links/revoke` is how it is retired.
 *
 * API key only (`authenticateApiKey`): this app's own UI never issues links,
 * so there is no same-origin caller to let through.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = authenticateApiKey(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status ?? 401 });

  const body = (await request.json().catch(() => null)) as { slug?: unknown; createdBy?: unknown } | null;
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  if (!slug) return new Response('slug is required', { status: 400 });
  const createdBy = typeof body?.createdBy === 'string' ? body.createdBy.slice(0, 200) : null;

  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) return new Response(`Client "${slug}" not found`, { status: 404 });

  const { link, created } = await issueReportLink(db, client.id, createdBy);
  return Response.json(
    { url: shareUrl(request, link.token), token: link.token, created },
    { status: created ? 201 : 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
