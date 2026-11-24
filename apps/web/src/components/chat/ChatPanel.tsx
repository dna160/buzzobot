'use client';

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, cn } from '@tempo/ui';
import type { ChatReply, ChatToolCall } from '@/lib/tempo-chat';

/**
 * Tanya Tempo panel (Tempo Chat C1, PRD §12.3). Holds the conversation for the
 * browser session only (sessionStorage per client; nothing server-side for the
 * user). Replies are not streamed — the engine checks every number before the
 * text is shown — so a reply arrives whole, with a verified/unverified badge,
 * the tools it read, and how long it took. Markdown is rendered as React nodes;
 * no HTML is ever injected.
 */

const MAX_CHARS = 4000;
const STARTERS = [
  'Bagaimana kondisi klien ini minggu ini? Apa yang paling perlu diperhatikan?',
  'Kampanye mana yang paling efisien, dan mana yang membuang belanja dalam 14 hari terakhir?',
  'Bagaimana posisi kami dibanding kategori di TikTok Market Scope?',
  'Apa tiga hal yang sebaiknya kami lakukan minggu depan?',
  'Data apa saja yang tersedia untuk klien ini?',
];

interface AssistantMeta {
  verified: boolean;
  unverifiedNumerals: string[];
  toolCalls: ChatToolCall[];
  durationS: number;
}

type Turn =
  | { role: 'user'; content: string }
  | ({ role: 'assistant'; content: string } & AssistantMeta);

function storageKey(slug: string): string {
  return `tempo-chat:${slug}`;
}

function toolChip(tc: ChatToolCall): string {
  const w = tc.args?.window_days;
  const win = typeof w === 'number' ? ` · ${w} hari` : '';
  switch (tc.name) {
    case 'ads_performance':
      return `Kinerja iklan${win}`;
    case 'campaign_breakdown':
      return `Kampanye${win}`;
    case 'market_scope_insights': {
      const topics = Array.isArray(tc.args?.topics) ? (tc.args.topics as string[]).join(', ') : 'ringkasan';
      return `Market Scope · ${topics}`;
    }
    case 'client_overview':
      return 'Ikhtisar klien';
    case 'strategy_action_log':
      return 'Log tindakan';
    default:
      return tc.name;
  }
}

// ─── Minimal, injection-free Markdown → React nodes ──────────────────────────

function renderInline(text: string, keyBase: string): ReactNode[] {
  // Only **bold**; everything else is plain text.
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={`${keyBase}-${i}`} className="font-semibold text-primary">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={`${keyBase}-${i}`}>{p}</Fragment>
    ),
  );
}

function renderMarkdown(text: string): ReactNode[] {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  let ordered: string[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="my-1 list-disc space-y-1 pl-5">
          {bullets.map((b, i) => (
            <li key={i}>{renderInline(b, `b-${out.length}-${i}`)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
    if (ordered.length) {
      out.push(
        <ol key={`ol-${out.length}`} className="my-1 list-decimal space-y-1 pl-5">
          {ordered.map((b, i) => (
            <li key={i}>{renderInline(b, `o-${out.length}-${i}`)}</li>
          ))}
        </ol>,
      );
      ordered = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,6}\s/.test(line)) {
      flush();
      out.push(
        <h4 key={`h-${out.length}`} className="mt-3 mb-1 text-[13px] font-semibold uppercase tracking-wide text-secondary">
          {renderInline(line.replace(/^#{1,6}\s/, ''), `h-${out.length}`)}
        </h4>,
      );
    } else if (/^[-*]\s/.test(line)) {
      if (ordered.length) flush();
      bullets.push(line.replace(/^[-*]\s/, ''));
    } else if (/^\d+\.\s/.test(line)) {
      if (bullets.length) flush();
      ordered.push(line.replace(/^\d+\.\s/, ''));
    } else if (line === '') {
      flush();
    } else {
      flush();
      out.push(
        <p key={`p-${out.length}`} className="my-1">
          {renderInline(line, `p-${out.length}`)}
        </p>,
      );
    }
  }
  flush();
  return out;
}

export function ChatPanel({ slug, clientName }: { slug: string; clientName: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Restore the conversation for this client (browser session only).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey(slug));
      if (raw) {
        const saved = JSON.parse(raw) as { turns: Turn[]; conversationId: string | null };
        setTurns(saved.turns ?? []);
        setConversationId(saved.conversationId ?? null);
      }
    } catch {
      /* private window / blocked storage — start empty */
    }
  }, [slug]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(slug), JSON.stringify({ turns, conversationId }));
    } catch {
      /* ignore */
    }
  }, [slug, turns, conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, loading]);

  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    setError(null);
    setInput('');
    const history: Turn[] = [...turns, { role: 'user', content: q }];
    setTurns(history);
    setLoading(true);
    try {
      const res = await fetch(`/api/chat/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map((t) => ({ role: t.role, content: t.content })),
          conversationId,
        }),
      });
      const data = (await res.json().catch(() => null)) as (ChatReply & { error?: string }) | null;
      if (!res.ok || !data || data.error) {
        throw new Error(data?.error ?? 'Tempo tidak dapat menjawab saat ini.');
      }
      setConversationId(data.conversationId);
      setTurns([
        ...history,
        {
          role: 'assistant',
          content: data.reply,
          verified: data.verified,
          unverifiedNumerals: data.unverifiedNumerals,
          toolCalls: data.toolCalls,
          durationS: data.durationS,
        },
      ]);
    } catch (err) {
      setError((err as Error).message);
      setTurns(turns); // drop the just-added question
      setInput(q); // put it back so the AM can resend
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setTurns([]);
    setConversationId(null);
    setError(null);
    setInput('');
    try {
      sessionStorage.removeItem(storageKey(slug));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-bg-subtle">
      <div ref={scrollRef} className="min-h-[320px] flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && !loading ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">Mulai dengan salah satu pertanyaan ini:</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-[13px] text-secondary transition-colors hover:border-accent hover:text-primary"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-[13px] text-on-accent">
                {t.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex flex-col gap-2">
              <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-border bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-secondary">
                {renderMarkdown(t.content)}
              </div>
              <ReplyFooter meta={t} />
            </div>
          ),
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent" />
            Tempo sedang membaca data {clientName}… {elapsed} dtk
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="border-t border-border px-4 py-2 text-[13px] text-danger">{error}</div>
      ) : null}

      <div className="border-t border-border p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          disabled={loading}
          placeholder={`Tanya tentang ${clientName}… (Enter kirim, Shift+Enter baris baru)`}
          className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-primary outline-none placeholder:text-muted focus:border-accent disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted">
            {input.length}/{MAX_CHARS}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={reset} disabled={loading || turns.length === 0}>
              Baru
            </Button>
            <Button onClick={() => send(input)} disabled={loading || !input.trim()}>
              Kirim
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReplyFooter({ meta }: { meta: AssistantMeta }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pl-1 text-[11px] text-muted">
      {meta.verified ? (
        <Badge tone="success" dot>Angka terverifikasi</Badge>
      ) : (
        <Badge tone="warning" dot>Angka belum terverifikasi: {meta.unverifiedNumerals.join(', ')}</Badge>
      )}
      {meta.toolCalls.map((tc, i) => (
        <span key={i} className={cn('rounded bg-surface-active px-1.5 py-0.5', !tc.ok && 'text-danger')}>
          {toolChip(tc)}
        </span>
      ))}
      <span>{meta.durationS.toFixed(1)} dtk</span>
      {!meta.verified ? (
        <span className="w-full text-warning">
          Periksa angka yang ditandai sebelum dibagikan ke klien.
        </span>
      ) : null}
    </div>
  );
}
