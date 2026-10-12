import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TEMPLATE_LABEL } from '@tempo/core';
import { getClientBySlug, getDb } from '@tempo/db';
import { TemplateReportPanel } from '@/components/template-report/TemplateReportPanel';

export const metadata: Metadata = {
  title: 'Template Report · Tempo Insight Engine',
};

export const dynamic = 'force-dynamic';

/**
 * The "TikTok Ads Performance Report" (Plan_Template) — a portrait A4 report
 * distinct from the 16:9 Brief Deck. Lives under the client, like Deck config:
 * benchmarks are per client, there is no workspace-wide answer to what a
 * brand's negotiated targets are. The template (GMV, Awareness or App Install) is chosen per
 * report in the panel, starting on the client's north star.
 */
export default async function ClientTemplateReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) notFound();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-primary">Template Report</h1>
        <p className="mt-1 text-sm text-muted">
          Laporan TikTok Ads Performance — health check, proporsi budget funnel, benchmark, tren,
          campaign/produk, dan creative — dinarasikan oleh LM Studio. North star klien ini:{' '}
          <span className="font-medium text-secondary">{TEMPLATE_LABEL[client.northStar]}</span>.
        </p>
      </header>
      <TemplateReportPanel slug={slug} clientNorthStar={client.northStar} />
    </div>
  );
}
