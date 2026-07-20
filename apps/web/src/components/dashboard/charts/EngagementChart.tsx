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
import { formatNumberCompact, formatPercent } from '@tempo/core';
import { shortDate } from '@/lib/format-kpi';
import { makeTooltip } from './ChartTooltip';
import { useChartTheme } from './useChartTheme';

/** Organic views (area, left axis) vs engagement rate (line, right axis). */
export function EngagementChart({ data }: { data: TimeseriesPoint[] }) {
  const c = useChartTheme();
  const gradId = useId().replace(/:/g, '');
  const Tip = makeTooltip([
    { dataKey: 'views', label: 'Views', color: c.organic, format: formatNumberCompact },
    { dataKey: 'engagementRate', label: 'Eng. Rate', color: c.engagement, format: (v) => formatPercent(v, 1) },
  ]);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.organic} stopOpacity={0.28} />
            <stop offset="100%" stopColor={c.organic} stopOpacity={0} />
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
          tickFormatter={(v) => formatNumberCompact(Number(v))}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(v) => formatPercent(Number(v), 0)}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip content={Tip} cursor={{ stroke: c.cursor }} />
        <Area
          yAxisId="left"
          type="monotone"
          dataKey="views"
          stroke={c.organic}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          isAnimationActive={false}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="engagementRate"
          stroke={c.engagement}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
