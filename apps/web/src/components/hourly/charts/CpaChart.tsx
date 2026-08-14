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
 * Cost per conversion by hour, with the click-to-conversion rate alongside —
 * the "what does the outcome cost, and how often does a click become one"
 * pair for a conversion-goal client (Shop or App Install).
 */
export function CpaChart({
  data,
  currency,
  cpaLabel,
}: {
  data: HourPoint[];
  currency: string;
  cpaLabel: string;
}) {
  const c = useChartTheme();
  const cur = currency as Currency;
  const money = (v: number) => formatCurrencyCompact(Math.round(v), cur);
  const Tip = makeTooltip(
    [
      { dataKey: 'cpa', label: cpaLabel, color: c.paid, format: money },
      {
        dataKey: 'conversionRate',
        label: 'Conv. rate',
        color: c.engagement,
        format: (v) => formatPercent(v, 1),
      },
    ],
    (h) => hourRangeLabel(Number(h)),
  );

  return (
    <ResponsiveContainer width="100%" height={240}>
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
          tickFormatter={(v) => money(Number(v))}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(v) => formatPercent(Number(v), 0)}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip content={Tip} cursor={{ stroke: c.cursor }} />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="cpa"
          stroke={c.paid}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="conversionRate"
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
