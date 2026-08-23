import { getClientBySlug, getDailyBriefDashboard, getDb } from '@tempo/db';
import { isBriefObjective, renderEngineBriefHtml, OBJECTIVE_NORTH_STAR, type EngineBriefContent } from '@tempo/reports';
import { htmlToPdf } from '@/lib/report-pdf';
import { authenticate, corsHeaders, preflight } from '@/lib/api-auth';

/**
 * GET /api/reports/:slug/brief/:objective?format=pdf|html|json&date=&days=
 *
 * Pairs two sources: real windowed performance data, fetched directly here
 * via `@tempo/db` (`getDailyBriefDashboard` — the same day-grain rollup the
 * dashboard UI itself reads) for charts/KPIs/tables, and `tempo-engine`'s
 * narrated analysis (a separate Python service — see `D:\tempo-engine`,
 * `POST /v1/briefs/sync`) for the prose overlaid on top of them.
 * tempo-engine owns the actual analysis: a generator battery (LMDI
 * decomposition, outlier detection, concentration, marginal return, etc.),
 * an agentic probe loop, and narrator/critic/synthesist agents — proven
 * live against real Tempo Postgres data for all three objectives. The two
 * calls run in parallel; the visual/numeric side never blocks on the
 * (much slower — a full analysis run) narrative side.
 *
 * `objective` is one of:
 *   awareness — impressions, reach, VTR. Available for a 'vtr' north-star client.
 *   gmv       — TikTok Shop orders, GMV, ROI. Only for a 'shop' north-star client.
 *   install   — app installs, CPI. Only for an 'app_install' north-star client.
 *
 * tempo-engine's pipeline has a human-review gate (`interrupt()`) built in
 * — `/v1/briefs/sync` runs it and supplies an "approved" decision
 * automatically so this route can keep returning a finished PDF
 * synchronously, the same way it always has. tempo-engine's own
 * `/ui/briefs/{run_id}` page remains available separately for anyone who
 * wants to review a run by hand instead of accepting that default.
 *
 * tempo-engine narrates in Bahasa Indonesia only — `lang` is accepted (so
 * existing callers don't break) but has no effect on the generated
 * content; there is no English narration path yet.
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

  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) {
    return new Response(`Client "${slug}" not found`, { status: 404, headers: cors });
  }

  // Same guard the old pipeline had: presenting one objective's brief
  // against a client configured for a different north star would mislabel
  // real data (installs shown as GMV, or vice versa). tempo-engine's own
  // build_*_metric_frame functions re-check this independently — this is
  // just a fast, local fail before making the network call.
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
        body: JSON.stringify({ client_slug: slug, brief_type: objective, window_days: windowDays }),
        cache: 'no-store',
      });
    } catch (err) {
      console.error('[reports] tempo-engine request failed:', err);
      return null;
    }
  })();

  const [engineResponse, dashboard] = await Promise.all([
    enginePromise,
    getDailyBriefDashboard(db, client, { endDate, windowDays }),
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

  const result = (await engineResponse.json()) as { run_id: string; status: string; content: EngineBriefContent };

  if (format === 'json') {
    return Response.json(result, { headers: { ...cors, 'Cache-Control': 'no-store' } });
  }

  const html = renderEngineBriefHtml(result.content, dashboard, objective, requiredNorthStar);

  if (format === 'html') {
    return new Response(html, {
      headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  try {
    const pdf = await htmlToPdf(html);
    const filename = `${client.slug}-tiktok-${objective}-brief-${result.run_id}.pdf`;
    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    return new Response(body, {
      headers: {
        ...cors,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[reports] brief PDF generation failed:', err);
    return new Response('Failed to generate PDF report', { status: 500, headers: cors });
  }
}
