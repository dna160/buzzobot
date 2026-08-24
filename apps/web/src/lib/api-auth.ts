import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * API-key authentication and CORS for the machine-callable report endpoints.
 *
 * These endpoints expose a client's advertising performance, so anything not
 * originating from this app's own UI must present a key. Keys live only in the
 * environment and are compared in constant time; a mismatch never says which
 * part was wrong.
 */

/** Configured keys. Comma-separated so several callers can be revoked apart. */
function configuredKeys(): string[] {
  return (process.env.REPORT_API_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Origins permitted to call cross-origin, e.g. the Buzzo portal. */
function allowedOrigins(): string[] {
  return (process.env.REPORT_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Constant-time compare that doesn't leak length. Comparing raw buffers of
 * different lengths throws, and returning early on a length mismatch is itself
 * a timing signal — hashing both sides to a fixed width avoids both.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = Buffer.from(a.padEnd(64, '\0').slice(0, 64));
  const hb = Buffer.from(b.padEnd(64, '\0').slice(0, 64));
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/**
 * Who is calling, in a form that is safe to write to a log.
 *
 * Needed by the deprecated-endpoint alias (Brief Deck PRD §11 R6, K5): "remove
 * it once no unknown caller is left" is only answerable if the log says *which*
 * caller, and a key in a log file is a key that has leaked. `keyId` is a
 * truncated digest — enough to tell two integrations apart and to match one
 * against `REPORT_API_KEYS`, useless to anyone who reads it.
 */
export type Caller =
  | { kind: 'same-origin' }
  | { kind: 'api-key'; keyId: string };

export interface AuthResult {
  ok: boolean;
  /** Set when the request is accepted. */
  caller?: Caller;
  /** Set when the request is rejected — safe to return to the caller. */
  status?: 401 | 403 | 503;
  message?: string;
}

/** A stable, non-reversible id for a presented key. Never log the key itself. */
function keyFingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/**
 * Authenticate a report request.
 *
 * Same-origin browser requests from this app are allowed through without a key
 * (the app has no user auth yet, so a key would add nothing but friction).
 * Everything else — the portal, cron jobs, curl — must present one.
 */
export function authenticate(request: Request): AuthResult {
  const keys = configuredKeys();
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  // Same-origin request from the app's own UI.
  if (origin && host && new URL(origin).host === host) {
    return { ok: true, caller: { kind: 'same-origin' } };
  }
  // A browser navigation / fetch with no Origin header from our own page.
  if (!origin && request.headers.get('sec-fetch-site') === 'same-origin') {
    return { ok: true, caller: { kind: 'same-origin' } };
  }

  const presented =
    request.headers.get('x-api-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  if (!presented) {
    return {
      ok: false,
      status: 401,
      message: 'Missing API key. Send it as "X-API-Key" or "Authorization: Bearer <key>".',
    };
  }

  if (keys.length === 0) {
    // Fail closed: an unset REPORT_API_KEYS must not mean "allow everyone".
    return {
      ok: false,
      status: 503,
      message: 'External API access is not configured on this deployment.',
    };
  }

  const matched = keys.some((k) => safeEqual(k, presented));
  if (!matched) return { ok: false, status: 403, message: 'Invalid API key.' };

  // A cross-origin browser caller must also be on the origin allowlist, so a
  // leaked key cannot be used from an attacker-controlled page.
  if (origin && !allowedOrigins().includes(origin.replace(/\/+$/, ''))) {
    return { ok: false, status: 403, message: `Origin ${origin} is not allowed.` };
  }

  return { ok: true, caller: { kind: 'api-key', keyId: keyFingerprint(presented) } };
}

/** CORS headers for an allowed origin. Never echoes an unlisted one. */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  if (!allowedOrigins().includes(origin.replace(/\/+$/, ''))) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'X-API-Key, Authorization, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Disposition',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Preflight response. */
export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
