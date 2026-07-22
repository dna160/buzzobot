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
import type { PacingPoint } from '@tempo/db';
import { hourLabel } from '@/lib/format-kpi';
import { makeTooltip } from '@/components/dashboard/charts/ChartTooltip';
import { useChartTheme } from '@/components/dashboard/charts/useChartTheme';

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

/**
 * Budget burn: share of the day's spend delivered by each hour, against an
 * even-pace baseline. The baseline is spread across the hours actually
 * observed, so a part-synced day isn't judged against hours it never had.
 * Above the dashed line = front-loading; below = spending late.
 */
export function PacingChart({ data }: { data: PacingPoint[] }) {
  const c = useChartTheme();
  const gradId = useId().replace(/:/g, '');
  const Tip = makeTooltip(
    [
      { dataKey: 'share', label: 'Delivered', color: c.paid, format: pct },
      { dataKey: 'evenShare', label: 'Even pace', color: c.tick, format: pct },
    ],
    (h) => hourLabel(Number(h)),
  );

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.paid} stopOpacity={0.26} />
            <stop offset="100%" stopColor={c.paid} stopOpacity={0} />
          </linearGradient>
        </defs>
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
          tickFormatter={pct}
          domain={[0, 1]}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip content={Tip} cursor={{ stroke: c.cursor }} />
        <Area
          type="monotone"
          dataKey="share"
          stroke={c.paid}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="evenShare"
          stroke={c.tick}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
