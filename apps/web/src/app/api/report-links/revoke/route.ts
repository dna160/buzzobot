import { getClientBySlug, getDb, revokeReportLink } from '@tempo/db';
import { authenticateApiKey } from '@/lib/api-auth';

/**
 * POST /api/report-links/revoke   body: { slug }
 *   → { revoked: 0 | 1 }
 *
 * Kills a client's shared report link at once — `/r/:token` answers 404 from
 * the next request. The next `POST /api/report-links` for that client issues a
 * new token, so revoking is also how a link is rotated. API key only.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = authenticateApiKey(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status ?? 401 });

  const body = (await request.json().catch(() => null)) as { slug?: unknown } | null;
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  if (!slug) return new Response('slug is required', { status: 400 });

  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) return new Response(`Client "${slug}" not found`, { status: 404 });

  const revoked = await revokeReportLink(db, client.id);
  return Response.json({ revoked }, { headers: { 'Cache-Control': 'no-store' } });
}
