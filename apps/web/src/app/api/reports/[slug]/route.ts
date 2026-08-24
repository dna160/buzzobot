import { BriefObjective, NORTH_STAR_OBJECTIVE } from '@tempo/core';
import { getClientBySlug, getDb } from '@tempo/db';
import { authenticate, corsHeaders, preflight, type Caller } from '@/lib/api-auth';

/**
 * GET /api/reports/:slug — **deprecated alias** (Brief Deck PRD §1 K5, §11 R6).
 *
 * This used to render the intraday hourly report. That document is gone: the
 * Brief Deck replaces all three client documents with one 16:9 deck per
 * objective, so there is no longer an "the report" for a slug — there is a deck
 * per objective, and which one is honest for a client is decided by its north
 * star. The alias makes that choice on the caller's behalf and redirects.
 *
 *   308 → /api/reports/:slug/brief/:objective
 *
 * 308 rather than 302 so method and body survive, and so a caller that follows
 * redirects (curl -L, fetch, every HTTP client the portal uses) keeps working
 * untouched. `format`, `date` and `days` carry over unchanged; `lang` carries
 * over and is ignored downstream, because the deck is Bahasa-only.
 *
 * **Every call is logged** with the caller's identity. That is the whole point
 * of the alias existing at all: R6 says a kill without caller logging is how
 * portals break silently, so removal one release from now is gated on the log
 * showing no caller we cannot name — not on anyone's confidence.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/** The successor path, ready to paste into a caller's config. */
const SUCCESSOR = '/api/reports/:slug/brief/:objective';

/** Query parameters the deck route understands. `lang` is accepted, not honoured. */
const FORWARDED_PARAMS = ['format', 'date', 'days', 'lang', 'tier', 'fresh'] as const;

function describeCaller(caller: Caller | undefined, request: Request): string {
  const origin = request.headers.get('origin') ?? request.headers.get('referer') ?? 'no-origin';
  const agent = request.headers.get('user-agent') ?? 'no-user-agent';
  const who = caller?.kind === 'api-key' ? `key:${caller.keyId}` : (caller?.kind ?? 'unknown');
  return `caller=${who} origin=${origin} ua=${JSON.stringify(agent)}`;
}

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

  // Logged before the client lookup, so a call for a slug that no longer exists
  // still shows up as a caller that has not migrated.
  console.warn(
    `[reports] DEPRECATED GET /api/reports/${slug} — ${describeCaller(auth.caller, request)} ` +
      `query=${JSON.stringify(url.search)} successor=${SUCCESSOR}`,
  );

  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) {
    return new Response(`Client "${slug}" not found`, { status: 404, headers: cors });
  }

  // Which deck a client's single "the report" now means. `NORTH_STAR_OBJECTIVE`
  // is the inverse of the same table the brief route's 409 gate reads, so the
  // alias can never redirect a caller to a deck that route would refuse.
  // Awareness is the fallback because it is the one objective open to everyone.
  const objective = NORTH_STAR_OBJECTIVE[client.northStar] ?? BriefObjective.Awareness;

  const forwarded = new URLSearchParams();
  for (const key of FORWARDED_PARAMS) {
    const value = url.searchParams.get(key);
    if (value !== null) forwarded.set(key, value);
  }
  const query = forwarded.size > 0 ? `?${forwarded.toString()}` : '';
  const location = `/api/reports/${encodeURIComponent(slug)}/brief/${objective}${query}`;

  return new Response(null, {
    status: 308,
    headers: {
      ...cors,
      Location: location,
      // RFC 8594 — machine-readable "this is going away", so a caller's own
      // monitoring can flag it without anyone reading our logs.
      Deprecation: 'true',
      Link: `<${location}>; rel="successor-version"`,
      'Cache-Control': 'no-store',
    },
  });
}
