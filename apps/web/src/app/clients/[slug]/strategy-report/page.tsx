import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getClientBySlug, getDb } from '@tempo/db';
import { StrategyReportPanel } from '@/components/strategy-report/StrategyReportPanel';

export const metadata: Metadata = {
  title: 'Strategy Report · Tempo Insight Engine',
};

export const dynamic = 'force-dynamic';

/**
 * The Tempo Strategy Report (Strategy Report PRD §9.2): TikTok Market Scope
 * joined with the client's ad spend — where the funnel leaks, what spend buys,
 * whether the goal is on pace, and three sized, falsifiable decisions. Lives
 * under the client like Template Report; kept at exactly this path because the
 * sidebar's active state is an exact pathname match.
 */
export default async function ClientStrategyReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) notFound();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-primary">Strategy Report</h1>
        <p className="mt-1 text-sm text-muted">
          Laporan strategi mingguan dari TikTok Market Scope dan belanja iklan: di mana funnel bocor, apa yang dibeli
          belanja, laju menuju target, dan tiga keputusan yang terukur. Semua angka dihitung oleh tempo-engine; model
          lokal hanya menulis kalimatnya.
        </p>
      </header>
      <StrategyReportPanel slug={slug} />
    </div>
  );
}
