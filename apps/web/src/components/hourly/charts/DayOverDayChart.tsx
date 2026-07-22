'use client';

import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DayOverDaySeries } from '@tempo/db';
import { formatCurrencyCompact, type Currency } from '@tempo/core';
import { hourLabel, hourRangeLabel, shortDate } from '@/lib/format-kpi';
import { makeTooltip } from '@/components/dashboard/charts/ChartTooltip';
import { useChartTheme } from '@/components/dashboard/charts/useChartTheme';

/**
 * The same hour across every day that has data, so today's curve can be read
 * against yesterday's at the same point in the day.
 *
 * Days are pivoted onto a shared hour axis; a day with no data at an hour gets
 * `null` (a gap), never a zero — an unsynced hour is not a zero-spend hour.
 */
export function DayOverDayChart({
  series,
  currency,
  highlightDate,
}: {
  series: DayOverDaySeries[];
  currency: string;
  highlightDate: string;
}) {
  const c = useChartTheme();
  const cur = currency as Currency;

  // A distinct hue per day, with the selected day emphasised.
  const palette = [c.tick, c.organic, c.roas, c.paid, c.engagement];

  const rows = useMemo(() => {
    const hours = [...new Set(series.flatMap((s) => s.points.map((p) => p.hour)))].sort(
      (a, b) => a - b,
    );
    return hours.map((hour) => {
      const row: Record<string, number | null> = { hour };
      for (const s of series) {
        row[s.date] = s.points.find((p) => p.hour === hour)?.spend ?? null;
      }
      return row;
    });
  }, [series]);

  const Tip = makeTooltip(
    series.map((s, i) => ({
      dataKey: s.date,
      label: shortDate(s.date),
      color: s.date === highlightDate ? c.paid : palette[i % palette.length]!,
      format: (v: number) => formatCurrencyCompact(v, cur),
    })),
    (h) => hourRangeLabel(Number(h)),
  );

  return (
    <ResponsiveContainer width="100%" height={260}>
      {/* No negative left margin: currency codes like "IDR" need more gutter
          than a single-character symbol, or the axis labels clip. */}
      <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
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
          tickFormatter={(v) => formatCurrencyCompact(Math.round(Number(v)), cur)}
          tick={{ fill: c.tick, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={76}
        />
        <Tooltip content={Tip} cursor={{ stroke: c.cursor }} />
        <Legend
          verticalAlign="top"
          height={28}
          iconType="plainline"
          formatter={(value) => (
            <span className="text-[11px] text-secondary">{shortDate(String(value))}</span>
          )}
        />
        {series.map((s, i) => {
          const isSelected = s.date === highlightDate;
          return (
            <Line
              key={s.date}
              type="monotone"
              dataKey={s.date}
              stroke={isSelected ? c.paid : palette[i % palette.length]}
              strokeWidth={isSelected ? 2.5 : 1.5}
              strokeOpacity={isSelected ? 1 : 0.55}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}
