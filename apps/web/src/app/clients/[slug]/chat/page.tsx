import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getClientBySlug, getDb } from '@tempo/db';
import { ChatPanel } from '@/components/chat/ChatPanel';

export const metadata: Metadata = {
  title: 'Tanya Tempo · Tempo Insight Engine',
};

export const dynamic = 'force-dynamic';

/**
 * Tanya Tempo (Tempo Chat C1, PRD §12.2) — a chat page per client. The AM asks
 * in plain Bahasa or English; Tempo answers from this client's own data through
 * typed, read-only tools, and every number is checked before it is shown. Kept
 * at exactly `/clients/[slug]/chat` because the sidebar's active state is an
 * exact pathname match.
 */
export default async function ClientChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db } = getDb();
  const client = await getClientBySlug(db, slug);
  if (!client) notFound();

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight text-primary">Tanya Tempo · {client.name}</h1>
        <p className="mt-1 text-sm text-muted">
          Tanyakan apa saja tentang {client.name}: kondisi minggu ini, kampanye yang boros, posisi di kategori, atau
          langkah berikutnya. Tempo membaca data iklan dan TikTok Market Scope klien ini melalui alat baca-saja — setiap
          angka diperiksa terhadap data sebelum ditampilkan. Model berjalan lokal, jadi satu jawaban bisa sampai sekitar
          satu menit.
        </p>
      </header>
      <ChatPanel slug={slug} clientName={client.name} />
    </div>
  );
}
