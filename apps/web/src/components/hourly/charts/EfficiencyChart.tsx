'use client';

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { HourPoint } from '@tempo/db';
import { formatPercent } from '@tempo/core';
import { hourLabel, hourRangeLabel } from '@/lib/format-kpi';
import { makeTooltip } from '@/components/dashboard/charts/ChartTooltip';
import { useChartTheme } from '@/components/dashboard/charts/useChartTheme';

/**
 * View quality by hour: the 6-second and 15-second view-through rates.
 *
 * Recharts skips null points, so hours where a rate is undefined (no
 * impressions) leave a gap rather than dropping to a false zero. `currency` is
 * unused now that both series are rates, but kept for a stable call signature.
 */
export function EfficiencyChart({ data }: { data: HourPoint[]; currency: string }) {
  const c = useChartTheme();
  const Tip = makeTooltip(
    [
      { dataKey: 'vtr6s', label: 'VTR 6s', color: c.paid, format: (v) => formatPercent(v, 1) },
      { dataKey: 'vtr15s', label: 'VTR 15s', color: c.engagement, format: (v) => formatPercent(v, 1) },
    ],
    (h) => hourRangeLabel(Number(h)),
  );

  return (
    <ResponsiveContainer width="100%" height={240}>
      {/* No negative left margin: currency codes like "IDR" need more gutter
          than a single-character symbol, or the axis labels clip. */}
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis
          dataKey="hour"
          tickFormatter={hourLabel}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: c.axis }}
          minTickGap={20}
        />
        <YAxis
          yAxisId="left"
          tickFormatter={(v) => formatPercent(Number(v), 0)}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip content={Tip} cursor={{ stroke: c.cursor }} />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="vtr6s"
          stroke={c.paid}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="vtr15s"
          stroke={c.engagement}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
