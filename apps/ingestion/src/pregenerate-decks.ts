import { getDb, listClients, listMarketScopeClientIds, type ClientSummary } from '@tempo/db';

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
 *
 * The Strategy Report (Strategy Report PRD §9.5) rides the same job: every
 * client with a mirrored TikTok Market Scope account also gets a full-tier
 * 28-day strategy report, stored by its route and served warm. Clients are
 * taken east to west, so the ones whose 06:00 arrives first are done first.
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
export function objectivesFor(client: ClientSummary, { marketScope = false }: { marketScope?: boolean } = {}): string[] {
  const byNorthStar: Record<string, string | null> = {
    vtr: null, // awareness already covers a VTR client
    shop: 'gmv',
    app_install: 'install',
  };
  const specific = byNorthStar[client.northStar] ?? null;
  const decks = specific ? ['awareness', specific] : ['awareness'];
  // The Strategy Report's only gate is TTMS presence (PRD §7.1), not north star.
  return marketScope ? [...decks, 'strategy'] : decks;
}

/** The Strategy Report's window — the route's own default (PRD §9.4). */
export const STRATEGY_WINDOW_DAYS = 28;

/** The public route a pre-generated report comes from. `fresh=1` skips the stored copy it is replacing. */
export function reportUrl(baseUrl: string, slug: string, objective: string, windowDays: number): string {
  if (objective === 'strategy') {
    return `${baseUrl}/api/reports/${slug}/strategy-report?tier=full&format=pdf&days=${STRATEGY_WINDOW_DAYS}&fresh=1`;
  }
  return `${baseUrl}/api/reports/${slug}/brief/${objective}?tier=full&days=${windowDays}&fresh=1`;
}

/** Minutes ahead of UTC for an IANA zone at `at`; unknown zones count as WIB (+420). */
export function utcOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    const m = /GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?/.exec(part ?? '');
    if (!m) return 420;
    if (!m[1]) return 0;
    const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
    return m[1] === '-' ? -minutes : minutes;
  } catch {
    return 420;
  }
}

/** East first (PRD v2 B7): WIT before WITA before WIB; ties keep their order. */
export function orderByTimezone<T extends Pick<ClientSummary, 'timezone'>>(clients: readonly T[], at: Date = new Date()): T[] {
  return [...clients]
    .map((c, i) => ({ c, i, off: utcOffsetMinutes(c.timezone, at) }))
    .sort((a, b) => b.off - a.off || a.i - b.i)
    .map((x) => x.c);
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
  const marketScope = await listMarketScopeClientIds(db);
  const clients = orderByTimezone(options.slugs?.length ? all.filter((c) => options.slugs!.includes(c.slug)) : all);

  const results: PregenerateResult[] = [];
  for (const client of clients) {
    for (const objective of objectivesFor(client, { marketScope: marketScope.has(client.id) })) {
      const startedAt = Date.now();
      const url = reportUrl(baseUrl, client.slug, objective, windowDays);
      try {
        const response = await fetch(url, {
          headers: { 'X-API-Key': apiKey },
          // The strategy route's own ceiling is 660 s (PRD G4: ≤ 10 min p95).
          signal: AbortSignal.timeout(objective === 'strategy' ? Math.max(timeoutMs, 11 * 60_000) : timeoutMs),
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
