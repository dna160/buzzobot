import { getClientBySlug, getDb } from '@tempo/db';
import { buildReport, renderReportHtml, isLocale, DEFAULT_LOCALE } from '@tempo/reports';
import { rangePreset } from '@tempo/core';
import { DASHBOARD_ANCHOR_DATE } from '@/lib/constants';
import { htmlToPdf } from '@/lib/report-pdf';

/**
 * GET /api/reports/:slug?preset=30d&lang=id|en&format=pdf|html
 * Generates the client's performance report. Defaults to Bahasa Indonesia.
 * `format=html` returns the raw document (handy for previewing); the default
 * streams a PDF.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

const PRESETS = new Set(['7d', '28d', '30d', '90d']);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const url = new URL(request.url);
  const presetParam = url.searchParams.get('preset') ?? '30d';
  const preset = (PRESETS.has(presetParam) ? presetParam : '30d') as '7d' | '28d' | '30d' | '90d';
  const format = url.searchParams.get('format') === 'html' ? 'html' : 'pdf';

  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) {
    return new Response(`Client "${slug}" not found`, { status: 404 });
  }

  const langParam = url.searchParams.get('lang');
  const locale = isLocale(langParam) ? langParam : DEFAULT_LOCALE;

  const range = rangePreset(preset, DASHBOARD_ANCHOR_DATE);
  const model = await buildReport(db, client, range, { generatedAt: new Date(), locale });
  const html = renderReportHtml(model);

  if (format === 'html') {
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  try {
    const pdf = await htmlToPdf(html);
    const filename = `${client.slug}-tiktok-report-${range.start}_${range.end}.pdf`;
    // Response body typed to a fresh ArrayBuffer to satisfy the Web BodyInit type.
    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    return new Response(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[reports] PDF generation failed:', err);
    return new Response('Failed to generate PDF report', { status: 500 });
  }
}
