'use client';

import type { TooltipProps } from 'recharts';
import { shortDate } from '@/lib/format-kpi';

export interface TooltipSeries {
  dataKey: string;
  label: string;
  color: string;
  format: (v: number) => string;
}

/**
 * A themed tooltip factory. Pass the series metadata; returns a Recharts-shaped
 * content component that renders each active series with its own formatter.
 */
export const makeTooltip =
  (series: TooltipSeries[]) =>
  ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="min-w-[160px] rounded-md border border-border bg-elevated p-2.5 shadow-popover">
        <div className="mb-1.5 text-[11px] font-medium text-muted">{shortDate(String(label))}</div>
        <div className="space-y-1">
          {series.map((s) => {
            const point = payload.find((p) => p.dataKey === s.dataKey);
            if (!point || point.value == null) return null;
            return (
              <div key={s.dataKey} className="flex items-center justify-between gap-4 text-[12px]">
                <span className="flex items-center gap-1.5 text-secondary">
                  <span className="h-2 w-2 rounded-[3px]" style={{ backgroundColor: s.color }} />
                  {s.label}
                </span>
                <span className="font-mono font-medium tabular-nums text-primary">
                  {s.format(Number(point.value))}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
