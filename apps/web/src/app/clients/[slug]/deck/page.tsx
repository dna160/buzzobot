import type { Metadata } from 'next';
import { DeckSpecEditor } from '@/components/deck-spec/DeckSpecEditor';

export const metadata: Metadata = {
  title: 'Deck configuration · Tempo Insight Engine',
};

/**
 * Per-client deck configuration (Brief Deck PRD §3.3, D3).
 *
 * AM-facing: brands choose presets, account managers tune the spec. It lives
 * under the client rather than under Settings because a spec is per client ×
 * objective — there is no workspace-wide answer to "which metrics matter".
 */
export default async function ClientDeckSpecPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-primary">Deck configuration</h1>
        <p className="mt-1 text-sm text-muted">
          Which metrics this client&apos;s brief deck leads with, and the targets its tiles are
          graded against. Changes apply to the next deck generated — including the pre-generated
          weekly one.
        </p>
      </header>
      <DeckSpecEditor slug={slug} />
    </div>
  );
}
