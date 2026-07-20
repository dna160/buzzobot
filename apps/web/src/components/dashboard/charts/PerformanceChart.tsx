'use client';

import { useId } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TimeseriesPoint } from '@tempo/db';
import { formatCurrencyCompact, formatRatio, type Currency } from '@tempo/core';
import { shortDate } from '@/lib/format-kpi';
import { makeTooltip } from './ChartTooltip';
import { useChartTheme } from './useChartTheme';

/** Paid spend (area, left axis) vs ROAS (line, right axis) over time. */
export function PerformanceChart({
  data,
  currency,
}: {
  data: TimeseriesPoint[];
  currency: string;
}) {
  const c = useChartTheme();
  const gradId = useId().replace(/:/g, '');
  const cur = currency as Currency;
  const Tip = makeTooltip([
    { dataKey: 'spend', label: 'Spend', color: c.paid, format: (v) => formatCurrencyCompact(v, cur) },
    { dataKey: 'roas', label: 'ROAS', color: c.roas, format: (v) => formatRatio(v) },
  ]);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.paid} stopOpacity={0.28} />
            <stop offset="100%" stopColor={c.paid} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: c.axis }}
          minTickGap={28}
        />
        <YAxis
          yAxisId="left"
          tickFormatter={(v) => formatCurrencyCompact(Number(v), cur)}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(v) => formatRatio(Number(v), 1)}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip content={Tip} cursor={{ stroke: c.cursor }} />
        <Area
          yAxisId="left"
          type="monotone"
          dataKey="spend"
          stroke={c.paid}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          isAnimationActive={false}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="roas"
          stroke={c.roas}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
