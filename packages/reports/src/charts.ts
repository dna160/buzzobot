/**
 * Dependency-free SVG chart generators. They return self-contained SVG strings
 * with concrete colors (no CSS variables) so they render identically in a
 * headless-Chromium PDF as in a browser. Used for the deck's trend and ranking
 * charts — the only part of the pre-Brief-Deck renderer the deck still reads.
 */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface ComboPoint {
  label: string;
  bar: number;
  line: number;
}

export interface ComboOptions {
  width?: number;
  height?: number;
  barColor?: string;
  lineColor?: string;
  gridColor?: string;
  axisColor?: string;
  tickColor?: string;
  formatBar: (v: number) => string;
  formatLine: (v: number) => string;
  maxXLabels?: number;
}

/**
 * A grouped bar (left axis) + line (right axis) combo chart — the report's core
 * visual, e.g. daily spend bars with a ROAS line overlaid.
 */
export function comboChart(points: ComboPoint[], opts: ComboOptions): string {
  const {
    width = 720,
    height = 240,
    barColor = '#3987E5',
    lineColor = '#199E70',
    gridColor = '#E5E8EC',
    axisColor = '#C9CED6',
    tickColor = '#6B7280',
    formatBar,
    formatLine,
    maxXLabels = 7,
  } = opts;

  if (points.length === 0) {
    return `<svg width="${width}" height="${height}" role="img" aria-label="No data"></svg>`;
  }

  const padL = 60;
  const padR = 52;
  const padT = 14;
  const padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const barMax = niceMax(Math.max(...points.map((p) => p.bar), 0));
  const lineMax = niceMax(Math.max(...points.map((p) => p.line), 0));

  const n = points.length;
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(28, slot * 0.6));

  const yBar = (v: number) => padT + plotH - (barMax > 0 ? (v / barMax) * plotH : 0);
  const yLine = (v: number) => padT + plotH - (lineMax > 0 ? (v / lineMax) * plotH : 0);
  const xCenter = (i: number) => padL + slot * i + slot / 2;

  const parts: string[] = [];
  parts.push(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, system-ui, sans-serif">`);

  // Horizontal gridlines + left/right axis ticks (4 steps).
  const steps = 4;
  for (let s = 0; s <= steps; s += 1) {
    const y = padT + (plotH / steps) * s;
    parts.push(
      `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}" stroke="${gridColor}" stroke-width="1"/>`,
    );
    const barVal = barMax * (1 - s / steps);
    const lineVal = lineMax * (1 - s / steps);
    parts.push(
      `<text x="${padL - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="${tickColor}">${esc(
        formatBar(barVal),
      )}</text>`,
    );
    parts.push(
      `<text x="${padL + plotW + 8}" y="${(y + 3).toFixed(1)}" text-anchor="start" font-size="10" fill="${tickColor}">${esc(
        formatLine(lineVal),
      )}</text>`,
    );
  }

  // Bars.
  for (let i = 0; i < n; i += 1) {
    const p = points[i]!;
    const x = xCenter(i) - barW / 2;
    const y = yBar(p.bar);
    const h = padT + plotH - y;
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h).toFixed(
        1,
      )}" rx="2" fill="${barColor}" fill-opacity="0.85"/>`,
    );
  }

  // Line + dots.
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xCenter(i).toFixed(1)},${yLine(p.line).toFixed(1)}`)
    .join(' ');
  parts.push(`<path d="${linePath}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round"/>`);
  for (let i = 0; i < n; i += 1) {
    parts.push(
      `<circle cx="${xCenter(i).toFixed(1)}" cy="${yLine(points[i]!.line).toFixed(1)}" r="2.4" fill="${lineColor}"/>`,
    );
  }

  // X axis baseline + sparse labels.
  parts.push(
    `<line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="${axisColor}" stroke-width="1"/>`,
  );
  const labelEvery = Math.max(1, Math.ceil(n / maxXLabels));
  for (let i = 0; i < n; i += 1) {
    if (i % labelEvery !== 0 && i !== n - 1) continue;
    parts.push(
      `<text x="${xCenter(i).toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="10" fill="${tickColor}">${esc(
        points[i]!.label,
      )}</text>`,
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

export interface RankRow {
  label: string;
  value: number;
  /** Right-hand annotation, e.g. "59% · CPM IDR 4,184". */
  note?: string;
}

/**
 * Horizontal ranking bars — who contributes what. Reads far better in print
 * than a treemap: the labels stay legible and the ordering is unambiguous.
 */
export function rankChart(
  rows: RankRow[],
  opts: {
    width?: number;
    barColor?: string;
    labelColor?: string;
    noteColor?: string;
    trackColor?: string;
    format: (v: number) => string;
  },
): string {
  const {
    width = 720,
    barColor = '#2A78D6',
    labelColor = '#0D0F12',
    noteColor = '#6B7280',
    trackColor = '#EEF0F3',
    format,
  } = opts;
  if (rows.length === 0) return '';

  const rowH = 40;
  const barH = 9;
  const height = rows.length * rowH;
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;

  const parts: string[] = [
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, system-ui, sans-serif">`,
  ];

  rows.forEach((r, i) => {
    const top = i * rowH;
    const w = Math.max(2, (r.value / max) * width);
    parts.push(
      `<text x="0" y="${top + 12}" font-size="11" font-weight="600" fill="${labelColor}">${esc(
        truncate(r.label, 62),
      )}</text>`,
      `<text x="${width}" y="${top + 12}" text-anchor="end" font-size="11" font-weight="700" fill="${labelColor}">${esc(
        format(r.value),
      )}</text>`,
      `<rect x="0" y="${top + 20}" width="${width}" height="${barH}" rx="4.5" fill="${trackColor}"/>`,
      `<rect x="0" y="${top + 20}" width="${w.toFixed(1)}" height="${barH}" rx="4.5" fill="${barColor}"/>`,
    );
    if (r.note) {
      parts.push(
        `<text x="${width}" y="${top + 37}" text-anchor="end" font-size="9.5" fill="${noteColor}">${esc(
          r.note,
        )}</text>`,
      );
    }
  });

  parts.push('</svg>');
  return parts.join('');
}

const truncate = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** Round a max value up to a clean axis bound. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag * 1.05;
}
