import { Sparkline } from './Sparkline.js';
import { DeltaPill, type GoodDirection } from './DeltaPill.js';
import { cn } from '../utils/cn.js';

export interface StatTileProps {
  /** Small uppercase eyebrow label, e.g. "ROAS". */
  label: string;
  /** Pre-formatted metric value, e.g. "$36.5K" or "3.44x". */
  value: string;
  delta: number | null;
  goodDirection?: GoodDirection;
  sparkline?: readonly number[];
  /** Series color for the sparkline + group pip (a token var). */
  color?: string;
  /** Optional comparison caption, e.g. "vs prev 30 days". */
  comparison?: string;
  className?: string;
}

/**
 * The core KPI tile: eyebrow → large tabular value → delta pill, with a
 * sparkline anchored bottom-right. Layout and hierarchy follow DASHBOARD_IA.md.
 */
export const StatTile = ({
  label,
  value,
  delta,
  goodDirection = 'up',
  sparkline = [],
  color = 'var(--color-accent)',
  comparison,
  className,
}: StatTileProps) => (
  <div
    className={cn(
      'group relative flex flex-col justify-between overflow-hidden rounded-lg border border-border bg-surface p-4',
      'transition-colors duration-[var(--dur-base)] ease-standard hover:border-border-strong',
      className,
    )}
  >
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <span className="text-micro font-semibold uppercase tracking-wider text-muted">{label}</span>
    </div>

    <div className="mt-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate font-mono text-kpi font-semibold tabular-nums text-primary">
          {value}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <DeltaPill delta={delta} goodDirection={goodDirection} />
          {comparison ? <span className="text-[11px] text-muted">{comparison}</span> : null}
        </div>
      </div>
      <Sparkline data={sparkline} color={color} className="mb-0.5 shrink-0" />
    </div>
  </div>
);
