import { OBJECTIVE_NORTH_STAR, isBriefObjective, type BriefObjective } from '@tempo/core';
import {
  getClientBySlug,
  getDailyBriefDashboard,
  getDb,
  getReportSpec,
  listWindowVideos,
} from '@tempo/db';
import {
  buildDeckModel,
  parseEngineContent,
  renderDeckHtml,
  resolveReportSpec,
  type DeckTier,
} from '@tempo/reports';
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
 * weekly cron will request. The cover badge and the footer always state which
 * one produced the deck — an instant deck must never be mistaken for the full
 * product (PRD §11 R1).
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

  const enginePromise = (async () => {
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
  })();

  const [engineResponse, dashboard, storedSpec] = await Promise.all([
    enginePromise,
    getDailyBriefDashboard(db, client, { endDate, windowDays }),
    getReportSpec(db, client.id, objective),
  ]);

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
  if (!dashboard) {
    return new Response(`No daily ad data ingested for "${slug}"`, { status: 404, headers: cors });
  }

  const result = (await engineResponse.json()) as {
    run_id: string;
    status: string;
    content: unknown;
  };

  let parsed;
  try {
    parsed = parseEngineContent(result.content);
  } catch (err) {
    // A payload that does not match its own contract is a boundary failure we
    // report, not something to paper over with an empty deck.
    console.error('[reports] tempo-engine returned content that failed validation:', err);
    return new Response('Brief content did not match the engine contract', {
      status: 502,
      headers: cors,
    });
  }

  // A stored spec that no longer suits its objective falls back to the preset
  // and is logged — the deck always renders (PRD §1's surviving doctrine).
  const spec = resolveReportSpec(storedSpec?.spec ?? null, objective as BriefObjective, (err) =>
    console.error(`[reports] stored report_spec for ${slug}/${objective} rejected:`, err),
  );

  // Videos for S5 and Lampiran B. Read after the window is known (its dates
  // come from the dashboard rollup, not recomputed here) and never fatal: a
  // client with no organic account, or a read that fails, simply has no video
  // slide rather than no deck.
  const windowStart = dashboard.days[0]?.date;
  const windowEnd = dashboard.days[dashboard.days.length - 1]?.date;
  const videos =
    spec.appendix.allVideos && windowStart && windowEnd
      ? await listWindowVideos(db, client, { startDate: windowStart, endDate: windowEnd }).catch(
          (err) => {
            console.error(`[reports] window videos for ${slug} failed:`, err);
            return [];
          },
        )
      : [];

  const model = buildDeckModel({
    content: parsed.content,
    contentVersion: parsed.version,
    dashboard,
    spec,
    objective: objective as BriefObjective,
    runId: result.run_id,
    tier: parsed.content.tier ?? tier,
    generatedAt: new Date().toISOString(),
    windowDays,
    videos,
  });

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

  const html = renderDeckHtml(model);

  if (format === 'html') {
    return new Response(html, {
      headers: { ...baseHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  try {
    const pdf = await htmlToPdf(html, 'deck');
    const filename = `${client.slug}-tiktok-${objective}-deck-${result.run_id}.pdf`;
    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    return new Response(body, {
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('[reports] deck PDF generation failed:', err);
    return new Response('Failed to generate PDF deck', { status: 500, headers: cors });
  }
}
