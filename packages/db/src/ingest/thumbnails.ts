import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Thumbnail caching (Brief Deck PRD §6, M4).
 *
 * Two facts force this to happen at ingestion rather than at render time:
 *
 *  1. **TikTok CDN URLs expire.** A deck generated next week from a
 *     `thumbnail_url` captured today renders broken images — and a report that
 *     silently degrades weeks later is worse than one that never had pictures.
 *  2. **The instant tier has ten seconds.** N image fetches inside the render
 *     path would spend most of them, and the deck must contain no network
 *     request at all (the HTML is self-contained, headless Chromium runs with
 *     no network).
 *
 * So bytes are fetched once, written under `TEMPO_MEDIA_DIR`, and the path is
 * stored on the row. A miss is never fatal: the deck draws a branded
 * placeholder instead, which is a design, not a failure state.
 *
 * Deliberately not stored in Postgres. Thumbnails are opaque blobs nothing
 * queries, they would bloat every `SELECT *` on `videos`, and the two processes
 * that touch them (ingestion and the web app) already share a host — see
 * `ecosystem.config.cjs`.
 */

/** Where cached thumbnails live. Override per deployment. */
export const mediaDir = (): string => process.env.TEMPO_MEDIA_DIR ?? '.tempo-media/thumbnails';

/** Cap per image: a thumbnail larger than this is not a thumbnail. */
export const MAX_THUMBNAIL_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Stable per (video, url): a re-ingest with an unchanged URL is a no-op. */
function cacheKey(externalId: string, url: string): string {
  return createHash('sha256').update(`${externalId}::${url}`).digest('hex').slice(0, 32);
}

export interface CacheThumbnailResult {
  path: string | null;
  /** `hit` = already cached, `fetched` = downloaded now, `skipped` = no URL. */
  outcome: 'hit' | 'fetched' | 'skipped' | 'failed';
  reason?: string;
}

/**
 * Cache one thumbnail, returning the path to store on the row.
 *
 * Never throws. Ingestion of a client's metrics must not fail because an image
 * host was slow — the deck degrades to a placeholder and everything else about
 * that video still renders.
 */
export async function cacheThumbnail(
  externalId: string,
  url: string | null | undefined,
  options: { dir?: string; fetchImpl?: typeof fetch } = {},
): Promise<CacheThumbnailResult> {
  if (!url) return { path: null, outcome: 'skipped', reason: 'no thumbnail url' };

  const dir = options.dir ?? mediaDir();
  const doFetch = options.fetchImpl ?? fetch;
  const key = cacheKey(externalId, url);

  // A cached file for this exact (video, url) pair is already the right bytes.
  for (const ext of new Set(Object.values(EXTENSION_BY_TYPE))) {
    const candidate = join(dir, `${key}.${ext}`);
    try {
      await stat(candidate);
      return { path: candidate, outcome: 'hit' };
    } catch {
      // not cached under this extension; keep looking
    }
  }

  try {
    const response = await doFetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      return { path: null, outcome: 'failed', reason: `HTTP ${response.status}` };
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
    const extension = EXTENSION_BY_TYPE[contentType];
    if (!extension) {
      return { path: null, outcome: 'failed', reason: `unsupported type ${contentType || 'unknown'}` };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0) return { path: null, outcome: 'failed', reason: 'empty body' };
    if (bytes.byteLength > MAX_THUMBNAIL_BYTES) {
      return { path: null, outcome: 'failed', reason: `too large (${bytes.byteLength} bytes)` };
    }

    await mkdir(dir, { recursive: true });
    const path = join(dir, `${key}.${extension}`);
    await writeFile(path, bytes);
    return { path, outcome: 'fetched' };
  } catch (error) {
    return { path: null, outcome: 'failed', reason: (error as Error).message };
  }
}

/**
 * Read a cached thumbnail back as a `data:` URI for embedding.
 *
 * The deck is a single self-contained HTML document with no network access at
 * render time, so an `<img src="/path">` would be a blank box. Returns null on
 * any problem — a missing or unreadable file is a placeholder, not an error.
 */
export async function readThumbnailDataUri(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_THUMBNAIL_BYTES) return null;
    const extension = path.split('.').pop()?.toLowerCase();
    const mime =
      Object.entries(EXTENSION_BY_TYPE).find(([, ext]) => ext === extension)?.[0] ?? 'image/jpeg';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}
