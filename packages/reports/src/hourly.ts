/**
 * The intraday (hourly) report.
 *
 * M7 deleted the old hourly document along with the rest of the pre-deck
 * renderer, on the grounds that the Brief Deck replaced all three client
 * documents. It replaced the *day-grain* ones: nothing in the deck reads
 * `paid_hourly_metrics`, so a premium client's intraday telemetry — the thing
 * its `*_daily_performance` ingestion exists to produce — had no document at
 * all. This is that document, and only that: it renders `HourlyDashboardData`
 * and reads nothing else, the same boundary `renderDeckHtml` keeps.
 *
 * There is no engine call here. Every figure is the read-model's own, already
 * derived from summed totals (never averaged across hours), so this report
 * cannot disagree with the hour-by-hour dashboard it mirrors.
 */

import {
  formatCurrencyCompact,
  formatDelta,
  formatNumberCompact,
  formatPercent,
  NorthStar,
} from '@tempo/core';
import type { Currency } from '@tempo/core';
import type { ClientSummary, HourlyDashboardData, HourPoint, Totals } from '@tempo/db';
import { comboChart } from './charts.js';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const hhmm = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

/** `null` is "not derivable", never 0 — the read-model is careful about this and so is the page. */
const orDash = (v: string | null | undefined): string => (v === null || v === undefined ? '—' : v);

const pct = (v: number | null): string | null => (v === null ? null : formatPercent(v));

/**
 * Which secondary series rides the chart's right axis, and which KPIs lead.
 * A VTR client's report opening with CPA would bury its own headline.
 */
interface Lens {
  /** Right-axis series on the hour-by-hour chart, and the last table column. */
  primaryLabel: string;
  /**
   * The chart's line value for one hour. `comboChart` plots numbers, so a null
   * has to become something: it becomes 0, which is honest here because every
   * metric the lenses use goes null for exactly one reason — the hour had no
   * delivery (`roas` null when spend is 0, `vtr6s` null when impressions are
   * 0, `cpa` null when conversions are 0). Those hours also have a zero bar,
   * so the pair reads as "nothing happened", not "the rate collapsed". The
   * *table* never does this — see `primaryCell`, which prints an em dash.
   */
  pickHour: (h: HourPoint) => number;
  formatPrimary: (v: number) => string;
  /** The same figure as a display string, honouring null-vs-zero. */
  primaryCell: (t: Totals | HourPoint) => string;
  /** KPI tiles after the always-present spend/impressions pair. */
  tiles: Array<{ label: string; pick: (t: Totals) => string }>;
}

function lensFor(client: ClientSummary): Lens {
  const cur = client.currency as Currency;
  const money = (v: number): string => formatCurrencyCompact(v, cur);

  if (client.northStar === NorthStar.Vtr) {
    return {
      primaryLabel: 'VTR 6s',
      pickHour: (h) => (h.vtr6s ?? 0) * 100,
      formatPrimary: (v) => `${v.toFixed(1)}%`,
      primaryCell: (t) => orDash(pct(t.vtr6s)),
      tiles: [
        { label: 'Reach', pick: (t) => formatNumberCompact(t.reach) },
        { label: 'VTR 6s', pick: (t) => orDash(pct(t.vtr6s)) },
        { label: 'VTR 15s', pick: (t) => orDash(pct(t.vtr15s)) },
        { label: 'Frequency', pick: (t) => orDash(t.frequency === null ? null : t.frequency.toFixed(2)) },
        { label: 'CPM', pick: (t) => orDash(t.cpm === null ? null : money(t.cpm)) },
        { label: 'Video Views', pick: (t) => formatNumberCompact(t.videoViews) },
      ],
    };
  }

  if (client.northStar === NorthStar.AppInstall) {
    return {
      primaryLabel: 'CPI',
      pickHour: (h) => h.cpa ?? 0,
      formatPrimary: money,
      primaryCell: (t) => orDash(t.cpa === null ? null : money(t.cpa)),
      tiles: [
        { label: 'Installs', pick: (t) => formatNumberCompact(t.conversions) },
        { label: 'CPI', pick: (t) => orDash(t.cpa === null ? null : money(t.cpa)) },
        { label: 'CTR', pick: (t) => orDash(pct(t.ctr)) },
        { label: 'CPC', pick: (t) => orDash(t.cpc === null ? null : money(t.cpc)) },
        { label: 'Clicks', pick: (t) => formatNumberCompact(t.clicks) },
        { label: 'Reach', pick: (t) => formatNumberCompact(t.reach) },
      ],
    };
  }

  return {
    primaryLabel: 'ROAS',
    pickHour: (h) => h.roas ?? 0,
    formatPrimary: (v) => `${v.toFixed(2)}x`,
    primaryCell: (t) => orDash(t.roas === null ? null : `${t.roas.toFixed(2)}x`),
    tiles: [
      { label: 'Orders', pick: (t) => formatNumberCompact(t.conversions) },
      { label: 'GMV', pick: (t) => money(t.conversionValue) },
      { label: 'ROAS', pick: (t) => orDash(t.roas === null ? null : `${t.roas.toFixed(2)}x`) },
      { label: 'CPA', pick: (t) => orDash(t.cpa === null ? null : money(t.cpa)) },
      { label: 'CTR', pick: (t) => orDash(pct(t.ctr)) },
      { label: 'Clicks', pick: (t) => formatNumberCompact(t.clicks) },
    ],
  };
}

/**
 * Peak and trough over *true* hours only. The read-model already excludes
 * `spanHours > 1` buckets from `hours`, so this cannot accidentally crown the
 * since-midnight bucket the day's busiest hour.
 */
function extremes(hours: HourPoint[]): { peak: HourPoint | null; quiet: HourPoint | null } {
  const spending = hours.filter((h) => h.spend > 0);
  if (spending.length === 0) return { peak: null, quiet: null };
  let peak = spending[0]!;
  let quiet = spending[0]!;
  for (const h of spending) {
    if (h.spend > peak.spend) peak = h;
    if (h.spend < quiet.spend) quiet = h;
  }
  return { peak, quiet };
}

function styles(brandColor: string): string {
  return `
  @page { size: A4; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Inter, "Helvetica Neue", Arial, sans-serif;
    font-size: 10px;
    line-height: 1.45;
    color: #1F2430;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1, h2 { margin: 0; font-weight: 650; }
  h1 { font-size: 19px; letter-spacing: -0.01em; }
  h2 { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #6B7280; }
  section { margin-top: 18px; break-inside: avoid; }
  .head { display: flex; align-items: flex-start; justify-content: space-between;
          gap: 16px; border-bottom: 3px solid ${brandColor}; padding-bottom: 10px; }
  .head .meta { text-align: right; font-size: 9px; color: #6B7280; }
  .sub { margin-top: 3px; font-size: 11px; color: #6B7280; }
  .note { margin-top: 8px; padding: 7px 9px; border-radius: 5px;
          background: #FFF7ED; border: 1px solid #FED7AA; color: #9A3412; font-size: 9px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-top: 10px; }
  .kpi { border: 1px solid #E5E8EC; border-radius: 6px; padding: 8px 9px; }
  .kpi .label { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #6B7280; }
  .kpi .value { font-size: 15px; font-weight: 650; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .kpi .delta { font-size: 9px; margin-top: 1px; font-variant-numeric: tabular-nums; display: block; }
  .up { color: #199E70; } .down { color: #D24B4B; } .flat { color: #6B7280; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-variant-numeric: tabular-nums; }
  th, td { padding: 4px 6px; text-align: right; border-bottom: 1px solid #EDF0F3; }
  th { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.04em; color: #6B7280;
       border-bottom: 1px solid #C9CED6; font-weight: 600; }
  th:first-child, td:first-child { text-align: left; }
  tbody tr:nth-child(even) { background: #FAFBFC; }
  tfoot td { font-weight: 650; border-top: 1px solid #C9CED6; border-bottom: none; }
  .peak td { background: ${brandColor}1A; }
  .chart { margin-top: 8px; }
  .foot { margin-top: 22px; padding-top: 8px; border-top: 1px solid #E5E8EC;
          font-size: 8px; color: #9AA1AC; display: flex; justify-content: space-between; }
  `;
}

function deltaCell(fraction: number | null): string {
  if (fraction === null) return '<span class="delta flat">—</span>';
  const cls = fraction > 0.0005 ? 'up' : fraction < -0.0005 ? 'down' : 'flat';
  return `<span class="delta ${cls}">${esc(formatDelta(fraction))} vs prev</span>`;
}

export interface HourlyReportOptions {
  /** Stamped in the footer so a report under discussion can be dated. */
  generatedAt?: Date;
}

/**
 * Render one client's intraday report for one date as standalone A4 HTML.
 *
 * Self-contained: inline styles, inline SVG, no network assets — so headless
 * Chromium renders it identically to the browser preview the portal shows.
 */
export function renderHourlyHtml(
  data: HourlyDashboardData,
  options: HourlyReportOptions = {},
): string {
  const client = data.client;
  const currency = client.currency as Currency;
  const brandColor = client.brandColor || '#1FD8C7';
  const lens = lensFor(client);
  const t = data.totals;
  const cmp = data.comparison;
  const { peak, quiet } = extremes(data.hours);
  const money = (v: number): string => formatCurrencyCompact(v, currency);

  const chart = comboChart(
    data.hours.map((h) => ({ label: hhmm(h.hour), bar: h.spend, line: lens.pickHour(h) })),
    {
      width: 720,
      height: 210,
      barColor: brandColor,
      lineColor: '#199E70',
      formatBar: money,
      formatLine: lens.formatPrimary,
      maxXLabels: 12,
    },
  );

  const kpis: Array<{ label: string; value: string; delta: number | null }> = [
    { label: 'Spend', value: money(t.spend), delta: cmp?.deltas.spend ?? null },
    { label: 'Impressions', value: formatNumberCompact(t.impressions), delta: cmp?.deltas.impressions ?? null },
    ...lens.tiles.map((tile) => ({ label: tile.label, value: tile.pick(t), delta: null })),
  ].slice(0, 8);

  const kpiHtml = kpis
    .map(
      (k) => `<div class="kpi">
      <div class="label">${esc(k.label)}</div>
      <div class="value">${esc(k.value)}</div>
      ${deltaCell(k.delta)}
    </div>`,
    )
    .join('');

  const hourRows = data.hours
    .map(
      (h) => `<tr${peak && h.hour === peak.hour ? ' class="peak"' : ''}>
      <td>${hhmm(h.hour)}</td>
      <td>${esc(money(h.spend))}</td>
      <td>${esc(formatNumberCompact(h.impressions))}</td>
      <td>${esc(formatNumberCompact(h.clicks))}</td>
      <td>${esc(orDash(pct(h.ctr)))}</td>
      <td>${esc(orDash(h.cpm === null ? null : money(h.cpm)))}</td>
      <td>${esc(formatNumberCompact(h.conversions))}</td>
      <td>${esc(lens.primaryCell(h))}</td>
    </tr>`,
    )
    .join('');

  const pacingRows = data.pacing
    .map((p) => {
      const gap = p.share - p.evenShare;
      const cls = gap > 0.005 ? 'up' : gap < -0.005 ? 'down' : 'flat';
      return `<tr>
      <td>${hhmm(p.hour)}</td>
      <td>${esc(money(p.cumulative))}</td>
      <td>${esc(formatPercent(p.share, 1))}</td>
      <td>${esc(formatPercent(p.evenShare, 1))}</td>
      <td class="${cls}">${esc(formatDelta(gap))}</td>
    </tr>`;
    })
    .join('');

  const campaignRows = data.campaigns
    .slice()
    .sort((a, b) => b.totals.spend - a.totals.spend)
    .map(
      (c) => `<tr>
      <td>${esc(c.name)}</td>
      <td>${esc(c.objective)}</td>
      <td>${esc(money(c.totals.spend))}</td>
      <td>${esc(formatNumberCompact(c.totals.impressions))}</td>
      <td>${esc(orDash(pct(c.totals.ctr)))}</td>
      <td>${esc(formatNumberCompact(c.totals.conversions))}</td>
      <td>${esc(orDash(c.totals.cpa === null ? null : money(c.totals.cpa)))}</td>
    </tr>`,
    )
    .join('');

  // The read-model deliberately keeps partial days honest. Say so on the page
  // rather than letting a day synced through 11:00 read as a collapse.
  const coverageNotes: string[] = [];
  if (!data.coverage.isComplete && data.coverage.lastHour !== null) {
    coverageNotes.push(
      `Data sampai ${hhmm(data.coverage.lastHour)} — hari ini masih berjalan, jadi total bersifat sementara.`,
    );
  }
  const material = data.coverage.aggregatedHours.filter((a) => a.spanHours > 2);
  if (material.length > 0) {
    coverageNotes.push(
      `${material.map((a) => `${hhmm(a.hour)} memuat ${a.spanHours} jam`).join('; ')} — ikut dihitung di total, tidak dipakai di grafik per jam maupun perbandingan.`,
    );
  }
  if (cmp) {
    coverageNotes.push(
      `Dibandingkan dengan ${cmp.date} hanya pada ${cmp.hoursMatched.length} jam yang sama-sama tersedia, bukan satu hari penuh.`,
    );
  }

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>${esc(client.name)} — Laporan Per Jam ${esc(data.date)}</title>
<style>${styles(brandColor)}</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>${esc(client.name)}</h1>
      <div class="sub">Laporan Per Jam · ${esc(data.date)}</div>
    </div>
    <div class="meta">
      TikTok Ads · ${esc(client.timezone)}<br />
      ${esc(String(currency))} · tier ${esc(String(client.tier))}<br />
      ${data.coverage.firstHour !== null ? `${hhmm(data.coverage.firstHour)}–${hhmm(data.coverage.lastHour ?? 23)}` : 'belum ada jam tercatat'}
    </div>
  </div>

  ${coverageNotes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}

  <section>
    <h2>Ringkasan Hari Ini</h2>
    <div class="kpis">${kpiHtml}</div>
  </section>

  <section>
    <h2>Spend &amp; ${esc(lens.primaryLabel)} per Jam</h2>
    <div class="chart">${chart}</div>
    ${
      peak && quiet
        ? `<div class="sub">Jam tersibuk ${hhmm(peak.hour)} (${esc(money(peak.spend))}), terendah ${hhmm(quiet.hour)} (${esc(money(quiet.spend))}).</div>`
        : '<div class="sub">Belum ada jam dengan spend pada tanggal ini.</div>'
    }
  </section>

  <section>
    <h2>Rincian Per Jam</h2>
    <table>
      <thead><tr>
        <th>Jam</th><th>Spend</th><th>Impressions</th><th>Clicks</th>
        <th>CTR</th><th>CPM</th><th>Konversi</th><th>${esc(lens.primaryLabel)}</th>
      </tr></thead>
      <tbody>${hourRows || '<tr><td colspan="8">Tidak ada data jam.</td></tr>'}</tbody>
      <tfoot><tr>
        <td>Total</td>
        <td>${esc(money(t.spend))}</td>
        <td>${esc(formatNumberCompact(t.impressions))}</td>
        <td>${esc(formatNumberCompact(t.clicks))}</td>
        <td>${esc(orDash(pct(t.ctr)))}</td>
        <td>${esc(orDash(t.cpm === null ? null : money(t.cpm)))}</td>
        <td>${esc(formatNumberCompact(t.conversions))}</td>
        <td>${esc(lens.primaryCell(t))}</td>
      </tr></tfoot>
    </table>
  </section>

  <section>
    <h2>Pacing Spend</h2>
    <table>
      <thead><tr><th>Jam</th><th>Kumulatif</th><th>Porsi Terpakai</th><th>Pace Rata</th><th>Selisih</th></tr></thead>
      <tbody>${pacingRows || '<tr><td colspan="5">Tidak ada data pacing.</td></tr>'}</tbody>
    </table>
  </section>

  <section>
    <h2>Per Campaign</h2>
    <table>
      <thead><tr><th>Campaign</th><th>Objective</th><th>Spend</th><th>Impressions</th><th>CTR</th><th>Konversi</th><th>CPA</th></tr></thead>
      <tbody>${campaignRows || '<tr><td colspan="7">Tidak ada campaign aktif.</td></tr>'}</tbody>
    </table>
  </section>

  <div class="foot">
    <span>Tempo Insight Engine · laporan per jam · angka dari read-model yang sama dengan dashboard</span>
    <span>${esc((options.generatedAt ?? new Date()).toISOString())}</span>
  </div>
</body>
</html>`;
}
