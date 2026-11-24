import type { Caller } from './api-auth';

/**
 * Relay to tempo-engine's `POST /v1/chat` (Tempo Chat PRD §11, D2): all model
 * calls live in the engine, this app only forwards and renders. Mirrors
 * `strategy-report-pipeline.ts` — nothing here reads data or computes a number.
 * Tanya Tempo is one general chat over the whole ads database; the engine's
 * workspace (`TEMPO_SCOPE`) decides which clients its tools may read.
 *
 * The authenticated `Caller` becomes the engine's `principal`, so every turn is
 * logged with who asked (PRD §10.1). C1 carries only kind + key fingerprint.
 */

const TEMPO_ENGINE_URL = process.env.TEMPO_ENGINE_URL ?? 'http://127.0.0.1:8001';
const CHAT_TIMEOUT_MS = Number(process.env.TEMPO_CHAT_TIMEOUT_MS ?? 280_000);

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatToolCall {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface ChatClientRef {
  slug: string;
  name: string;
  northStar: string;
}

/** A report the turn reused (generated ≤ 24 h ago) or generated, with its HTML link. */
export interface ChatReportLink {
  slug: string;
  clientName: string;
  briefType: string;
  label: string;
  runId: string;
  tier: string;
  cached: boolean;
  generatedAt: string | null;
  url: string;
}

const REPORT_LABEL: Record<string, string> = {
  strategy: 'Strategy Report',
  gmv: 'GMV Brief',
  awareness: 'Awareness Brief',
  install: 'Install Brief',
};

/** The rendered HTML of a stored run — `?run=` renders it without generating. */
function reportUrl(slug: string, briefType: string, runId: string, windowDays: number): string {
  const s = encodeURIComponent(slug);
  const run = encodeURIComponent(runId);
  if (briefType === 'strategy') return `/api/reports/${s}/strategy-report?run=${run}`;
  return `/api/reports/${s}/brief/${encodeURIComponent(briefType)}?format=html&run=${run}&days=${windowDays}`;
}

export interface ChatReply {
  conversationId: string;
  scope: string;
  /** Clients this turn's tools read, in first-touch order. */
  clients: ChatClientRef[];
  reports: ChatReportLink[];
  reply: string;
  verified: boolean;
  unverifiedNumerals: string[];
  toolCalls: ChatToolCall[];
  model: string;
  promptVersion: string;
  durationS: number;
}

export interface ChatRelayRequest {
  /** Optional client the user is looking at — a hint, never a restriction. */
  focusSlug?: string | null;
  messages: ChatMessage[];
  conversationId?: string | null;
  caller: Caller;
}

export class ChatEngineError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ChatEngineError';
  }
}

function principalOf(caller: Caller): { kind: string; key_id: string | null } {
  return { kind: caller.kind, key_id: caller.kind === 'api-key' ? caller.keyId : null };
}

/** FastAPI errors arrive as `{"detail": "..."}`; fall back to the raw body. */
function detailOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
  } catch {
    /* not JSON */
  }
  return body;
}

function engineMessage(status: number, body: string): string {
  const detail = detailOf(body);
  // No /v1/chat route: the engine process predates Tempo Chat and needs a restart.
  if (status === 404) return 'Engine Tempo yang berjalan belum mendukung chat. Mulai ulang engine (pnpm stack), lalu coba lagi.';
  if (status === 503 && /not configured|TEMPO_SCOPE/i.test(detail)) {
    return `Chat belum dikonfigurasi di engine: ${detail}`;
  }
  if (status === 503) return 'Model chat lokal sedang tidak tersedia. Coba lagi sebentar lagi.';
  if (status === 502) return 'Model chat mengembalikan galat. Coba lagi.';
  return detail || 'Terjadi kesalahan saat menghubungi Tempo.';
}

/** `POST /v1/chat`; 503/502 = model unreachable/errored or chat not configured. */
export async function requestChat(req: ChatRelayRequest): Promise<ChatReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${TEMPO_ENGINE_URL}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_slug: req.focusSlug ?? null,
        messages: req.messages,
        conversation_id: req.conversationId ?? null,
        principal: principalOf(req.caller),
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    throw new ChatEngineError(
      aborted ? 504 : 502,
      aborted ? 'Tempo terlalu lama menjawab. Coba pertanyaan yang lebih spesifik.' : 'Layanan chat tidak dapat dihubungi.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new ChatEngineError(res.status >= 500 ? 502 : res.status, engineMessage(res.status, await res.text()));
  }

  const data = (await res.json()) as Record<string, unknown>;
  const clients = Array.isArray(data.clients) ? (data.clients as Record<string, unknown>[]) : [];
  const reports = Array.isArray(data.reports) ? (data.reports as Record<string, unknown>[]) : [];
  return {
    reports: reports.map((r) => {
      const slug = String(r.slug ?? '');
      const briefType = String(r.brief_type ?? '');
      const runId = String(r.run_id ?? '');
      return {
        slug,
        clientName: String(r.client_name ?? slug),
        briefType,
        label: REPORT_LABEL[briefType] ?? briefType,
        runId,
        tier: String(r.tier ?? ''),
        cached: Boolean(r.cached),
        generatedAt: typeof r.generated_at === 'string' ? r.generated_at : null,
        url: reportUrl(slug, briefType, runId, Number(r.window_days ?? 7)),
      };
    }),
    conversationId: String(data.conversation_id ?? ''),
    scope: String(data.scope ?? ''),
    clients: clients.map((c) => ({
      slug: String(c.slug ?? ''),
      name: String(c.name ?? ''),
      northStar: String(c.north_star ?? ''),
    })),
    reply: String(data.reply ?? ''),
    verified: Boolean(data.verified),
    unverifiedNumerals: Array.isArray(data.unverified_numerals) ? (data.unverified_numerals as string[]) : [],
    toolCalls: Array.isArray(data.tool_calls)
      ? (data.tool_calls as Record<string, unknown>[]).map((t) => ({
          name: String(t.name ?? ''),
          args: (t.args ?? {}) as Record<string, unknown>,
          ok: Boolean(t.ok),
        }))
      : [],
    model: String(data.model ?? ''),
    promptVersion: String(data.prompt_version ?? ''),
    durationS: Number(data.duration_s ?? 0),
  };
}
