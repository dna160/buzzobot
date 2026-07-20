import type { HTMLAttributes } from 'react';
import { cn } from '../utils/cn.js';

/** A shimmering placeholder block for loading states. */
export const Skeleton = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('animate-pulse rounded-md bg-surface-active/60', className)}
    aria-hidden
    {...props}
  />
);

/** A KPI-tile-shaped skeleton, matching StatTile's footprint. */
export const StatTileSkeleton = () => (
  <div className="flex h-[124px] flex-col justify-between rounded-lg border border-border bg-surface p-4">
    <Skeleton className="h-3 w-16" />
    <div className="space-y-2">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-3 w-20" />
    </div>
  </div>
);
