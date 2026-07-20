import { useId } from 'react';

export interface SparklineProps {
  data: readonly number[];
  width?: number;
  height?: number;
  /** Stroke color; defaults to the accent token. */
  color?: string;
  /** Fill a soft gradient area under the line. */
  area?: boolean;
  className?: string;
}

/**
 * Dependency-free inline sparkline. Renders a normalized polyline (optionally
 * with a gradient area) into a compact SVG — ideal for KPI tiles where a full
 * chart library would be overkill and slow.
 */
export const Sparkline = ({
  data,
  width = 96,
  height = 32,
  color = 'var(--color-accent)',
  area = true,
  className,
}: SparklineProps) => {
  const gradientId = useId();
  if (data.length < 2) {
    return <svg width={width} height={height} className={className} aria-hidden />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 2;
  const usableH = height - pad * 2;
  const step = width / (data.length - 1);

  const points = data.map((v, i) => {
    const x = i * step;
    const y = pad + usableH - ((v - min) / span) * usableH;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      fill="none"
      aria-hidden
    >
      {area ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} />
        </>
      ) : null}
      <path
        d={line}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
