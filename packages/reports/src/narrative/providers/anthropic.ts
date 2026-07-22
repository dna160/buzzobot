import Anthropic from '@anthropic-ai/sdk';
import type { NarrativeConfig, NarrativeProvider } from '../provider.js';
import { NARRATIVE_JSON_SCHEMA } from '../schema.js';

/**
 * Claude API provider.
 *
 * Uses structured outputs so the response is schema-valid JSON rather than
 * prose we have to scrape, and adaptive thinking because deciding what matters
 * in a dataset and how to phrase it for a client is exactly the kind of
 * judgement that benefits from it. Streamed so a long generation cannot trip
 * the request timeout.
 */
export class AnthropicNarrativeProvider implements NarrativeProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(private readonly config: NarrativeConfig) {
    // No apiKey argument: the SDK resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
    // or an `ant auth login` profile, in that order.
    this.client = new Anthropic({ timeout: config.timeoutMs });
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
    const stream = this.client.messages.stream(
      {
        model: this.config.model,
        max_tokens: 16_000,
        system,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'high',
          format: { type: 'json_schema', schema: NARRATIVE_JSON_SCHEMA },
        },
        messages: [{ role: 'user', content: user }],
      },
      { signal },
    );

    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      throw new Error('Claude declined to generate the report narrative.');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new Error('Narrative generation hit the output limit before completing.');
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    if (!text.trim()) throw new Error('Claude returned an empty narrative.');
    return text;
  }
}
