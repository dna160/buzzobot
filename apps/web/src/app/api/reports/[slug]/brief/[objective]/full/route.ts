import { isBriefObjective, OBJECTIVE_NORTH_STAR, type BriefObjective } from '@tempo/core';
import type { ClientSummary } from '@tempo/db';
import {
  completeReportRun,
  failReportRun,
  getClientBySlug,
  getDb,
  getReportRun,
  startReportRun,
  writeArtifact,
} from '@tempo/db';
import { assembleDeck, NoDeckDataError } from '@/lib/deck-pipeline';
import { htmlToPdf } from '@/lib/report-pdf';
import { authenticate, corsHeaders, preflight } from '@/lib/api-auth';

/**
 * The instant-then-full flow (Brief Deck PRD §5, §11 R1).
 *
 *   POST /api/reports/:slug/brief/:objective/full   → starts a full-tier run
 *   GET  /api/reports/:slug/brief/:objective/full?runId=…  → poll; renders when ready
 *
 * The portal downloads the instant deck immediately from the sibling route and
 * calls POST here at the same time. The full run costs minutes (~24 model calls
 * on the 12B budget), so nobody waits on it: the portal polls, and when the run
 * lands this endpoint renders and stores the deck, then reports the download
 * URL. The sibling route serves that stored artifact.
 *
 * Two deliberate choices:
 *
 * - **The engine's async endpoint, not `/sync`.** `POST /v1/briefs` returns a
 *   run id immediately, so this request does not hold a connection open for
 *   minutes and a portal that navigates away does not cancel the analysis.
 * - **The render happens on the poll that finds the run ready**, not in a
 *   background task. There is no job queue here, and a promise left running
 *   after a serverless response returns is a promise that may never finish.
 *   Doing the work inside a request that is waiting for it is honest about
 *   where the time goes.
 *
 * The run pauses at the engine's `interrupt()` review gate. This endpoint
 * supplies the same automatic "approved" decision `/v1/briefs/sync` does — the
 * gate is exercised, not skipped, and `/ui/briefs/{run_id}` remains available
 * for a human who wants to reject one.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const TEMPO_ENGINE_URL = process.env.TEMPO_ENGINE_URL ?? 'http://127.0.0.1:8001';

export async function OPTIONS(request: Request) {
  return preflight(request);
}

interface RouteParams {
  params: Promise<{ slug: string; objective: string }>;
}

type ResolvedClient =
  | { db: ReturnType<typeof getDb>['db']; client: ClientSummary; error: null; status: 200 }
  | { db: ReturnType<typeof getDb>['db']; client: null; error: string; status: number };

/** Same north-star gate as the sibling route — a deck for the wrong objective
 * would mislabel real data, and both entry points have to refuse it. */
async function resolveClient(slug: string, objective: string): Promise<ResolvedClient> {
  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) return { db, client: null, error: `Client "${slug}" not found`, status: 404 };

  const required = OBJECTIVE_NORTH_STAR[objective as BriefObjective];
  if (objective !== 'awareness' && client.northStar !== required) {
    return {
      db,
      client: null,
      error: `"${slug}" is configured with north star "${client.northStar}", not "${required}".`,
      status: 409,
    };
  }
  return { db, client, error: null, status: 200 };
}

/** Start a full-tier run and return the ledger id the portal polls with. */
export async function POST(request: Request, { params }: RouteParams) {
  const cors = corsHeaders(request);
  const auth = authenticate(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status ?? 401, headers: cors });

  const { slug, objective } = await params;
  if (!isBriefObjective(objective)) {
    return new Response(`Unknown brief "${objective}".`, { status: 404, headers: cors });
  }

  const { db, client, error, status } = await resolveClient(slug, objective);
  if (!client) return new Response(error, { status, headers: cors });

  const url = new URL(request.url);
  const daysParam = Number(url.searchParams.get('days'));
  const windowDays = Number.isInteger(daysParam) && daysParam > 0 ? daysParam : 7;

  let engineRunId: string;
  try {
    const response = await fetch(`${TEMPO_ENGINE_URL}/v1/briefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_slug: slug,
        brief_type: objective,
        window_days: windowDays,
        tier: 'full',
      }),
      cache: 'no-store',
    });
    if (!response.ok) {
      const detail = await response.text();
      return new Response(detail || 'Failed to start the full run', {
        status: response.status === 404 ? 404 : 502,
        headers: cors,
      });
    }
    engineRunId = ((await response.json()) as { run_id: string }).run_id;
  } catch (err) {
    console.error('[reports] starting the full run failed:', err);
    return new Response('Brief generation service is unreachable', { status: 502, headers: cors });
  }

  // The window is left null: it is decided by the rollup, which is only read
  // when the deck renders. A null window is a run in flight — never something
  // the download path can mistake for a servable artifact.
  const runRowId = await startReportRun(
    db,
    { clientId: client.id, objective, tier: 'full' },
    engineRunId,
  );

  return Response.json(
    { runId: runRowId, engineRunId, status: 'running', windowDays },
    { headers: { ...cors, 'Cache-Control': 'no-store', 'X-Engine-Run-Id': engineRunId } },
  );
}

/** Poll a run; render and store the deck once the engine has finished. */
export async function GET(request: Request, { params }: RouteParams) {
  const cors = corsHeaders(request);
  const auth = authenticate(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status ?? 401, headers: cors });

  const { slug, objective } = await params;
  if (!isBriefObjective(objective)) {
    return new Response(`Unknown brief "${objective}".`, { status: 404, headers: cors });
  }

  const url = new URL(request.url);
  const runRowId = url.searchParams.get('runId');
  if (!runRowId) {
    return new Response('runId is required', { status: 400, headers: cors });
  }

  const { db, client, error, status } = await resolveClient(slug, objective);
  if (!client) return new Response(error, { status, headers: cors });

  const row = await getReportRun(db, runRowId);
  if (!row || row.clientId !== client.id) {
    return new Response(`No run ${runRowId}`, { status: 404, headers: cors });
  }

  const downloadUrl = `/api/reports/${slug}/brief/${objective}?tier=full`;
  const json = (body: Record<string, unknown>, code = 200) =>
    Response.json(body, { status: code, headers: { ...cors, 'Cache-Control': 'no-store' } });

  if (row.status === 'completed') {
    return json({ status: 'ready', runId: row.id, engineRunId: row.runId, downloadUrl });
  }
  if (row.status === 'failed') {
    return json({ status: 'failed', runId: row.id, error: row.error });
  }

  // Ask the engine where its run got to.
  let brief: { status: string; content: unknown } | null = null;
  try {
    const response = await fetch(`${TEMPO_ENGINE_URL}/v1/briefs/${row.runId}`, {
      cache: 'no-store',
    });
    if (response.ok) brief = (await response.json()) as { status: string; content: unknown };
  } catch (err) {
    console.error('[reports] polling the full run failed:', err);
    return json({ status: 'running', runId: row.id, note: 'engine unreachable' });
  }
  if (!brief) return json({ status: 'running', runId: row.id });

  // Paused at the review gate: supply the same automatic approval `/sync`
  // does, so the gate is exercised rather than skipped.
  if (brief.status === 'pending_review') {
    try {
      const approved = await fetch(`${TEMPO_ENGINE_URL}/v1/briefs/${row.runId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved', notes: 'auto-approved (portal full run)' }),
        cache: 'no-store',
      });
      if (!approved.ok) return json({ status: 'running', runId: row.id });
      const refreshed = await fetch(`${TEMPO_ENGINE_URL}/v1/briefs/${row.runId}`, {
        cache: 'no-store',
      });
      if (refreshed.ok) brief = (await refreshed.json()) as { status: string; content: unknown };
    } catch (err) {
      console.error('[reports] approving the full run failed:', err);
      return json({ status: 'running', runId: row.id });
    }
  }

  if (brief.status === 'rejected') {
    await failReportRun(db, row.id, 'the run was rejected at review');
    return json({ status: 'failed', runId: row.id, error: 'rejected at review' });
  }
  if (brief.status !== 'approved') {
    return json({ status: 'running', runId: row.id, engineStatus: brief.status });
  }

  try {
    const deck = await assembleDeck({
      db,
      client,
      objective,
      tier: 'full',
      engineContent: brief.content,
      engineRunId: row.runId ?? row.id,
      windowDays: Number(url.searchParams.get('days')) || 7,
    });
    const pdf = await htmlToPdf(deck.html, 'deck');
    const artifact = await writeArtifact(
      `${client.slug}-tiktok-${objective}-deck-${row.runId ?? row.id}.pdf`,
      pdf,
    );
    await completeReportRun(db, row.id, {
      artifactPath: artifact.path,
      artifactBytes: artifact.bytes,
      // The window is only known now that the rollup has been read; the cache
      // key the sibling route looks up is (client, objective, window, tier).
      periodStart: deck.periodStart,
      periodEnd: deck.periodEnd,
    });
    return json({
      status: 'ready',
      runId: row.id,
      engineRunId: row.runId,
      downloadUrl,
      bytes: artifact.bytes,
    });
  } catch (err) {
    const message = err instanceof NoDeckDataError ? err.message : (err as Error).message;
    console.error('[reports] rendering the full deck failed:', err);
    await failReportRun(db, row.id, message);
    return json({ status: 'failed', runId: row.id, error: message }, 500);
  }
}
