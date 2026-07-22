import type { NarrativeConfig, NarrativeProvider } from '../provider.js';
import { NARRATIVE_JSON_SCHEMA } from '../schema.js';

/**
 * Provider for LM Studio and other OpenAI-compatible servers (Ollama, vLLM,
 * llama.cpp). Plain HTTP rather than an SDK: these are third-party endpoints
 * that merely speak the OpenAI wire format, and pulling in a vendor SDK to talk
 * to a local llama.cpp server would be misleading about what it is.
 *
 * Local servers vary in how well they honour `response_format`, so the reply is
 * defensively unwrapped: fenced code blocks and leading prose are stripped
 * before parsing. Whatever survives still has to pass schema validation and the
 * numeric guard, so a sloppy local model fails closed to the deterministic
 * narrative rather than producing a wrong report.
 */
export class OpenAiCompatibleNarrativeProvider implements NarrativeProvider {
  readonly name: string;

  constructor(private readonly config: NarrativeConfig) {
    this.name = config.provider === 'lmstudio' ? 'lmstudio' : 'openai-compatible';
  }

  async complete({
    system,
    user,
    signal,
  }: {
    system: string;
    user: string;
    signal: AbortSignal;
  }): Promise<string> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          // LM Studio ignores auth; other compatible servers may require it.
          ...(process.env.REPORT_NARRATIVE_API_KEY
            ? { Authorization: `Bearer ${process.env.REPORT_NARRATIVE_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          // Honoured by LM Studio ≥0.3 and vLLM; harmlessly ignored elsewhere.
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'report_narrative', schema: NARRATIVE_JSON_SCHEMA, strict: true },
          },
          max_tokens: 8192,
          stream: false,
        }),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not reach the local model at ${url} (${reason}). Is LM Studio running with the server enabled?`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Local model returned ${res.status}: ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content;
    if (!raw) throw new Error('Local model returned no content.');
    return stripToJson(raw);
  }
}

/** Pull the JSON object out of a reply that may be fenced or prefaced. */
export function stripToJson(raw: string): string {
  const trimmed = raw.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
}
