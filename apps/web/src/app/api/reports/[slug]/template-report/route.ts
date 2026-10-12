import {
  createSourcePool,
  fetchNorthStarRawData,
  fetchTemplateReportRawData,
  getClientBySlug,
  getDb,
  getPaidTiktokAdAccountIds,
  listBenchmarks,
} from '@tempo/db';
import { renderNorthStarReportHtml, renderTemplateReportHtml } from '@tempo/reports';
import { assembleNorthStarReportModel, computeNorthStarReportFacts } from '@/lib/north-star-report-pipeline';
import { assembleTemplateReportModel, computeTemplateReportFacts } from '@/lib/template-report-pipeline';
import { generateNorthStarNarratives, generateTemplateReportNarratives } from '@/lib/template-report-narrative';
import { htmlToPdf } from '@/lib/report-pdf';
import { authenticate, corsHeaders, preflight } from '@/lib/api-auth';

/**
 * GET /api/reports/:slug/template-report?format=&start=&end=&benchmark=&template=
 *
 * `format`: `html` (default — a plain HTML string, no PDF rendering; this is
 * what an external caller's "Generate Report" button should request) or `pdf`
 * (a downloadable file, `Content-Disposition: attachment`; what this app's own
 * "Download Template Report" button asks for explicitly).
 *
 * The "TikTok Ads Performance Report" (Plan_Template) — a portrait A4 monthly
 * report, distinct from the 16:9 Brief Deck. Pulls the requested window (plus
 * a comparable prior period of the *same length*, immediately preceding it)
 * directly from the real TikTok source tables (`fetchTemplateReportRawData`),
 * scores it against the client's manually-entered benchmarks via
 * `@tempo/reports`'s deterministic rubric, writes six narrative blocks
 * through LM Studio, and renders the result.
 *
 * `start`/`end` (YYYY-MM-DD, both inclusive — "1 Aug – 31 Aug" reads exactly
 * as written) are optional; omitting both defaults to the trailing 30 days
 * ending today, unchanged from before this was configurable. A wider window
 * (e.g. 60 days) automatically gets a 60-day prior period to compare
 * against, never a fixed 30 — see `fetchTemplateReportRawData`. `date`
 * (single, exclusive end) is kept as a legacy alias for the old
 * end-date-only, always-30-day-trailing behavior.
 *
 * `benchmark` picks what §2/§3 are graded against: `industry` (default — the
 * client's stored targets, incl. the industry-peer average) or `previous` (the
 * prior window of equal length, so Sept 1–30 is graded against the 30 days
 * before it). Both modes coexist; neither replaces the other.
 *
 * Does not touch tempo-engine, `SectionId`, or `ClaimFrame` — this report's
 * facts are template cells, not materiality-ranked findings, so it does not
 * belong in that graph (see the Template Report plan's Context section).
 */
export const runtime = 'nodejs';
// Generous by design: narrative quality matters more than response time (no
// placeholder fallback — a struggling prompt retries up to 8 times, see
// `template-report-narrative.ts`), so this must comfortably outlast a run
// where several of the six prompts each need a retry or two.
export const maxDuration = 600;
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function OPTIONS(request: Request) {
  return preflight(request);
}

/** ISO date one day after `date` — converts a human's inclusive end date to the exclusive-end convention `fetchTemplateReportRawData` uses internally. */
function addOneDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Inverse of `addOneDay` — converts the internal exclusive end back to the inclusive date a human picked, for display (filenames, period labels). */
function subtractOneDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const cors = corsHeaders(request);
  const auth = authenticate(request);
  if (!auth.ok) {
    return new Response(auth.message, { status: auth.status ?? 401, headers: cors });
  }

  const { slug } = await params;
  const url = new URL(request.url);
  // HTML by default — the point of this endpoint for an external caller (a
  // "Generate Report" button on another site) is to get back a plain HTML
  // string it can render itself, with none of the PDF-rendering overhead.
  // Pass `format=pdf` explicitly for the original downloadable-file behavior
  // (used by this app's own "Download Template Report" button).
  const formatParam = url.searchParams.get('format');
  const format = formatParam === 'pdf' ? 'pdf' : 'html';

  const startParam = url.searchParams.get('start');
  const endParam = url.searchParams.get('end');
  const legacyDateParam = url.searchParams.get('date');
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if ((startParam && !dateRe.test(startParam)) || (endParam && !dateRe.test(endParam))) {
    return new Response('start/end must be YYYY-MM-DD', { status: 400, headers: cors });
  }
  // 'industry' (default): grade against the client's stored benchmark targets.
  // 'previous': grade against this same report's prior window of equal length.
  const benchmarkParam = url.searchParams.get('benchmark');
  if (benchmarkParam !== null && benchmarkParam !== 'industry' && benchmarkParam !== 'previous') {
    return new Response('benchmark must be "industry" or "previous"', { status: 400, headers: cors });
  }
  const benchmarkMode = benchmarkParam === 'previous' ? 'previous_period' : 'industry';
  // Which template to build is the caller's explicit choice — never inferred
  // from the client's north star, which a caller may deliberately override
  // (e.g. an Awareness report for a GMV client). Omitted = 'shop', the
  // original GMV report, so existing API callers see no change.
  const templateParam = url.searchParams.get('template') ?? 'shop';
  if (templateParam !== 'shop' && templateParam !== 'vtr' && templateParam !== 'app_install') {
    return new Response('template must be "shop", "vtr" or "app_install"', { status: 400, headers: cors });
  }
  const template: 'shop' | 'vtr' | 'app_install' = templateParam;
  const windowStart = startParam ?? undefined;
  const windowEnd = endParam ? addOneDay(endParam) : (legacyDateParam ?? undefined);

  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) {
    return new Response(`Client "${slug}" not found`, { status: 404, headers: cors });
  }

  const tiktokAdAccountIds = await getPaidTiktokAdAccountIds(db, client.id);
  if (tiktokAdAccountIds.length === 0) {
    return new Response(`"${slug}" has no TikTok ad account on record`, { status: 404, headers: cors });
  }

  const pool = createSourcePool();
  if (!pool) {
    return new Response('Source TikTok database is not configured (DB_HOST/DB_NAME/DB_USER)', {
      status: 500,
      headers: cors,
    });
  }
  try {
    const benchmarks = await listBenchmarks(db, client.id);

    // GMV/TikTok Shop is the original report; Awareness (`vtr`) and App Install
    // are variants with the same 8-section skeleton (see `template` above).
    const northStar = template;
    let html: string;
    let periodStart: string;
    let periodEndExclusive: string;

    if (northStar === 'vtr' || northStar === 'app_install') {
      const raw = await fetchNorthStarRawData(pool, { tiktokAdAccountIds, windowStart, windowEnd });
      const facts = computeNorthStarReportFacts({ client, raw, northStar, benchmarks, benchmarkMode });
      let narratives;
      try {
        narratives = await generateNorthStarNarratives(northStar, {
          execSummary: { kpis: facts.kpiGroups, areas: facts.areaRows },
          budgetAllocation: { benchmarkSource: facts.benchmarkSource.label, rows: facts.funnelRows },
          efficiency: { benchmarkSource: facts.benchmarkSource.label, sections: facts.benchmarkSections },
          trend: facts.trendRows,
          sources: facts.sourceBreakdown,
          campaigns: facts.campaignTable.rows.map((r) => r.cells),
          creatives: facts.creativeTable.rows.map((r) => r.cells),
          recommendations: facts.recommendations,
        });
      } catch (err) {
        console.error('[template-report] narrative generation failed after retries:', err);
        return new Response('Narrative generation (LM Studio) failed after repeated retries — see server logs', {
          status: 502,
          headers: cors,
        });
      }
      html = renderNorthStarReportHtml(assembleNorthStarReportModel(facts, narratives));
      periodStart = raw.windowStart;
      periodEndExclusive = raw.windowEnd;
    } else {
      const raw = await fetchTemplateReportRawData(pool, { tiktokAdAccountIds, windowStart, windowEnd });

      // Compute every table/status first — pure functions of raw + benchmarks,
      // no LM Studio involved. Narrative prompts below are fed these already-
      // computed facts rather than raw totals: asking the model to derive
      // CPM/CTR/VTR/CPC/ROI/CVR/CPA itself before writing a word of prose
      // reliably burned its whole token budget on arithmetic and came back empty.
      const facts = computeTemplateReportFacts({ client, raw, benchmarks, benchmarkMode });

      // No placeholder fallback, by explicit request: each prompt retries on
      // its own (see `tryWriteNarrative`), and only gives up after repeated
      // failures — at which point this genuinely should fail the report rather
      // than ship fake "insight unavailable" prose.
      let narratives;
      try {
        narratives = await generateTemplateReportNarratives({
          execSummary: { kpis: facts.kpis, areas: facts.areaRows },
          budgetAllocation: { benchmarkSource: facts.benchmarkSource.label, rows: facts.funnelRows },
          efficiency: { benchmarkSource: facts.benchmarkSource.label, sections: facts.benchmarkSections },
          trend: facts.trendRows,
          roi: facts.roiBreakdown,
          products: facts.productRows,
          creatives: facts.creativeRows,
          recommendations: facts.recommendations,
        });
      } catch (err) {
        console.error('[template-report] narrative generation failed after retries:', err);
        return new Response('Narrative generation (LM Studio) failed after repeated retries — see server logs', {
          status: 502,
          headers: cors,
        });
      }
      html = renderTemplateReportHtml(assembleTemplateReportModel(facts, narratives));
      periodStart = raw.windowStart;
      periodEndExclusive = raw.windowEnd;
    }

    if (format === 'html') {
      return new Response(html, { headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' } });
    }

    const pdf = await htmlToPdf(html, 'a4');
    const filename = `${client.slug}-tiktok-ads-performance-report-${periodStart}_${subtractOneDay(periodEndExclusive)}.pdf`;
    return new Response(pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer, {
      headers: {
        ...cors,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } finally {
    await pool.end();
  }
}
