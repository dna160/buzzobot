import { esc } from '../template-report/html.js';
import { compact, dec, idDate, idShortDate, idrCompact, pct } from './format.js';
import type { ContentMixModel, FunnelBarModel, RankChartModel, SpendChartModel } from './model.js';

/**
 * Inline SVG for the Strategy Report, built server-side from engine-exported
 * series (no client JS, prints identically to PDF). Colours come from the
 * stylesheet's CSS variables so the charts follow the report's palette.
 */

const W = 640;

export function funnelChart(bars: FunnelBarModel[]): string {
  const rowH = 56;
  const H = bars.length * rowH + 8;
  const label = 150;
  const span = W - label - 90;
  const rows = bars
    .map((b, i) => {
      const y = i * rowH + 6;
      const max = Math.max(b.total ?? 0, b.benchTotal ?? 0) || 1;
      const bw = ((b.total ?? 0) / max) * span;
      const kw = ((b.benchTotal ?? 0) / max) * span;
      return (
        `<text x="0" y="${y + 14}" class="c-lab">${esc(b.stage)}</text>` +
        `<text x="0" y="${y + 30}" class="c-sub">${esc(b.rankLabel)}</text>` +
        `<rect x="${label}" y="${y + 2}" width="${bw.toFixed(1)}" height="16" rx="2" class="c-brand"/>` +
        `<text x="${label + bw + 6}" y="${y + 15}" class="c-val">${esc(compact(b.total))}</text>` +
        `<rect x="${label}" y="${y + 22}" width="${kw.toFixed(1)}" height="10" rx="2" class="c-bench"/>` +
        `<text x="${label + kw + 6}" y="${y + 31}" class="c-sub">Top 10: ${esc(compact(b.benchTotal))}</text>`
      );
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Ukuran tiap tahap funnel dibanding rata-rata Top 10">${rows}</svg>`;
}

export function spendChart(c: SpendChartModel): string {
  const H = 240;
  const pad = { l: 56, r: 16, t: 14, b: 34 };
  const xs = c.points.map((p) => p.spend);
  const ys = c.points.map((p) => p.new);
  const xMax = Math.max(...xs) * 1.05;
  const yMax = Math.max(...ys, c.fit ? c.fit.a : 0) * 1.1 || 1;
  const X = (v: number) => pad.l + (v / xMax) * (W - pad.l - pad.r);
  const Y = (v: number) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
  const dots = c.points.map((p) => `<circle cx="${X(p.spend).toFixed(1)}" cy="${Y(p.new).toFixed(1)}" r="3.2" class="c-dot"/>`).join('');
  let curve = '';
  if (c.fit && c.fit.r2 >= 0.3) {
    const pts: string[] = [];
    for (let i = 0; i <= 40; i++) {
      const s = (xMax * i) / 40;
      pts.push(`${X(s).toFixed(1)},${Y(c.fit.a * (1 - Math.exp(-s / c.fit.b))).toFixed(1)}`);
    }
    curve = `<polyline points="${pts.join(' ')}" class="c-fit"/>`;
  }
  const knee =
    c.showKnee && c.fit
      ? `<line x1="${X(c.fit.knee).toFixed(1)}" x2="${X(c.fit.knee).toFixed(1)}" y1="${pad.t}" y2="${H - pad.b}" class="c-knee"/>` +
        `<text x="${(X(c.fit.knee) + 4).toFixed(1)}" y="${pad.t + 10}" class="c-kneel">Batas ${esc(idrCompact(c.fit.knee))}/hari</text>`
      : '';
  const ticksX = [0.25, 0.5, 0.75, 1]
    .map((f) => `<text x="${X(xMax * f).toFixed(1)}" y="${H - pad.b + 16}" class="c-sub" text-anchor="${f === 1 ? 'end' : 'middle'}">${esc(idrCompact(xMax * f))}</text>`)
    .join('');
  const ticksY = [0.5, 1]
    .map((f) => `<text x="${pad.l - 6}" y="${(Y(yMax * f) + 4).toFixed(1)}" class="c-sub" text-anchor="end">${esc(compact(yMax * f))}</text>`)
    .join('');
  const r2 = c.fit ? `R² ${dec(c.fit.r2, 2)}` : 'tanpa kurva';
  return (
    `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Belanja harian dibanding audiens baru ${esc(c.stageLabel)} ${c.lagDays} hari kemudian">` +
    `<line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" class="c-axis"/>` +
    `<line x1="${pad.l}" x2="${pad.l}" y1="${pad.t}" y2="${H - pad.b}" class="c-axis"/>` +
    dots + curve + knee + ticksX + ticksY +
    `<text x="${W - pad.r}" y="${pad.t + 10}" class="c-sub" text-anchor="end">${esc(r2)} · ${c.points.length} hari</text>` +
    `<text x="${(W + pad.l) / 2}" y="${H - 4}" class="c-sub" text-anchor="middle">Belanja per hari → audiens baru ${esc(c.stageLabel)} ${c.lagDays} hari kemudian</text>` +
    `</svg>`
  );
}

export function rankChart(c: RankChartModel): string {
  const H = 220;
  const pad = { l: 40, r: 70, t: 12, b: 28 };
  const ranks = c.weekly.map((w) => w.rank).concat([c.target ?? 0, c.projectedHigh ?? 0, c.projectedLow ?? 0].filter((v) => v > 0));
  const lo = Math.max(1, Math.min(...ranks) - 3);
  const hi = Math.max(...ranks) + 3;
  const t0 = Date.parse(c.weekly[0]!.date);
  const tEnd = c.deadline ? Math.max(Date.parse(c.deadline), Date.parse(c.weekly[c.weekly.length - 1]!.date)) : Date.parse(c.weekly[c.weekly.length - 1]!.date);
  const X = (iso: string) => pad.l + ((Date.parse(iso) - t0) / Math.max(1, tEnd - t0)) * (W - pad.l - pad.r);
  // Rank 1 is best: drawn at the top.
  const Y = (r: number) => pad.t + ((r - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
  const line = c.weekly.map((w) => `${X(w.date).toFixed(1)},${Y(w.rank).toFixed(1)}`).join(' ');
  const last = c.weekly[c.weekly.length - 1]!;
  let extra = '';
  if (c.target != null) {
    extra += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(c.target).toFixed(1)}" y2="${Y(c.target).toFixed(1)}" class="c-target"/>`;
    extra += `<text x="${W - pad.r + 4}" y="${(Y(c.target) + 4).toFixed(1)}" class="c-sub">Target #${c.target}</text>`;
  }
  if (c.deadline && c.projected != null) {
    extra += `<line x1="${X(last.date).toFixed(1)}" y1="${Y(last.rank).toFixed(1)}" x2="${X(c.deadline).toFixed(1)}" y2="${Y(c.projected).toFixed(1)}" class="c-proj"/>`;
    if (c.projectedLow != null && c.projectedHigh != null) {
      extra += `<line x1="${X(c.deadline).toFixed(1)}" x2="${X(c.deadline).toFixed(1)}" y1="${Y(c.projectedLow).toFixed(1)}" y2="${Y(c.projectedHigh).toFixed(1)}" class="c-range"/>`;
    }
    extra += `<text x="${(X(c.deadline) + 4).toFixed(1)}" y="${(Y(c.projected) - 4).toFixed(1)}" class="c-sub">#${Math.round(c.projected)} (proyeksi)</text>`;
  }
  const ticks = [lo, Math.round((lo + hi) / 2), hi]
    .map((r) => `<text x="${pad.l - 6}" y="${(Y(r) + 4).toFixed(1)}" class="c-sub" text-anchor="end">#${r}</text>`)
    .join('');
  const xt = [c.weekly[0]!.date, last.date, ...(c.deadline ? [c.deadline] : [])]
    .map((d) => `<text x="${X(d).toFixed(1)}" y="${H - 8}" class="c-sub" text-anchor="middle">${esc(idShortDate(d))}</text>`)
    .join('');
  return (
    `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Peringkat ${esc(c.stageLabel)} per minggu">` +
    `<polyline points="${line}" class="c-line"/>` +
    c.weekly.map((w) => `<circle cx="${X(w.date).toFixed(1)}" cy="${Y(w.rank).toFixed(1)}" r="2.6" class="c-dot"/>`).join('') +
    extra + ticks + xt +
    `<text x="${W - pad.r}" y="${pad.t + 2}" class="c-sub" text-anchor="end">${esc(c.stageLabel)}${c.listSize ? ` · dari ${c.listSize} merek` : ''} · data s.d. ${esc(idDate(last.date))}</text>` +
    `</svg>`
  );
}

export function mixChart(m: ContentMixModel): string {
  const top = 46;
  const rowH = 26;
  const H = top + m.subtypes.length * rowH + 8;
  const label = 230;
  // Leave room on the right for "12,3% · Top 10 45,6%" after the longer of bar and tick.
  const span = W - label - 170;
  const paidW = m.paid * (W - 2);
  const stacked =
    `<rect x="1" y="6" width="${paidW.toFixed(1)}" height="20" class="c-brand"/>` +
    `<rect x="${(1 + paidW).toFixed(1)}" y="6" width="${(m.nonPaid * (W - 2)).toFixed(1)}" height="20" class="c-earned"/>` +
    `<text x="6" y="20" class="c-inbar">Berbayar ${esc(pct(m.paid))}</text>` +
    `<text x="${W - 6}" y="40" class="c-sub" text-anchor="end">Non-berbayar ${esc(pct(m.nonPaid))}</text>`;
  const max = Math.max(...m.subtypes.map((s) => Math.max(s.share, s.benchShare ?? 0)), 0.01);
  const rows = m.subtypes
    .map((s, i) => {
      const y = top + i * rowH;
      const w = (Math.min(s.share, max) / max) * span;
      const tickX = s.benchShare != null ? (s.benchShare / max) * span : 0;
      const bench =
        s.benchShare != null
          ? `<line x1="${(label + (s.benchShare / max) * span).toFixed(1)}" x2="${(label + (s.benchShare / max) * span).toFixed(1)}" y1="${y}" y2="${y + 16}" class="c-tick"/>`
          : '';
      return (
        `<text x="0" y="${y + 12}" class="c-lab">${esc(s.label)}</text>` +
        `<rect x="${label}" y="${y + 2}" width="${w.toFixed(1)}" height="12" rx="2" class="c-sub-bar"/>${bench}` +
        `<text x="${(label + Math.max(w, tickX) + 8).toFixed(1)}" y="${y + 12}" class="c-val">${esc(pct(s.share))}${s.benchShare != null ? ` · Top 10 ${esc(pct(s.benchShare))}` : ''}</text>`
      );
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Komposisi impresi konten yang menyebut merek">${stacked}${rows}</svg>`;
}
