import { OBJECTIVE_NORTH_STAR, isBriefObjective, type BriefObjective } from '@tempo/core';
import {
  completeReportRun,
  failReportRun,
  getClientBySlug,
  getDailyBriefDashboard,
  getDb,
  latestCompletedRun,
  readArtifact,
  startReportRun,
  writeArtifact,
} from '@tempo/db';
import type { DeckTier } from '@tempo/reports';
import { assembleDeck, NoDeckDataError } from '@/lib/deck-pipeline';
import { htmlToPdf } from '@/lib/report-pdf';
import { authenticate, corsHeaders, preflight } from '@/lib/api-auth';

/**
 * GET /api/reports/:slug/brief/:objective?tier=&format=&date=&days=
 *
 * The Brief Deck (docs/architecture/PRD_tempo_brief_deck.md) — one landscape
 * 16:9 deck per objective, replacing the A4 engine brief.
 *
 * Two sources, fetched in parallel:
 *   - **Numbers and furniture** from `@tempo/db` (`getDailyBriefDashboard`, the
 *     same day-grain rollup the dashboard UI reads), so a deck can never
 *     disagree with the dashboard.
 *   - **Analysis** from `tempo-engine` (`POST /v1/briefs/sync`) — a generator
 *     battery, materiality ranking, an agentic probe loop and narrator/critic/
 *     synthesist agents. The visual side never blocks on the narrative side.
 *
 * They meet in `buildDeckModel`, which is the *only* place engine content,
 * read-model rows and the report spec are combined, and `renderDeckHtml` reads
 * nothing but that model (PRD §0.1). That is what keeps the output format
 * swappable and the goldens meaningful.
 *
 * `tier` (PRD §5, D1) defaults to **instant**: generators and materiality with
 * zero model calls, prose from the engine's deterministic template table,
 * targeting ≤ 10 s. `tier=full` runs the agent path (minutes) and is what the
 * weekly cron requests. The cover badge and the footer always state which one
 * produced the deck — an instant deck must never be mistaken for the full
 * product (PRD §11 R1).
 *
 * A `tier=full` request is served from the **pre-generated artifact** when the
 * weekly cron already rendered this exact client × objective × window and the
 * file is still fresh (`DECK_ARTIFACT_MAX_AGE_HOURS`, default 24). That is what
 * makes the routine Monday download instant *and* fully narrated. `?fresh=1`
 * forces a regeneration.
 *
 * `objective` is one of:
 *   awareness — impressions, reach, VTR. Available for a 'vtr' north-star client.
 *   gmv       — TikTok Shop orders, GMV, ROI. Only for a 'shop' north-star client.
 *   install   — app installs, CPI. Only for an 'app_install' north-star client.
 *
 * tempo-engine's pipeline has a human-review gate (`interrupt()`) built in —
 * `/v1/briefs/sync` runs it and supplies an "approved" decision automatically
 * so this route can keep returning a finished PDF synchronously. tempo-engine's
 * own `/ui/briefs/{run_id}` page remains available for reviewing a run by hand.
 *
 * The deck is Bahasa-only — `lang` is accepted so existing callers don't break
 * but has no effect; there is no English deck.
 *
 * Same-origin requests from this app are allowed through. Any external caller
 * (e.g. the Buzzo portal, across any of the agency's clients) must present an
 * API key — see lib/api-auth.ts. `slug` selects which client's data is
 * requested, so the same key works across every client on the platform.
 */
export const runtime = 'nodejs';
export const maxDuration = 180;
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const TEMPO_ENGINE_URL = process.env.TEMPO_ENGINE_URL ?? 'http://127.0.0.1:8001';

export async function OPTIONS(request: Request) {
  return preflight(request);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; objective: string }> },
) {
  const cors = corsHeaders(request);
  const auth = authenticate(request);
  if (!auth.ok) {
    return new Response(auth.message, { status: auth.status ?? 401, headers: cors });
  }

  const { slug, objective } = await params;
  if (!isBriefObjective(objective)) {
    return new Response(
      `Unknown brief "${objective}". Expected one of: awareness, gmv, install.`,
      { status: 404, headers: cors },
    );
  }

  const url = new URL(request.url);
  const formatParam = url.searchParams.get('format');
  const format = formatParam === 'html' || formatParam === 'json' ? formatParam : 'pdf';
  const tier: DeckTier = url.searchParams.get('tier') === 'full' ? 'full' : 'instant';

  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) {
    return new Response(`Client "${slug}" not found`, { status: 404, headers: cors });
  }

  // Same guard the old pipeline had: presenting one objective's brief against a
  // client configured for a different north star would mislabel real data
  // (installs shown as GMV, or vice versa). tempo-engine's own
  // build_*_metric_frame functions re-check this independently — this is just a
  // fast, local fail before making the network call.
  const requiredNorthStar = OBJECTIVE_NORTH_STAR[objective];
  if (objective !== 'awareness' && client.northStar !== requiredNorthStar) {
    return new Response(
      `"${slug}" is configured with north star "${client.northStar}", not "${requiredNorthStar}" — the ${objective} brief is not available for this client.`,
      { status: 409, headers: cors },
    );
  }

  const daysParam = Number(url.searchParams.get('days'));
  const windowDays = Number.isInteger(daysParam) && daysParam > 0 ? daysParam : 7;
  const dateParam = url.searchParams.get('date');
  const endDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : undefined;
  const forceFresh = url.searchParams.get('fresh') === '1';

  const callEngine = async (): Promise<Response | null> => {
    try {
      return await fetch(`${TEMPO_ENGINE_URL}/v1/briefs/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_slug: slug,
          brief_type: objective,
          window_days: windowDays,
          tier,
        }),
        cache: 'no-store',
      });
    } catch (err) {
      console.error('[reports] tempo-engine request failed:', err);
      return null;
    }
  };

  // The instant tier keeps the parallel fetch the deck has always had: the
  // numeric side never waits on the narrative side. The full tier starts its
  // (minutes-long) call only after the artifact check below, because a cache
  // hit makes the call unnecessary — and starting one we intend to throw away
  // would burn an LM Studio run per download.
  const eagerEngine = tier === 'instant' ? callEngine() : null;

  const dashboard = await getDailyBriefDashboard(db, client, { endDate, windowDays });

  if (!dashboard) {
    return new Response(`No daily ad data ingested for "${slug}"`, { status: 404, headers: cors });
  }

  const periodStart = dashboard.days[0]?.date ?? '';
  const periodEnd = dashboard.days[dashboard.days.length - 1]?.date ?? '';
  const runKey = {
    clientId: client.id,
    objective,
    periodStart,
    periodEnd,
    tier,
  } as const;

  // A pre-generated full-tier deck for this exact window, still fresh, is the
  // whole point of the weekly cron: the Monday download is instant *and* fully
  // narrated. Only for `pdf` — `json`/`html` callers want the live model.
  if (tier === 'full' && format === 'pdf' && !forceFresh && periodStart && periodEnd) {
    const cached = await latestCompletedRun(db, runKey);
    const bytes = await readArtifact(cached?.artifactPath);
    if (cached && bytes) {
      return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
        headers: {
          ...cors,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${client.slug}-tiktok-${objective}-deck-${cached.runId ?? cached.id}.pdf"`,
          'Cache-Control': 'no-store',
          'X-Engine-Run-Id': cached.runId ?? '',
          // Says plainly that this is a stored render, and when it was made —
          // a client asking "is this today's?" should not have to guess.
          'X-Deck-Artifact': 'pregenerated',
          'X-Deck-Generated-At': cached.startedAt.toISOString(),
        },
      });
    }
  }

  const engineResponse = await (eagerEngine ?? callEngine());

  if (engineResponse === null) {
    return new Response('Brief generation service is unreachable', { status: 502, headers: cors });
  }
  if (engineResponse.status === 404) {
    const detail = await engineResponse.text();
    return new Response(detail || `No data available for "${slug}"`, { status: 404, headers: cors });
  }
  if (!engineResponse.ok) {
    const detail = await engineResponse.text();
    console.error(`[reports] tempo-engine returned ${engineResponse.status}:`, detail);
    return new Response('Failed to generate brief', { status: 502, headers: cors });
  }
  const result = (await engineResponse.json()) as {
    run_id: string;
    status: string;
    content: unknown;
  };

  // One assembly path for both entry points (see lib/deck-pipeline.ts): a
  // "full" deck that differed depending on which endpoint rendered it would
  // make the tier badge a lie.
  let deck;
  try {
    deck = await assembleDeck({
      db,
      client,
      objective: objective as BriefObjective,
      tier,
      engineContent: result.content,
      engineRunId: result.run_id,
      windowDays,
      endDate,
      dashboard,
    });
  } catch (err) {
    if (err instanceof NoDeckDataError) {
      return new Response(err.message, { status: 404, headers: cors });
    }
    // A payload that does not match its own contract is a boundary failure we
    // report, not something to paper over with an empty deck.
    console.error('[reports] tempo-engine returned content that failed validation:', err);
    return new Response('Brief content did not match the engine contract', {
      status: 502,
      headers: cors,
    });
  }
  const model = deck.model;

  // Every response carries the run id, so a deck someone is arguing about can
  // be traced to /ui/briefs/{run_id} without re-deriving which run made it.
  const baseHeaders = { ...cors, 'X-Engine-Run-Id': result.run_id, 'Cache-Control': 'no-store' };

  if (format === 'json') {
    // The portal renders its own UI from the model — not from engine JSON, and
    // not from HTML it would have to scrape.
    return Response.json(
      { run_id: result.run_id, status: result.status, tier: model.meta.tier, deck: model },
      { headers: baseHeaders },
    );
  }

  const html = deck.html;

  if (format === 'html') {
    return new Response(html, {
      headers: { ...baseHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Every generation is recorded, so "did the last run work" is answerable
  // from the surface's own data (the engine health card reads it) and not only
  // from inside tempo-engine.
  const runRowId = periodStart && periodEnd ? await startReportRun(db, runKey, result.run_id) : null;
  const filename = `${client.slug}-tiktok-${objective}-deck-${result.run_id}.pdf`;

  try {
    const pdf = await htmlToPdf(html, 'deck');

    // Only full-tier decks are stored. An instant deck is cheap to regenerate
    // and would be a new file on every download; a full one costs minutes and
    // is exactly what the next caller wants.
    let artifact: { path: string; bytes: number } | null = null;
    if (tier === 'full') {
      try {
        artifact = await writeArtifact(filename, pdf);
      } catch (err) {
        // A deck the client can download beats a deck we managed to file.
        console.error('[reports] storing the deck artifact failed:', err);
      }
    }
    if (runRowId) {
      await completeReportRun(db, runRowId, {
        artifactPath: artifact?.path ?? null,
        artifactBytes: artifact?.bytes ?? pdf.byteLength,
      });
    }

    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    return new Response(body, {
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Deck-Artifact': artifact ? 'stored' : 'live',
      },
    });
  } catch (err) {
    console.error('[reports] deck PDF generation failed:', err);
    if (runRowId) await failReportRun(db, runRowId, (err as Error).message);
    return new Response('Failed to generate PDF deck', { status: 500, headers: cors });
  }
}
