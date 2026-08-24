'use client';

import { CheckCircle2, Loader2, RefreshCw, TriangleAlert, XCircle } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, cn } from '@tempo/ui';
import { trpc } from '@/trpc/client';

/**
 * Engine health (Brief Deck PRD §7, K6).
 *
 * This replaces the LM Studio settings card. That card asked an operator to
 * configure a model connection the surface no longer owns — narration lives in
 * tempo-engine now — so the useful question changed from "which model should I
 * point at" to **"is the engine up, and did the last deck render?"**
 *
 * It answers from two directions on purpose: `/healthz` is the engine's own
 * view, `report_runs` is the surface's. When the engine is unreachable the run
 * history still says when decks last worked, which is the first thing anyone
 * needs in that situation.
 */

function Dot({ tone }: { tone: 'ok' | 'warn' | 'bad' }) {
  const colour =
    tone === 'ok' ? 'bg-[var(--color-positive)]' : tone === 'warn' ? 'bg-amber-500' : 'bg-[var(--color-negative)]';
  return <span className={cn('inline-block h-2 w-2 rounded-full', colour)} aria-hidden />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-[13px] font-medium text-primary">{children}</span>
    </div>
  );
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function ago(iso: string | null): string {
  if (!iso) return '—';
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (Number.isNaN(minutes)) return '—';
  if (Math.abs(minutes) < 60) return RELATIVE.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return RELATIVE.format(hours, 'hour');
  return RELATIVE.format(Math.round(hours / 24), 'day');
}

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad'> = {
  completed: 'ok',
  running: 'warn',
  failed: 'bad',
};

export function EngineHealthCard() {
  const query = trpc.settings.getEngineHealth.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });

  const data = query.data;
  const engine = data?.engine ?? null;

  return (
    <Card>
      <CardHeader
        title="Analytics engine"
        subtitle="Tempo Intelligence Engine — the service that writes every deck's analysis."
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1.5">Refresh</span>
          </Button>
        }
      />
      <CardBody>
        {query.isLoading ? (
          <p className="text-sm text-muted">Checking…</p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              {data?.reachable ? (
                <CheckCircle2 className="h-4 w-4 text-[var(--color-positive)]" />
              ) : (
                <XCircle className="h-4 w-4 text-[var(--color-negative)]" />
              )}
              <span className="text-sm font-medium text-primary">
                {data?.reachable ? 'Reachable' : 'Unreachable'}
              </span>
              <code className="rounded bg-surface-alt px-1.5 py-0.5 text-[12px] text-muted">
                {data?.url}
              </code>
            </div>

            {!data?.reachable && (
              <div className="flex items-start gap-2 rounded-md border border-border bg-surface-alt p-3">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div className="text-[13px] text-secondary">
                  <p className="font-medium text-primary">Decks cannot be generated right now.</p>
                  <p className="mt-1">
                    {data?.engineError ?? 'No response.'} Start it with{' '}
                    <code className="text-[12px]">pm2 start ecosystem.config.cjs</code>, or check
                    the <code className="text-[12px]">tempo-engine</code> process.
                  </p>
                </div>
              </div>
            )}

            {engine && (
              <div className="divide-y divide-border">
                <Row label="Version">{engine.engine_version ?? '—'}</Row>
                <Row label="Content contract">v{engine.content_version ?? '—'}</Row>
                <Row label="Tiers">{(engine.tiers ?? []).join(' · ') || '—'}</Row>
                <Row label="Probe loop">
                  <span className="inline-flex items-center gap-1.5">
                    <Dot tone={engine.probe_loop_enabled ? 'ok' : 'warn'} />
                    {engine.probe_loop_enabled ? 'enabled' : 'disabled'}
                  </span>
                </Row>
                <Row label="Engine database">
                  <span className="inline-flex items-center gap-1.5">
                    <Dot tone={engine.db ? 'ok' : 'bad'} />
                    {engine.db ? 'connected' : 'unavailable'}
                  </span>
                </Row>
                <Row label="Briefs stored">{engine.briefs_total ?? 0}</Row>
                {engine.last_run && (
                  <Row label="Last engine run">
                    <span className="inline-flex items-center gap-1.5">
                      <Dot tone={engine.last_run.status === 'approved' ? 'ok' : 'warn'} />
                      {engine.last_run.brief_type} · {engine.last_run.status} ·{' '}
                      {ago(engine.last_run.updated_at ?? null)}
                    </span>
                  </Row>
                )}
              </div>
            )}

            <div>
              <h3 className="text-[13px] font-semibold text-primary">Recent decks</h3>
              {data?.recentRuns.length ? (
                <ul className="mt-2 divide-y divide-border">
                  {data.recentRuns.map((run) => (
                    <li key={run.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="inline-flex items-center gap-2 text-[13px] text-primary">
                        <Dot tone={STATUS_TONE[run.status] ?? 'warn'} />
                        <span className="font-medium">{run.objective}</span>
                        <span className="text-muted">
                          {run.tier} · to {run.periodEnd}
                        </span>
                      </span>
                      <span className="text-[12px] text-muted">
                        {run.error ? run.error.slice(0, 60) : ago(run.startedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-muted">
                  No decks generated yet. The weekly job pre-generates them; exporting one from a
                  client dashboard also records a run here.
                </p>
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
