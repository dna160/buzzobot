import type { Metadata } from 'next';
import { ChatPanel } from '@/components/chat/ChatPanel';

export const metadata: Metadata = {
  title: 'Tanya Tempo · Tempo Insight Engine',
};

export const dynamic = 'force-dynamic';

/**
 * Tanya Tempo — one general chat over the whole ads database. Ask about any
 * client by name, compare clients, or ask about the portfolio as a whole; Tempo
 * answers through typed, read-only tools and checks every number before it is
 * shown. Which clients it can read is set by the engine's `TEMPO_SCOPE`.
 */
export default function ChatPage() {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight text-primary">Tanya Tempo</h1>
        <p className="mt-1 text-sm text-muted">
          Tanyakan apa saja tentang data iklan: satu klien (sebut namanya), perbandingan beberapa klien, atau
          seluruh portofolio — siapa yang belanja paling besar, ROAS tertinggi, kampanye yang boros. Tempo membaca
          database iklan melalui alat baca-saja, dan setiap angka diperiksa terhadap data sebelum ditampilkan. Model
          berjalan lokal, jadi satu jawaban bisa sampai sekitar satu menit.
        </p>
      </header>
      <ChatPanel />
    </div>
  );
}
