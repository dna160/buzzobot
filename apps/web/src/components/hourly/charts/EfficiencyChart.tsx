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
import { formatCurrencyCompact, formatPercent, type Currency } from '@tempo/core';
import { hourLabel, hourRangeLabel } from '@/lib/format-kpi';
import { makeTooltip } from '@/components/dashboard/charts/ChartTooltip';
import { useChartTheme } from '@/components/dashboard/charts/useChartTheme';

/**
 * Cost of attention by hour: CPM (left) against CTR (right).
 *
 * Recharts skips null points, so hours where a ratio is undefined (no
 * impressions, no clicks) leave a gap rather than dropping to a false zero.
 */
export function EfficiencyChart({ data, currency }: { data: HourPoint[]; currency: string }) {
  const c = useChartTheme();
  const cur = currency as Currency;
  const Tip = makeTooltip(
    [
      {
        dataKey: 'cpm',
        label: 'CPM',
        color: c.roas,
        format: (v) => formatCurrencyCompact(v, cur),
      },
      { dataKey: 'ctr', label: 'CTR', color: c.engagement, format: (v) => formatPercent(v) },
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
          tickFormatter={(v) => formatCurrencyCompact(Math.round(Number(v)), cur)}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={76}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(v) => formatPercent(Number(v), 1)}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip content={Tip} cursor={{ stroke: c.cursor }} />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="cpm"
          stroke={c.roas}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="ctr"
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
