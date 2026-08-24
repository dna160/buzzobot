import { getDb, listClients, type ClientSummary } from '@tempo/db';

/**
 * Weekly deck pre-generation (Brief Deck PRD §5).
 *
 * The full tier costs minutes by design (~24 model calls on the 12B budget).
 * Nobody should spend those minutes waiting on a Monday morning — so this runs
 * overnight, asks the app for each client's full-tier deck, and the route
 * stores the rendered PDF in `report_runs`. The next download is a file read.
 *
 * It deliberately calls the **public route** rather than reassembling the
 * pipeline here. The artifact a client downloads is then byte-for-byte the
 * artifact this job produced, and there is exactly one code path that knows how
 * a deck is built. The cost is that this job needs an API key like any other
 * external caller, which is the right shape anyway.
 *
 * Failures are per client: one brand's engine run going wrong must not cost the
 * other nineteen their Monday deck.
 */

export interface PregenerateOptions {
  /** Where the web app is reachable, e.g. `http://127.0.0.1:3000`. */
  baseUrl?: string;
  /** An API key from `REPORT_API_KEYS` — the job is an external caller. */
  apiKey?: string;
  /** Window length; matches the route's own default. */
  windowDays?: number;
  /** Limit to specific client slugs. Default: every client. */
  slugs?: string[];
  /** Per-deck timeout. The full tier is slow, but not unbounded. */
  timeoutMs?: number;
}

export interface PregenerateResult {
  slug: string;
  objective: string;
  ok: boolean;
  bytes?: number;
  runId?: string | null;
  status?: number;
  error?: string;
  durationMs: number;
}

/**
 * Which decks a client gets. Awareness is available to everyone (the route's
 * own gate allows it for any north star); the objective deck is whichever one
 * that client's north star makes honest.
 */
export function objectivesFor(client: ClientSummary): string[] {
  const byNorthStar: Record<string, string | null> = {
    vtr: null, // awareness already covers a VTR client
    shop: 'gmv',
    app_install: 'install',
  };
  const specific = byNorthStar[client.northStar] ?? null;
  return specific ? ['awareness', specific] : ['awareness'];
}

export async function pregenerateDecks(
  options: PregenerateOptions = {},
): Promise<PregenerateResult[]> {
  const baseUrl = (options.baseUrl ?? process.env.TEMPO_APP_URL ?? 'http://127.0.0.1:3000').replace(
    /\/$/,
    '',
  );
  const apiKey = options.apiKey ?? process.env.DECK_CRON_API_KEY ?? '';
  const windowDays = options.windowDays ?? 7;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;

  if (!apiKey) {
    // Fail loudly and early: the route fails closed on an unset key, so
    // without one this job would produce a directory of 401s.
    throw new Error(
      'DECK_CRON_API_KEY is required — the pre-generation job calls the report API as an ' +
        'external caller and REPORT_API_KEYS fails closed.',
    );
  }

  const { db } = getDb();
  const all = await listClients(db);
  const clients = options.slugs?.length
    ? all.filter((c) => options.slugs!.includes(c.slug))
    : all;

  const results: PregenerateResult[] = [];
  for (const client of clients) {
    for (const objective of objectivesFor(client)) {
      const startedAt = Date.now();
      const url = `${baseUrl}/api/reports/${client.slug}/brief/${objective}?tier=full&days=${windowDays}&fresh=1`;
      try {
        const response = await fetch(url, {
          headers: { 'X-API-Key': apiKey },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          results.push({
            slug: client.slug,
            objective,
            ok: false,
            status: response.status,
            error: (await response.text()).slice(0, 200),
            durationMs: Date.now() - startedAt,
          });
          continue;
        }
        // The body is drained rather than kept: the route already stored the
        // artifact and recorded the run. This job only needs to know it worked.
        const bytes = (await response.arrayBuffer()).byteLength;
        results.push({
          slug: client.slug,
          objective,
          ok: true,
          bytes,
          runId: response.headers.get('X-Engine-Run-Id'),
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        results.push({
          slug: client.slug,
          objective,
          ok: false,
          error: (error as Error).message,
          durationMs: Date.now() - startedAt,
        });
      }
    }
  }
  return results;
}

export function summarize(results: PregenerateResult[]): string {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const totalMinutes = results.reduce((sum, r) => sum + r.durationMs, 0) / 60_000;
  const lines = [
    `${ok.length}/${results.length} decks pre-generated in ${totalMinutes.toFixed(1)} min`,
    ...failed.map((r) => `  ✗ ${r.slug}/${r.objective}: ${r.status ?? ''} ${r.error ?? ''}`.trim()),
  ];
  return lines.join('\n');
}
