import type { Caller } from './api-auth';

/**
 * Relay to tempo-engine's `POST /v1/chat` (Tempo Chat PRD §11, D2): all model
 * calls live in the engine, this app only forwards and renders. Mirrors
 * `strategy-report-pipeline.ts` — nothing here reads data or computes a number.
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

export interface ChatReply {
  conversationId: string;
  client: { slug: string; name: string; northStar: string };
  reply: string;
  verified: boolean;
  unverifiedNumerals: string[];
  toolCalls: ChatToolCall[];
  model: string;
  promptVersion: string;
  durationS: number;
}

export interface ChatRelayRequest {
  slug: string;
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

function engineMessage(status: number, body: string): string {
  if (status === 503) return 'Model chat lokal sedang tidak tersedia. Coba lagi sebentar lagi.';
  if (status === 502) return 'Model chat mengembalikan galat. Coba lagi.';
  return body || 'Terjadi kesalahan saat menghubungi Tempo.';
}

/** `POST /v1/chat`; 404 = unknown client, 503/502 = model unreachable/errored. */
export async function requestChat(req: ChatRelayRequest): Promise<ChatReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${TEMPO_ENGINE_URL}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_slug: req.slug,
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

  if (res.status === 404) {
    throw new ChatEngineError(404, (await res.text()) || `Klien "${req.slug}" tidak ditemukan.`);
  }
  if (!res.ok) {
    throw new ChatEngineError(res.status >= 500 ? 502 : res.status, engineMessage(res.status, await res.text()));
  }

  const data = (await res.json()) as Record<string, unknown>;
  const client = (data.client ?? {}) as Record<string, unknown>;
  return {
    conversationId: String(data.conversation_id ?? ''),
    client: {
      slug: String(client.slug ?? req.slug),
      name: String(client.name ?? ''),
      northStar: String(client.north_star ?? ''),
    },
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
