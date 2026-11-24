import { z } from 'zod';
import { authenticate } from '@/lib/api-auth';
import { ChatEngineError, requestChat } from '@/lib/tempo-chat';

/**
 * `POST /api/chat` — the Tanya Tempo relay (PRD §11.2). One general chat over
 * the whole ads database: the body carries the conversation and, optionally,
 * the client the user is looking at (`focusSlug`, a hint for "this client").
 * Validates, authenticates the caller, and forwards to tempo-engine; it reads
 * no data and computes no number. Same-origin UI passes; anything else needs
 * an API key.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
// PRD §11.2: outlast the engine's own 280 s chat timeout.
export const maxDuration = 300;

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(20_000),
      }),
    )
    .min(1)
    .max(60),
  // The panel sends null before the first reply assigns an id; accept null too.
  conversationId: z.string().max(64).nullish(),
  focusSlug: z.string().max(200).nullish(),
});

const noStore = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok || !auth.caller) return new Response(auth.message ?? 'Unauthorized', { status: auth.status ?? 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Permintaan tidak valid.' }, { status: 422, headers: noStore });
  }
  const { messages, conversationId, focusSlug } = parsed.data;
  if (messages.at(-1)?.role !== 'user') {
    return Response.json({ error: 'Pesan terakhir harus dari pengguna.' }, { status: 422, headers: noStore });
  }

  try {
    const reply = await requestChat({ messages, conversationId, focusSlug, caller: auth.caller });
    return Response.json(reply, { headers: noStore });
  } catch (err) {
    const status = err instanceof ChatEngineError ? err.status : 502;
    const message = err instanceof ChatEngineError ? err.message : 'Terjadi kesalahan.';
    return Response.json({ error: message }, { status, headers: noStore });
  }
}
