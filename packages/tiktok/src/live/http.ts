/**
 * Minimal resilient HTTP client for TikTok APIs: timeout, bounded retries with
 * exponential backoff + jitter on 429/5xx, and typed JSON parsing. Kept
 * dependency-free (native fetch) so it runs anywhere Node 20+ does.
 */

export class TikTokApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number | string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'TikTokApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isRetryable = (status: number) => status === 429 || (status >= 500 && status < 600);

export async function requestJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, query, body, timeoutMs = 20_000, maxRetries = 3 } = opts;

  const target = new URL(url);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) target.searchParams.set(k, String(v));
    }
  }

  let attempt = 0;
  // Retry loop: backoff 500ms, 1s, 2s (+ jitter) on transient failures.
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(target, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        if (isRetryable(res.status) && attempt < maxRetries) {
          attempt += 1;
          await sleep(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
          continue;
        }
        throw new TikTokApiError(
          `TikTok API ${res.status} ${res.statusText}`,
          res.status,
          undefined,
          res.headers.get('x-tt-logid') ?? undefined,
        );
      }

      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof TikTokApiError) throw err;
      if (attempt < maxRetries) {
        attempt += 1;
        await sleep(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
        continue;
      }
      throw new TikTokApiError(
        `TikTok API request failed: ${(err as Error).message}`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
