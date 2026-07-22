'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Plug, Save, TriangleAlert, XCircle } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, SegmentedControl, cn } from '@tempo/ui';
import { trpc } from '@/trpc/client';

type Provider = 'anthropic' | 'lmstudio' | 'openai-compatible' | 'off';

const PROVIDER_OPTIONS = [
  { label: 'LM Studio', value: 'lmstudio' as const },
  { label: 'Compatible', value: 'openai-compatible' as const },
  { label: 'Anthropic', value: 'anthropic' as const },
  { label: 'Off', value: 'off' as const },
];

/** Editable state — mirrors the report narrative config the server accepts. */
interface FormState {
  provider: Provider;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxAttempts: number;
  strict: boolean;
}

const isLocal = (p: Provider) => p === 'lmstudio' || p === 'openai-compatible';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-secondary">{label}</span>
      {hint ? <span className="ml-2 text-[12px] text-muted">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputCls =
  'h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-primary ' +
  'placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-[var(--color-accent-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-canvas';

export function ReportAiSettings() {
  const utils = trpc.useUtils();
  const query = trpc.settings.getReportAi.useQuery();
  const save = trpc.settings.updateReportAi.useMutation({
    onSuccess: () => utils.settings.getReportAi.invalidate(),
  });
  const test = trpc.settings.testReportAiConnection.useMutation();

  const [form, setForm] = useState<FormState | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Seed the form from the effective (env + saved) config once it loads.
  useEffect(() => {
    if (query.data && !form) {
      const e = query.data.effective;
      setForm({
        provider: e.provider as Provider,
        model: e.model,
        baseUrl: e.baseUrl,
        timeoutMs: e.timeoutMs,
        maxAttempts: e.maxAttempts,
        strict: e.strict,
      });
    }
  }, [query.data, form]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSavedAt(null);
    test.reset();
  };

  const testResult = test.data;
  const overridden = useMemo(
    () => new Set(query.data?.overriddenKeys ?? []),
    [query.data?.overriddenKeys],
  );

  if (query.isLoading || !form) {
    return (
      <Card>
        <CardBody className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={15} className="animate-spin" /> Loading settings…
        </CardBody>
      </Card>
    );
  }

  const onSave = () => {
    save.mutate(form, { onSuccess: () => setSavedAt(Date.now()) });
  };

  const onTest = () => {
    test.mutate({ baseUrl: form.baseUrl, model: form.model, timeoutMs: form.timeoutMs });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Report AI"
          subtitle="Who writes the narrative prose in exported reports. The figures are always computed deterministically first — the model only interprets them, and every number it cites is verified before the report is accepted."
        />
        <CardBody className="space-y-5">
          <Field label="Provider">
            <SegmentedControl
              options={PROVIDER_OPTIONS}
              value={form.provider}
              onChange={(v) => set('provider', v)}
              aria-label="Report AI provider"
            />
          </Field>

          {form.provider === 'off' ? (
            <p className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-[13px] text-secondary">
              Reports use the deterministic narrative only — no model is called.
            </p>
          ) : null}

          {form.provider === 'anthropic' ? (
            <p className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-[13px] text-secondary">
              Uses the Claude API.{' '}
              {query.data?.apiKeyConfigured ? (
                <span className="text-success">An API key is configured.</span>
              ) : (
                <span className="text-warning">
                  No <code className="text-primary">ANTHROPIC_API_KEY</code> is set — generation will
                  fall back to the deterministic narrative.
                </span>
              )}
            </p>
          ) : null}

          {isLocal(form.provider) ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Base URL" hint={overridden.has('baseUrl') ? 'saved' : 'from .env'}>
                <input
                  className={inputCls}
                  value={form.baseUrl}
                  onChange={(e) => set('baseUrl', e.target.value)}
                  placeholder="http://localhost:1234/v1"
                  spellCheck={false}
                />
              </Field>
              <Field label="Model" hint={overridden.has('model') ? 'saved' : 'from .env'}>
                <input
                  className={inputCls}
                  value={form.model}
                  onChange={(e) => set('model', e.target.value)}
                  placeholder="qwen2.5-14b-instruct"
                  spellCheck={false}
                />
              </Field>
            </div>
          ) : null}

          {form.provider === 'anthropic' ? (
            <Field label="Model" hint={overridden.has('model') ? 'saved' : 'from .env'}>
              <input
                className={inputCls}
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
                placeholder="claude-opus-4-8"
                spellCheck={false}
              />
            </Field>
          ) : null}

          {/* Advanced generation controls — apply to any model provider. */}
          {form.provider !== 'off' ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Timeout (ms)">
                <input
                  type="number"
                  className={inputCls}
                  value={form.timeoutMs}
                  min={1000}
                  step={1000}
                  onChange={(e) => set('timeoutMs', Number(e.target.value) || 0)}
                />
              </Field>
              <Field label="Max attempts">
                <input
                  type="number"
                  className={inputCls}
                  value={form.maxAttempts}
                  min={1}
                  max={5}
                  onChange={(e) => set('maxAttempts', Number(e.target.value) || 1)}
                />
              </Field>
              <Field label="Strict mode" hint="fail vs. fall back">
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.strict}
                  onClick={() => set('strict', !form.strict)}
                  className={cn(
                    'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors',
                    form.strict
                      ? 'border-accent bg-accent/10 text-primary'
                      : 'border-border bg-surface text-secondary hover:bg-surface-hover',
                  )}
                >
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      form.strict ? 'bg-accent' : 'bg-muted',
                    )}
                  />
                  {form.strict ? 'On' : 'Off'}
                </button>
              </Field>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* Connection test — only meaningful for a local/compatible endpoint. */}
      {isLocal(form.provider) ? (
        <Card>
          <CardHeader
            title="Connection"
            subtitle="Check the endpoint is reachable, the model is loaded, and it returns valid JSON — before you rely on it in an export."
            action={
              <Button variant="secondary" size="sm" onClick={onTest} disabled={test.isPending}>
                {test.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Testing…
                  </>
                ) : (
                  <>
                    <Plug size={14} /> Test connection
                  </>
                )}
              </Button>
            }
          />
          {testResult ? (
            <CardBody className="space-y-2">
              {testResult.steps.map((step) => (
                <div key={step.key} className="flex items-start gap-2.5 text-[13px]">
                  {step.status === 'pass' ? (
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
                  ) : step.status === 'warn' ? (
                    <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" />
                  ) : (
                    <XCircle size={16} className="mt-0.5 shrink-0 text-danger" />
                  )}
                  <div>
                    <span className="font-medium text-primary">{step.label}</span>
                    <span className="text-muted"> — {step.detail}</span>
                  </div>
                </div>
              ))}
              <p
                className={cn(
                  'mt-1 text-[13px] font-medium',
                  testResult.ok ? 'text-success' : 'text-danger',
                )}
              >
                {testResult.ok
                  ? 'Ready — this endpoint can write reports.'
                  : 'Not ready — reports will fall back to deterministic prose.'}
              </p>
            </CardBody>
          ) : test.isError ? (
            <CardBody>
              <p className="text-[13px] text-danger">Test failed to run: {test.error.message}</p>
            </CardBody>
          ) : null}
        </Card>
      ) : null}

      {/* Save bar */}
      <div className="flex items-center gap-3">
        <Button onClick={onSave} disabled={save.isPending}>
          {save.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Save size={14} /> Save settings
            </>
          )}
        </Button>
        {savedAt ? (
          <span className="flex items-center gap-1.5 text-[13px] text-success">
            <CheckCircle2 size={15} /> Saved — takes effect on the next export.
          </span>
        ) : save.isError ? (
          <span className="text-[13px] text-danger">Save failed: {save.error.message}</span>
        ) : (
          <span className="text-[13px] text-muted">
            Saved settings override <code className="text-secondary">.env</code> and apply
            immediately — no restart.
          </span>
        )}
      </div>
    </div>
  );
}
