import { cn } from '../utils/cn.js';

export type GoodDirection = 'up' | 'down' | 'neutral';

export interface DeltaPillProps {
  /** Period-over-period change as a fraction (0.12 = +12%), or null. */
  delta: number | null;
  /** Whether an increase is favorable — decides green vs red. */
  goodDirection?: GoodDirection;
  className?: string;
}

/**
 * A period-over-period delta indicator. The arrow follows the *number* (up if
 * the value rose), while the color follows *favorability* — so a rising CPA
 * (lower-is-better) shows an honest up-arrow in red. See DASHBOARD_IA.md.
 */
export const DeltaPill = ({ delta, goodDirection = 'up', className }: DeltaPillProps) => {
  if (delta === null) {
    return (
      <span className={cn('inline-flex items-center text-[12px] font-medium text-muted', className)}>
        —
      </span>
    );
  }

  const rising = delta > 0;
  const flat = delta === 0;
  const favorable = flat || goodDirection === 'neutral' ? 'neutral' : rising === (goodDirection === 'up');

  const color =
    favorable === 'neutral'
      ? 'text-muted'
      : favorable
        ? 'text-delta-positive'
        : 'text-delta-negative';

  const arrow = flat ? '→' : rising ? '↑' : '↓';
  const pct = `${rising ? '+' : ''}${(delta * 100).toFixed(1)}%`;

  return (
    <span
      className={cn('inline-flex items-center gap-0.5 text-[12px] font-semibold tabular-nums', color, className)}
    >
      <span aria-hidden>{arrow}</span>
      {pct}
    </span>
  );
};
