'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { HourPoint } from '@tempo/db';
import { formatNumberCompact } from '@tempo/core';
import { hourLabel, hourRangeLabel } from '@/lib/format-kpi';
import { makeTooltip } from '@/components/dashboard/charts/ChartTooltip';
import { useChartTheme } from '@/components/dashboard/charts/useChartTheme';

/** Delivery throughput per hour: impressions (bars) against clicks (line). */
export function DeliveryChart({ data }: { data: HourPoint[] }) {
  const c = useChartTheme();
  const Tip = makeTooltip(
    [
      { dataKey: 'impressions', label: 'Impressions', color: c.paid, format: formatNumberCompact },
      { dataKey: 'clicks', label: 'Clicks', color: c.engagement, format: formatNumberCompact },
    ],
    (h) => hourRangeLabel(Number(h)),
  );

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
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
          tickFormatter={(v) => formatNumberCompact(Number(v))}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(v) => formatNumberCompact(Number(v))}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip content={Tip} cursor={{ fill: c.grid, fillOpacity: 0.4 }} />
        <Bar
          yAxisId="left"
          dataKey="impressions"
          fill={c.paid}
          fillOpacity={0.55}
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="clicks"
          stroke={c.engagement}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
