/**
 * Connectivity probe for a local / OpenAI-compatible LLM server (LM Studio,
 * Ollama, vLLM, llama.cpp). One implementation, two callers: the CLI doctor
 * (`check-local-llm.ts`) and the Settings "Test connection" button both run
 * this so their verdicts can never drift apart.
 *
 * It answers three questions without touching the database or the report
 * pipeline: is the server reachable, is the configured model loaded, and does a
 * schema-constrained completion round-trip parse back as JSON?
 */

export interface ProbeStep {
  /** Stable identifier for the check. */
  key: 'reachable' | 'model' | 'roundtrip';
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface LocalLlmProbeResult {
  /** True only when nothing failed (warnings are tolerated). */
  ok: boolean;
  baseUrl: string;
  model: string;
  reachable: boolean;
  /** Model ids the server reports serving, when reachable. */
  servedModels: string[];
  steps: ProbeStep[];
}

export interface ProbeConfig {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  /** Sent as a Bearer token when set; LM Studio ignores it, others may need it. */
  apiKey?: string;
}

/** A short-lived AbortSignal so a hung server can't wedge the probe. */
function deadline(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

export async function probeLocalLlm(config: ProbeConfig): Promise<LocalLlmProbeResult> {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const model = config.model;
  const timeoutMs = config.timeoutMs ?? 120_000;
  const authHeaders: Record<string, string> = config.apiKey
    ? { Authorization: `Bearer ${config.apiKey}` }
    : {};

  const steps: ProbeStep[] = [];
  const result: LocalLlmProbeResult = {
    ok: false,
    baseUrl,
    model,
    reachable: false,
    servedModels: [],
    steps,
  };

  // 1 — reachability + served model list.
  {
    const { signal, done } = deadline(Math.min(timeoutMs, 10_000));
    try {
      const res = await fetch(`${baseUrl}/models`, { headers: authHeaders, signal });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        steps.push({
          key: 'reachable',
          label: 'Server reachable',
          status: 'fail',
          detail: `GET /models returned ${res.status}. ${body.slice(0, 200)}`.trim(),
        });
        return result;
      }
      const json = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
      result.reachable = true;
      result.servedModels = ids;
      steps.push({
        key: 'reachable',
        label: 'Server reachable',
        status: 'pass',
        detail: `Connected to ${baseUrl} — ${ids.length} model(s) served.`,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      steps.push({
        key: 'reachable',
        label: 'Server reachable',
        status: 'fail',
        detail: `Could not reach ${baseUrl}/models (${reason}). Is the server started?`,
      });
      return result;
    } finally {
      done();
    }
  }

  // 2 — is the configured model loaded? Non-fatal: some servers route any name
  // to the single loaded model, so a mismatch is a warning, not a failure.
  if (result.servedModels.includes(model)) {
    steps.push({
      key: 'model',
      label: 'Model loaded',
      status: 'pass',
      detail: `'${model}' is loaded.`,
    });
  } else {
    steps.push({
      key: 'model',
      label: 'Model loaded',
      status: 'warn',
      detail: result.servedModels.length
        ? `'${model}' is not in the served list. Served: ${result.servedModels.join(', ')}.`
        : `'${model}' is not confirmed loaded (server reported no model list).`,
    });
  }

  // 3 — JSON round-trip through a schema-constrained completion.
  {
    const { signal, done } = deadline(timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You reply with a single JSON object and nothing else.' },
            { role: 'user', content: 'Return {"status":"ok"} exactly.' },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'preflight',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['status'],
                properties: { status: { type: 'string' } },
              },
            },
          },
          max_tokens: 64,
          stream: false,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        steps.push({
          key: 'roundtrip',
          label: 'JSON round-trip',
          status: 'fail',
          detail: `Completion returned ${res.status}. ${body.slice(0, 200)}`.trim(),
        });
        return result;
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = json.choices?.[0]?.message?.content;
      if (!raw) {
        steps.push({
          key: 'roundtrip',
          label: 'JSON round-trip',
          status: 'fail',
          detail: 'Completion returned no content.',
        });
        return result;
      }
      try {
        JSON.parse(raw);
        steps.push({
          key: 'roundtrip',
          label: 'JSON round-trip',
          status: 'pass',
          detail: 'The model returned parseable JSON.',
        });
      } catch {
        // Reachable and generating text; the pipeline's stripToJson may still
        // recover fenced/prefaced output, so this is a warning, not a failure.
        steps.push({
          key: 'roundtrip',
          label: 'JSON round-trip',
          status: 'warn',
          detail: `Replied, but not with clean JSON: ${raw.slice(0, 120).replace(/\s+/g, ' ')}`,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      steps.push({
        key: 'roundtrip',
        label: 'JSON round-trip',
        status: 'fail',
        detail: `Completion request failed (${reason}).`,
      });
      return result;
    } finally {
      done();
    }
  }

  result.ok = steps.every((s) => s.status !== 'fail');
  return result;
}
