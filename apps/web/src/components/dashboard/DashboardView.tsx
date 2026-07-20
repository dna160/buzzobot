'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Card, CardBody, CardHeader, EmptyState, SegmentedControl, StatTileSkeleton, Skeleton } from '@tempo/ui';
import { trpc } from '@/trpc/client';
import type { DashboardResult } from '@/trpc/types';
import { RANGE_PRESETS, SURFACE_FILTERS, type RangePresetValue, type SurfaceFilter } from '@/lib/constants';
import { KpiGrid } from './KpiGrid';
import { ExportReportButton } from './ExportReportButton';
import { PerformanceChart } from './charts/PerformanceChart';
import { EngagementChart } from './charts/EngagementChart';
import { CampaignTable } from './CampaignTable';
import { TopVideosTable } from './TopVideosTable';

const comparisonLabel: Record<RangePresetValue, string> = {
  '7d': 'vs prev 7d',
  '28d': 'vs prev 28d',
  '30d': 'vs prev 30d',
  '90d': 'vs prev 90d',
};

export function DashboardView({ slug }: { slug: string }) {
  const [preset, setPreset] = useState<RangePresetValue>('30d');
  const [surface, setSurface] = useState<SurfaceFilter>('both');

  const { data, isLoading, isError, error, isFetching } = trpc.dashboard.get.useQuery(
    { clientSlug: slug, preset },
    { placeholderData: (prev) => prev },
  );

  const showPaid = surface !== 'organic';
  const showOrganic = surface !== 'paid';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-lg text-[17px] font-semibold text-on-accent"
            style={{ backgroundColor: data?.client.brandColor ?? 'var(--color-accent)' }}
          >
            {data?.client.name?.charAt(0) ?? 'A'}
          </span>
          <div>
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-primary">
              {data?.client.name ?? 'Loading…'}
            </h1>
            <p className="flex items-center gap-2 text-[13px] text-muted">
              TikTok performance
              {isFetching ? (
                <span className="inline-flex items-center gap-1 text-accent">
                  <RefreshCw size={11} className="animate-spin" /> syncing
                </span>
              ) : null}
            </p>
          </div>
        </div>

        {/* Sticky filter controls */}
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            aria-label="Surface"
            options={SURFACE_FILTERS as unknown as { label: string; value: SurfaceFilter }[]}
            value={surface}
            onChange={setSurface}
            size="sm"
          />
          <SegmentedControl
            aria-label="Date range"
            options={RANGE_PRESETS as unknown as { label: string; value: RangePresetValue }[]}
            value={preset}
            onChange={setPreset}
            size="sm"
          />
          <div className="mx-1 h-5 w-px bg-border" aria-hidden />
          <ExportReportButton slug={slug} preset={preset} />
        </div>
      </div>

      {isError ? (
        <EmptyState
          title="Couldn't load this client"
          description={error?.message ?? 'An unexpected error occurred.'}
        />
      ) : isLoading || !data ? (
        <LoadingState />
      ) : (
        <Content data={data} showPaid={showPaid} showOrganic={showOrganic} comparison={comparisonLabel[preset]} />
      )}
    </div>
  );
}

function Content({
  data,
  showPaid,
  showOrganic,
  comparison,
}: {
  data: DashboardResult;
  showPaid: boolean;
  showOrganic: boolean;
  comparison: string;
}) {
  const currency = data.client.currency;
  const paidVisible = showPaid && data.hasPaid;
  const organicVisible = showOrganic && data.hasOrganic;

  return (
    <div className="animate-rise space-y-6">
      <KpiGrid
        paidKpis={data.paidKpis}
        organicKpis={data.organicKpis}
        currency={currency}
        comparison={comparison}
        showPaid={paidVisible}
        showOrganic={organicVisible}
      />

      {/* Chart row */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {paidVisible ? (
          <Card>
            <CardHeader title="Spend & efficiency" subtitle="Daily ad spend vs. return on ad spend" />
            <CardBody className="pl-1 pr-3">
              <PerformanceChart data={data.timeseries} currency={currency} />
            </CardBody>
          </Card>
        ) : null}
        {organicVisible ? (
          <Card>
            <CardHeader title="Reach & engagement" subtitle="Daily organic views vs. engagement rate" />
            <CardBody className="pl-1 pr-3">
              <EngagementChart data={data.timeseries} />
            </CardBody>
          </Card>
        ) : null}
      </div>

      {/* Tables */}
      {paidVisible ? (
        <Card>
          <CardHeader title="Campaign performance" subtitle="Ranked by spend over the selected window" />
          <CardBody className="px-2 py-0">
            <CampaignTable rows={data.campaigns} currency={currency} />
          </CardBody>
        </Card>
      ) : null}

      {organicVisible ? (
        <Card>
          <CardHeader title="Top content" subtitle="Best-performing organic videos by views" />
          <CardBody className="px-2 py-0">
            <TopVideosTable rows={data.topVideos} />
          </CardBody>
        </Card>
      ) : null}

      {!paidVisible && !organicVisible ? (
        <EmptyState
          title="No data for this view"
          description="Try a different surface or date range, or connect a TikTok account for this client."
        />
      ) : null}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatTileSkeleton key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Skeleton className="h-[324px] w-full rounded-lg" />
        <Skeleton className="h-[324px] w-full rounded-lg" />
      </div>
      <Skeleton className="h-[280px] w-full rounded-lg" />
    </div>
  );
}
