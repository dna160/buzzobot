'use client';

import { useEffect, useMemo, useState } from 'react';
import { GripVertical, Loader2, Plus, RotateCcw, Save, TriangleAlert, X } from 'lucide-react';
import type { BriefObjective, MetricKey } from '@tempo/core';
import {
  CATEGORY_LABELS,
  addMetric,
  moveMetric,
  paletteFor,
  previewSpec,
  removeMetric,
  replaceMetric,
  setTarget,
  type ReportSpec,
} from '@tempo/reports/spec-editor';
import { Button, Card, CardBody, CardHeader, cn } from '@tempo/ui';
import { trpc } from '@/trpc/client';

/**
 * The AM-facing spec editor (Brief Deck PRD §3.3, §8, D3, M6).
 *
 * Every rule it enforces comes from `@tempo/reports` — the palette, the slot
 * swap, the grid preview, and "would this save" are the same functions the
 * export path uses. This file is arrangement and affordance; it decides
 * nothing about what a valid spec is.
 *
 * Slot Swap is a drag *or* a click. Drag is what the PRD describes and what
 * feels right with a mouse; click-to-select-then-pick does the same splice and
 * works with a keyboard, on a trackpad, and for anyone who finds HTML5 drag
 * fiddly. Both call `replaceMetric`.
 *
 * Brands get presets; AMs get this (D3). There is no client-facing builder.
 */

const OBJECTIVES: BriefObjective[] = ['awareness', 'gmv', 'install'];

const OBJECTIVE_LABELS: Record<BriefObjective, string> = {
  awareness: 'Awareness',
  gmv: 'GMV',
  install: 'Install',
};

interface Props {
  slug: string;
}

export function DeckSpecEditor({ slug }: Props) {
  const [objective, setObjective] = useState<BriefObjective>('gmv');
  const utils = trpc.useUtils();
  const query = trpc.reportSpec.get.useQuery({ slug, objective });

  const [draft, setDraft] = useState<ReportSpec | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The editor opens on what the client is getting today — the stored spec if
  // there is one, the preset otherwise — and resets when the objective changes.
  useEffect(() => {
    setDraft(query.data?.spec ?? null);
    setSelectedSlot(null);
    setError(null);
  }, [query.data?.spec, objective]);

  const save = trpc.reportSpec.save.useMutation({
    onSuccess: () => {
      setError(null);
      utils.reportSpec.get.invalidate({ slug, objective });
    },
    onError: (e) => setError(e.message),
  });
  const reset = trpc.reportSpec.reset.useMutation({
    onSuccess: () => utils.reportSpec.get.invalidate({ slug, objective }),
  });

  const palette = useMemo(
    () => (draft ? paletteFor(objective, draft) : []),
    [draft, objective],
  );
  const preview = useMemo(
    () => (draft ? previewSpec(draft, objective) : null),
    [draft, objective],
  );

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(query.data?.spec),
    [draft, query.data?.spec],
  );

  if (query.isLoading || !draft || !preview) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-muted">Loading deck configuration…</p>
        </CardBody>
      </Card>
    );
  }

  const apply = (next: ReportSpec) => {
    setDraft(next);
    setError(null);
  };

  const pick = (metric: MetricKey) => {
    // A selected slot means "swap this one"; otherwise the pick appends.
    apply(selectedSlot === null ? addMetric(draft, metric) : replaceMetric(draft, selectedSlot, metric));
    setSelectedSlot(null);
  };

  const tiles = draft.metrics.slice(0, 6);
  const overflow = draft.metrics.slice(6);
  const labelOf = (metric: MetricKey) =>
    palette.flatMap((g) => g.entries).find((e) => e.metric === metric)?.label ?? metric;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Deck metrics"
          subtitle="Which figures this client's deck leads with. Order is priority — the first six tile, the rest go to Lampiran A."
          action={
            <div className="flex items-center gap-2">
              {query.data?.isStored && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => reset.mutate({ slug, objective })}
                  disabled={reset.isPending}
                >
                  <RotateCcw className="h-4 w-4" />
                  <span className="ml-1.5">Use preset</span>
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => save.mutate({ slug, objective, spec: draft })}
                disabled={!dirty || !preview.valid || save.isPending}
              >
                {save.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span className="ml-1.5">Save</span>
              </Button>
            </div>
          }
        />
        <CardBody>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {OBJECTIVES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setObjective(value)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-[13px] font-medium',
                  // `bg-accent`/`text-on-accent` are the design system's
                  // selected-state pair (see Sidebar); `bg-primary` is a *text*
                  // colour token and painted the chip white on white.
                  value === objective
                    ? 'border-transparent bg-accent text-on-accent'
                    : 'border-border text-secondary hover:bg-surface-hover',
                )}
              >
                {OBJECTIVE_LABELS[value]}
              </button>
            ))}
            {query.data && !query.data.availableForClient && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />
                This client&apos;s north star is {query.data.client.northStar} — the export refuses
                this objective, so a spec here is preparation, not a live deck.
              </span>
            )}
          </div>

          {error && (
            <p className="mb-3 rounded-md border border-border bg-surface-alt p-3 text-[13px] text-secondary">
              {error}
            </p>
          )}

          {/* The grid, as the deck will build it. */}
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
            Slide 1 · {preview.grid.layout}
            {selectedSlot !== null && ' · pick a metric to fill the selected tile'}
          </p>
          <div
            className={cn(
              'grid gap-3',
              preview.grid.layout === '2x2' ? 'grid-cols-2' : 'grid-cols-3',
            )}
          >
            {tiles.map((metric, index) => (
              <div
                key={`${metric}-${index}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const dropped = e.dataTransfer.getData('text/metric') as MetricKey;
                  if (dropped) apply(replaceMetric(draft, index, dropped));
                }}
                onClick={() => setSelectedSlot(selectedSlot === index ? null : index)}
                className={cn(
                  'cursor-pointer rounded-lg border p-3 text-left transition',
                  selectedSlot === index
                    ? 'border-accent ring-2 ring-[var(--color-accent-ring)]'
                    : 'border-border hover:border-secondary',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                    {labelOf(metric)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${labelOf(metric)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      apply(removeMetric(draft, index));
                    }}
                    className="text-muted hover:text-primary"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Move earlier"
                    disabled={index === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      apply(moveMetric(draft, index, index - 1));
                    }}
                    className="rounded px-1 text-[12px] text-muted hover:bg-surface-alt disabled:opacity-30"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label="Move later"
                    disabled={index === draft.metrics.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      apply(moveMetric(draft, index, index + 1));
                    }}
                    className="rounded px-1 text-[12px] text-muted hover:bg-surface-alt disabled:opacity-30"
                  >
                    →
                  </button>
                  <GripVertical className="ml-auto h-3.5 w-3.5 text-muted" />
                </div>
              </div>
            ))}
          </div>

          {overflow.length > 0 && (
            <p className="mt-3 text-[12px] text-muted">
              Also in Lampiran A: {overflow.map(labelOf).join(' · ')}
            </p>
          )}
          {preview.invalid.length > 0 && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-[var(--color-negative)]">
              <TriangleAlert className="h-4 w-4" />
              {preview.invalid.map(labelOf).join(', ')} cannot appear on an{' '}
              {OBJECTIVE_LABELS[objective]} deck.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Available metrics"
          subtitle="Drag onto a tile to swap it, or select a tile and click. Only metrics this objective can honestly show are listed."
        />
        <CardBody>
          <div className="space-y-4">
            {palette.map((group) => (
              <div key={group.category}>
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
                  {CATEGORY_LABELS[group.category]}
                </p>
                <div className="flex flex-wrap gap-2">
                  {group.entries.map((entry) => (
                    <button
                      key={entry.metric}
                      type="button"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/metric', entry.metric)}
                      onClick={() => pick(entry.metric)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px]',
                        entry.inUse
                          ? 'border-border bg-surface-active text-muted'
                          : 'border-border text-secondary hover:border-secondary hover:text-primary',
                      )}
                    >
                      {!entry.inUse && <Plus className="h-3.5 w-3.5" />}
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Targets"
          subtitle="A target outranks the catalog band when a tile is graded — set one only where this client has agreed a number."
        />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2">
            {tiles.map((metric) => (
              <label key={metric} className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-secondary">{labelOf(metric)}</span>
                <input
                  type="number"
                  step="any"
                  value={draft.targets?.[metric] ?? ''}
                  placeholder="—"
                  onChange={(e) =>
                    apply(setTarget(draft, metric, e.target.value === '' ? null : Number(e.target.value)))
                  }
                  className="h-9 w-32 rounded-md border border-border bg-surface px-3 text-sm text-primary"
                />
              </label>
            ))}
          </div>
          <div className="mt-5 space-y-2 border-t border-border pt-4">
            {(['rawTable', 'allVideos', 'internal'] as const).map((key) => (
              <label key={key} className="flex items-center gap-2 text-[13px] text-secondary">
                <input
                  type="checkbox"
                  checked={draft.appendix[key]}
                  onChange={(e) =>
                    apply({ ...draft, appendix: { ...draft.appendix, [key]: e.target.checked } })
                  }
                />
                {key === 'rawTable' && 'Lampiran A — raw daily data'}
                {key === 'allVideos' && 'Lampiran B — every video in the window'}
                {key === 'internal' && 'Lampiran C — internal (probe trace, below-the-cut)'}
              </label>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
