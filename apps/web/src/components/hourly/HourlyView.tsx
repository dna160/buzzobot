'use client';

import { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  SegmentedControl,
  Skeleton,
  StatTile,
  StatTileSkeleton,
} from '@tempo/ui';
import {
  formatCurrencyCompact,
  formatNumberCompact,
  formatPercent,
  type Currency,
} from '@tempo/core';
import { trpc } from '@/trpc/client';
import type { HourlyResult } from '@/trpc/types';
import { hourLabel, orNa, shortDate } from '@/lib/format-kpi';
import { PacingChart } from './charts/PacingChart';
import { DeliveryChart } from './charts/DeliveryChart';
import { EfficiencyChart } from './charts/EfficiencyChart';
import { DayOverDayChart } from './charts/DayOverDayChart';
import { HourlyCampaignTable } from './HourlyCampaignTable';
import { ExportHourlyReportButton } from './ExportHourlyReportButton';

export function HourlyView({ slug }: { slug: string }) {
  const [date, setDate] = useState<string | undefined>(undefined);

  const { data, isLoading, isError, error, isFetching } = trpc.dashboard.hourly.useQuery(
    { clientSlug: slug, date },
    { placeholderData: (prev) => prev },
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-lg text-[17px] font-semibold text-on-accent"
            style={{ backgroundColor: data?.client.brandColor ?? 'var(--color-accent)' }}
          >
            {data?.client.name?.charAt(0) ?? '·'}
          </span>
          <div>
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-primary">
              {data?.client.name ?? 'Loading…'}
            </h1>
            <p className="flex items-center gap-2 text-[13px] text-muted">
              Hour-by-hour campaign performance
              {data ? ` · ${data.client.timezone}` : null}
              {isFetching ? (
                <span className="inline-flex items-center gap-1 text-accent">
                  <RefreshCw size={11} className="animate-spin" /> syncing
                </span>
              ) : null}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {data && data.availableDates.length > 0 ? (
            <SegmentedControl
              aria-label="Date"
              options={data.availableDates.map((d) => ({ label: shortDate(d), value: d }))}
              value={data.date}
              onChange={setDate}
              size="sm"
            />
          ) : null}
          <div className="mx-1 h-5 w-px bg-border" aria-hidden />
          <ExportHourlyReportButton slug={slug} />
        </div>
      </header>

      {isError ? (
        <EmptyState
          title="Couldn't load intraday data"
          description={error?.message ?? 'An unexpected error occurred.'}
        />
      ) : isLoading || !data ? (
        <LoadingState />
      ) : (
        <Content data={data} />
      )}
    </div>
  );
}

/**
 * Says plainly which hours on screen are real hours. Without this, the first
 * synced bucket of a day reads as a genuine spike and a part-synced day reads
 * as a collapse in delivery.
 */
function CoverageNotice({ data }: { data: HourlyResult }) {
  const { coverage } = data;
  const notes: string[] = [];

  // A span of 2 at 01:00 only absorbs the always-empty hour 00 — real, but not
  // worth a warning on every complete day. Only flag materially large buckets.
  const material = coverage.aggregatedHours.filter((a) => a.spanHours >= 3);
  if (material.length > 0) {
    const list = material
      .map((a) => `${hourLabel(a.hour)} (${a.spanHours}h)`)
      .join(', ');
    notes.push(
      `${list} carries everything accumulated since midnight, not a single hour — it is excluded from the hourly charts below but still counted in the day's totals.`,
    );
  }
  if (!coverage.isComplete && coverage.lastHour !== null) {
    notes.push(
      `The export for this day stops after ${hourLabel(coverage.lastHour)}; later hours are not yet synced, so they are shown as gaps rather than zeros.`,
    );
  }
  if (notes.length === 0) return null;

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/[0.07] px-3.5 py-3">
      <AlertTriangle size={15} className="mt-px shrink-0 text-warning" />
      <div className="space-y-1 text-[12.5px] leading-relaxed text-secondary">
        {notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
      </div>
    </div>
  );
}

function Content({ data }: { data: HourlyResult }) {
  const cur = data.client.currency as Currency;
  // Round before formatting: sub-unit precision is noise for IDR (and makes the
  // tile value long enough to truncate), while CPC/CPM land under the compact
  // threshold and would otherwise render with two decimal places.
  const money = (v: number) => formatCurrencyCompact(Math.round(v), cur);
  const { totals, coverage } = data;

  const hoursObserved = data.hours.length;
  const peak = data.hours.reduce<(typeof data.hours)[number] | null>(
    (best, h) => (best === null || h.spend > best.spend ? h : best),
    null,
  );

  return (
    <div className="animate-rise space-y-6">
      <CoverageNotice data={data} />

      {/* Day totals. Includes the aggregated bucket so spend reconciles with
          the platform, even though the hourly charts exclude it. Deltas compare
          only the hours both days share — see `comparison` in the read-model. */}
      {(() => {
        const d = data.comparison?.deltas;
        // The value is the whole day; the delta covers only the hours both days
        // share. State the basis so the two are never read as the same window.
        const caption = data.comparison
          ? `vs ${data.comparison.hoursMatched.length}h on ${shortDate(data.comparison.date)}`
          : undefined;
        // Sparklines are the true-hour series. Derived ratios drop their null
        // hours rather than plotting them as zero.
        const spark = <K extends keyof (typeof data.hours)[number]>(key: K) =>
          data.hours.map((h) => h[key]).filter((v): v is number => typeof v === 'number');

        const tiles = [
          { label: 'Spend', value: money(totals.spend), delta: d?.spend, dir: 'neutral', key: 'spend' },
          { label: 'Impressions', value: formatNumberCompact(totals.impressions), delta: d?.impressions, dir: 'up', key: 'impressions' },
          { label: 'Clicks', value: formatNumberCompact(totals.clicks), delta: d?.clicks, dir: 'up', key: 'clicks' },
          { label: 'CTR', value: orNa(totals.ctr, (v) => formatPercent(v)), delta: d?.ctr, dir: 'up', key: 'ctr' },
          { label: 'CPC', value: orNa(totals.cpc, money), delta: d?.cpc, dir: 'down', key: 'cpc' },
          { label: 'CPM', value: orNa(totals.cpm, money), delta: d?.cpm, dir: 'down', key: 'cpm' },
        ] as const;

        return (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map((t) => (
              <StatTile
                key={t.label}
                label={t.label}
                value={t.value}
                delta={t.delta ?? null}
                goodDirection={t.dir}
                comparison={caption}
                sparkline={spark(t.key)}
              />
            ))}
          </div>
        );
      })()}

      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <Badge>
          {coverage.firstHour !== null && coverage.lastHour !== null
            ? `${hourLabel(coverage.firstHour)} – ${hourLabel(coverage.lastHour)}`
            : 'no hours'}
        </Badge>
        <span>{hoursObserved} true hours</span>
        {peak ? (
          <>
            <span aria-hidden>·</span>
            <span>
              peak {hourLabel(peak.hour)} at {money(peak.spend)}
            </span>
          </>
        ) : null}
        {data.comparison ? (
          <>
            <span aria-hidden>·</span>
            <span>
              compared against the same {data.comparison.hoursMatched.length} hours on{' '}
              {shortDate(data.comparison.date)}
            </span>
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Budget pacing"
            subtitle="Cumulative spend delivered vs. an even hourly pace"
          />
          <CardBody className="pl-1 pr-3">
            <PacingChart data={data.pacing} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Delivery" subtitle="Impressions and clicks per hour" />
          <CardBody className="pl-1 pr-3">
            <DeliveryChart data={data.hours} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Efficiency by hour"
            subtitle="Cost per thousand impressions vs. click-through rate"
          />
          <CardBody className="pl-1 pr-3">
            <EfficiencyChart data={data.hours} currency={data.client.currency} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Day over day"
            subtitle="Spend at the same hour across every day with data"
          />
          <CardBody className="pl-1 pr-3">
            <DayOverDayChart
              series={data.dayOverDay}
              currency={data.client.currency}
              highlightDate={data.date}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Campaigns"
          subtitle="Totals for the selected day — expand a row for its adgroups"
        />
        <CardBody className="px-2 py-0">
          {data.campaigns.length > 0 ? (
            <HourlyCampaignTable campaigns={data.campaigns} currency={data.client.currency} />
          ) : (
            <div className="px-2 py-8">
              <EmptyState
                title="No campaign activity"
                description="Nothing was delivered on this date."
              />
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <StatTileSkeleton key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[304px] w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[280px] w-full rounded-lg" />
    </div>
  );
}
