import { getClientBySlug, getDb, getSetting, SETTINGS_KEYS } from '@tempo/db';
import {
  buildHourlyReport,
  renderHourlyReportHtml,
  isLocale,
  DEFAULT_LOCALE,
  NarrativeConfigSchema,
} from '@tempo/reports';
import { htmlToPdf } from '@/lib/report-pdf';
import { authenticate, corsHeaders, preflight } from '@/lib/api-auth';

/**
 * GET /api/reports/:slug?lang=id|en&format=pdf|html|json
 *
 * Generates the client's intraday performance report across every date the
 * ingested export covers: an executive summary plus a full hour-by-hour
 * appendix. Defaults to Bahasa Indonesia.
 *
 *   format=pdf   (default) streams the rendered PDF — the one-click download
 *   format=html  the raw document, for previewing
 *   format=json  the model + narrative, for a caller that renders its own UI
 *
 * Same-origin requests from this app are allowed through. Any external caller
 * (e.g. the Buzzo portal) must present an API key — see lib/api-auth.ts.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function OPTIONS(request: Request) {
  return preflight(request);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const cors = corsHeaders(request);
  const auth = authenticate(request);
  if (!auth.ok) {
    return new Response(auth.message, { status: auth.status ?? 401, headers: cors });
  }

  const { slug } = await params;
  const url = new URL(request.url);
  const formatParam = url.searchParams.get('format');
  const format = formatParam === 'html' || formatParam === 'json' ? formatParam : 'pdf';

  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) {
    return new Response(`Client "${slug}" not found`, { status: 404, headers: cors });
  }

  const langParam = url.searchParams.get('lang');
  const locale = isLocale(langParam) ? langParam : DEFAULT_LOCALE;

  // The operator's Settings override (if any) wins over the .env defaults.
  // Read and validate it here so a bad row can never break report generation.
  const storedAi = await getSetting(db, SETTINGS_KEYS.reportNarrative);
  const narrativeConfig = storedAi
    ? (NarrativeConfigSchema.partial().safeParse(storedAi).data ?? undefined)
    : undefined;

  const model = await buildHourlyReport(db, client, {
    generatedAt: new Date(),
    locale,
    narrativeConfig,
  });
  if (!model) {
    return new Response(`No intraday data ingested for "${slug}"`, { status: 404, headers: cors });
  }

  // Structured form for callers that render their own UI. Excludes `copy`
  // (a large static pack of label strings) — the payload is the data and the
  // analysis, not the template.
  if (format === 'json') {
    const { copy: _copy, ...rest } = model;
    return Response.json(
      {
        ...rest,
        narrative: {
          ...model.narrative,
          // Say plainly whether prose was model-written or rule-generated.
          source: model.narrative.source,
        },
      },
      { headers: { ...cors, 'Cache-Control': 'no-store' } },
    );
  }

  const html = renderHourlyReportHtml(model);

  if (format === 'html') {
    return new Response(html, {
      headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  try {
    const pdf = await htmlToPdf(html);
    const first = model.days[0]!.date;
    const last = model.days[model.days.length - 1]!.date;
    const span = first === last ? first : `${first}_${last}`;
    const filename = `${client.slug}-tiktok-hourly-${span}.pdf`;
    // Response body typed to a fresh ArrayBuffer to satisfy the Web BodyInit type.
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
    console.error('[reports] PDF generation failed:', err);
    return new Response('Failed to generate PDF report', { status: 500, headers: cors });
  }
}
