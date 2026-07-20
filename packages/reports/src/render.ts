import {
  METRICS,
  formatCurrencyCompact,
  formatDelta,
  formatMetricValue,
  formatNumberCompact,
  formatPercent,
  formatRatio,
  type Currency,
  type MetricKey,
} from '@tempo/core';
import type { CampaignRow, KpiCard, VideoRow } from '@tempo/db';
import { comboChart } from './charts.js';
import type { ReportModel } from './model.js';
import type { ReportCopy } from './i18n.js';
import type { Priority, Recommendation } from './insights.js';

/**
 * Render a ReportModel into a single self-contained HTML document, optimized
 * for A4 print / PDF. All styles are inline in a <style> block and all charts
 * are inline SVG, so the output needs no network, no fonts, and no JS — it
 * renders identically in headless Chromium as in a browser. All copy comes
 * from the model's locale pack (`model.copy`).
 */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PAID_COLOR = '#2A78D6';
const ORGANIC_COLOR = '#1BAF7A';
const ROAS_COLOR = '#C98500';
const ENG_COLOR = '#4A3AA7';

const shortDate = (iso: string, copy: ReportCopy): string => {
  const [, m, d] = iso.split('-').map(Number);
  return `${copy.months[(m ?? 1) - 1]} ${d}`;
};

export function renderReportHtml(model: ReportModel): string {
  const { client, dashboard: d, insights, copy } = model;
  const cur = client.currency as Currency;
  const brand = client.brandColor ?? '#0FA79A';
  const s = copy.sections;

  return `<!doctype html>
<html lang="${copy.locale}">
<head>
<meta charset="utf-8"/>
<title>${esc(client.name)} — ${esc(copy.reportSubtitle)}</title>
<style>${styles(brand)}</style>
</head>
<body>
  ${cover(model, brand)}

  <section class="sheet">
    ${sectionTitle('01', s.summary)}
    <p class="lede">${esc(insights.headline)}</p>
    ${kpiGrid(d.paidKpis, d.organicKpis, cur, d.hasPaid, d.hasOrganic, copy)}
    ${bullets(insights.executiveSummary)}
    ${d.hasPaid ? chartCard(copy.chart.paidTitle, paidChart(d.timeseries, cur, copy), legend([[copy.chart.spend, PAID_COLOR, 'bar'], [copy.chart.roas, ROAS_COLOR, 'line']])) : ''}
  </section>

  ${d.hasPaid ? `<section class="sheet">
    ${sectionTitle('02', s.paid)}
    ${bullets(insights.paidNarrative)}
    ${campaignTable(d.campaigns, cur, copy)}
  </section>` : ''}

  ${d.hasOrganic ? `<section class="sheet">
    ${sectionTitle('03', s.organic)}
    ${bullets(insights.organicNarrative)}
    ${chartCard(copy.chart.organicTitle, organicChart(d.timeseries, copy), legend([[copy.chart.views, ORGANIC_COLOR, 'bar'], [copy.chart.engRate, ENG_COLOR, 'line']]))}
    ${videoTable(d.topVideos, copy)}
  </section>` : ''}

  ${insights.contentHighlights.length ? `<section class="sheet">
    ${sectionTitle('04', s.creative)}
    <p class="muted">${esc(copy.creativeSubtitle)}</p>
    ${highlightList(insights.contentHighlights)}
  </section>` : ''}

  <section class="sheet">
    ${sectionTitle('05', s.risks)}
    ${recommendations(insights.recommendations, copy)}
  </section>

  <section class="sheet">
    ${sectionTitle('06', s.outlook)}
    ${bullets(insights.outlook)}
    <div class="confidence">
      <span class="conf-label">${esc(copy.confidenceLabel)}</span>
      <span class="conf-pill conf-${insights.confidence.toLowerCase()}">${esc(copy.confidence[insights.confidence])}</span>
      <span class="muted small">${esc(copy.basedOn(d.timeseries.length, copy.surfacesJoin(d.hasPaid, d.hasOrganic)))}</span>
    </div>
  </section>
</body>
</html>`;
}

// --- Cover ------------------------------------------------------------------

function cover(model: ReportModel, brand: string): string {
  const { client, copy } = model;
  return `<header class="cover">
    <div class="cover-bar" style="background:${brand}"></div>
    <div class="cover-body">
      <div class="brandline">
        <span class="logo-dot" style="background:${brand}"></span>
        <span class="logo-text">Tempo <span class="logo-sub">Insight Engine</span></span>
      </div>
      <div class="cover-avatar" style="background:${brand}">${esc(client.name.charAt(0))}</div>
      <h1 class="cover-title">${esc(client.name)}</h1>
      <p class="cover-subtitle">${esc(copy.reportSubtitle)}</p>
      <div class="cover-meta">
        <div><span class="meta-k">${esc(copy.cover.period)}</span><span class="meta-v">${esc(model.periodLabel)}</span></div>
        <div><span class="meta-k">${esc(copy.cover.preparedFor)}</span><span class="meta-v">${esc(client.name)}</span></div>
        <div><span class="meta-k">${esc(model.generatedLabel)}</span></div>
      </div>
    </div>
  </header>`;
}

// --- Building blocks --------------------------------------------------------

function sectionTitle(num: string, title: string): string {
  return `<div class="section-head"><span class="section-num">${num}</span><h2>${esc(title)}</h2></div>`;
}

function bullets(items: string[]): string {
  if (!items.length) return '';
  return `<ul class="bullets">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

function deltaHtml(card: KpiCard): string {
  if (card.delta === null) return `<span class="delta neutral">—</span>`;
  const rising = card.delta > 0;
  const flat = Math.abs(card.delta) < 0.0005;
  const favorable =
    flat || card.goodDirection === 'neutral' ? 'neutral' : rising === (card.goodDirection === 'up') ? 'good' : 'bad';
  const arrow = flat ? '→' : rising ? '▲' : '▼';
  return `<span class="delta ${favorable}">${arrow} ${esc(formatDelta(card.delta))}</span>`;
}

function kpiGrid(
  paid: KpiCard[],
  organic: KpiCard[],
  cur: Currency,
  hasPaid: boolean,
  hasOrganic: boolean,
  copy: ReportCopy,
): string {
  const card = (c: KpiCard, color: string) => {
    const def = METRICS[c.key as MetricKey];
    const label = copy.metricLabel[c.key as MetricKey] ?? def.shortLabel;
    return `<div class="kpi">
      <div class="kpi-top"><span class="pip" style="background:${color}"></span><span class="kpi-label">${esc(label)}</span></div>
      <div class="kpi-value">${esc(formatMetricValue(def, c.value, { currency: cur, compact: true }))}</div>
      ${deltaHtml(c)}
    </div>`;
  };
  const groups: string[] = [];
  if (hasPaid) groups.push(`<div class="kpi-group">${paid.map((c) => card(c, PAID_COLOR)).join('')}</div>`);
  if (hasOrganic) groups.push(`<div class="kpi-group">${organic.map((c) => card(c, ORGANIC_COLOR)).join('')}</div>`);
  return `<div class="kpi-grid">${groups.join('')}</div>`;
}

function chartCard(title: string, svg: string, legendHtml: string): string {
  return `<figure class="chart-card">
    <figcaption class="chart-head"><span>${esc(title)}</span>${legendHtml}</figcaption>
    <div class="chart-body">${svg}</div>
  </figure>`;
}

function legend(items: Array<[string, string, 'bar' | 'line']>): string {
  return `<span class="legend">${items
    .map(
      ([label, color, shape]) =>
        `<span class="lg"><span class="lg-mark lg-${shape}" style="background:${color}"></span>${esc(label)}</span>`,
    )
    .join('')}</span>`;
}

function paidChart(ts: ReportModel['dashboard']['timeseries'], cur: Currency, copy: ReportCopy): string {
  return comboChart(
    ts.map((t) => ({ label: shortDate(t.date, copy), bar: t.spend, line: t.roas })),
    {
      barColor: PAID_COLOR,
      lineColor: ROAS_COLOR,
      formatBar: (v) => formatCurrencyCompact(v, cur),
      formatLine: (v) => formatRatio(v, 1),
    },
  );
}

function organicChart(ts: ReportModel['dashboard']['timeseries'], copy: ReportCopy): string {
  return comboChart(
    ts.map((t) => ({ label: shortDate(t.date, copy), bar: t.views, line: t.engagementRate })),
    {
      barColor: ORGANIC_COLOR,
      lineColor: ENG_COLOR,
      formatBar: (v) => formatNumberCompact(v),
      formatLine: (v) => formatPercent(v, 0),
    },
  );
}

function campaignTable(rows: CampaignRow[], cur: Currency, copy: ReportCopy): string {
  const t = copy.table;
  const body = rows
    .map(
      (r) => `<tr>
      <td class="t-name"><span class="dot ${r.status}"></span>${esc(r.name)}<span class="obj">${esc(copy.objective[r.objective] ?? r.objective)}</span></td>
      <td class="num">${esc(formatCurrencyCompact(r.spend, cur))}</td>
      <td class="num">${esc(formatPercent(r.ctr, 2))}</td>
      <td class="num">${r.conversions.toLocaleString('en-US')}</td>
      <td class="num">${r.cpa > 0 ? esc(formatCurrencyCompact(r.cpa, cur)) : '—'}</td>
      <td class="num strong">${r.roas > 0 ? esc(formatRatio(r.roas)) : '—'}</td>
    </tr>`,
    )
    .join('');
  return `<table class="data"><thead><tr>
    <th>${esc(t.campaign)}</th><th class="num">${esc(t.spend)}</th><th class="num">${esc(t.ctr)}</th><th class="num">${esc(t.conv)}</th><th class="num">${esc(t.cpa)}</th><th class="num">${esc(t.roas)}</th>
  </tr></thead><tbody>${body}</tbody></table>`;
}

function videoTable(rows: VideoRow[], copy: ReportCopy): string {
  const t = copy.table;
  const body = rows
    .slice(0, 8)
    .map(
      (r, i) => `<tr>
      <td class="rank">${i + 1}</td>
      <td class="t-name">${esc(r.caption)}</td>
      <td class="num">${esc(formatNumberCompact(r.views))}</td>
      <td class="num">${esc(formatPercent(r.engagementRate, 1))}</td>
      <td class="num">${r.avgWatchTimeSec.toFixed(1)}s</td>
      <td class="num">${esc(formatNumberCompact(r.shares))}</td>
    </tr>`,
    )
    .join('');
  return `<table class="data"><thead><tr>
    <th class="rank">#</th><th>${esc(t.content)}</th><th class="num">${esc(t.views)}</th><th class="num">${esc(t.eng)}</th><th class="num">${esc(t.watch)}</th><th class="num">${esc(t.shares)}</th>
  </tr></thead><tbody>${body}</tbody></table>`;
}

function highlightList(items: string[]): string {
  return `<ol class="highlights">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`;
}

function recommendations(recs: Recommendation[], copy: ReportCopy): string {
  if (!recs.length) return `<p class="muted">${esc(copy.noRisks)}</p>`;
  const order: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  return `<div class="recs">${[...recs]
    .sort((a, b) => order[a.priority] - order[b.priority])
    .map(
      (r) => `<div class="rec">
      <span class="rec-pri rec-${r.priority}">${esc(copy.priority[r.priority])}</span>
      <div class="rec-body"><div class="rec-title">${esc(r.title)}</div><div class="rec-detail">${esc(r.detail)}</div></div>
    </div>`,
    )
    .join('')}</div>`;
}

// --- Styles -----------------------------------------------------------------

function styles(brand: string): string {
  return `
  * { margin:0; padding:0; box-sizing:border-box; }
  :root { --brand:${brand}; --ink:#0D0F12; --ink-2:#414954; --ink-3:#6B7280; --line:#E5E8EC; --line-2:#EEF0F3; --bg:#fff; --subtle:#F7F8FA; }
  html { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { font-family:'Inter','Helvetica Neue',Arial,system-ui,sans-serif; color:var(--ink); background:var(--bg); font-size:12px; line-height:1.55; }
  .sheet { padding:34px 46px; page-break-before:always; }
  .muted { color:var(--ink-3); }
  .small { font-size:10.5px; }

  .cover { position:relative; height:96vh; page-break-after:always; padding:0; }
  .cover-bar { position:absolute; top:0; left:0; right:0; height:10px; }
  .cover-body { padding:120px 56px 0; }
  .brandline { display:flex; align-items:center; gap:8px; margin-bottom:96px; }
  .logo-dot { width:16px; height:16px; border-radius:5px; display:inline-block; }
  .logo-text { font-weight:700; font-size:15px; letter-spacing:-0.01em; }
  .logo-sub { color:var(--ink-3); font-weight:600; }
  .cover-avatar { width:64px; height:64px; border-radius:16px; color:#fff; font-weight:700; font-size:30px; display:flex; align-items:center; justify-content:center; margin-bottom:22px; }
  .cover-title { font-size:44px; line-height:1.05; letter-spacing:-0.025em; font-weight:750; }
  .cover-subtitle { font-size:19px; color:var(--ink-2); margin-top:8px; font-weight:500; }
  .cover-meta { margin-top:60px; border-top:1px solid var(--line); padding-top:22px; display:flex; flex-direction:column; gap:12px; max-width:460px; }
  .cover-meta > div { display:flex; justify-content:space-between; gap:16px; }
  .meta-k { color:var(--ink-3); }
  .meta-v { font-weight:600; color:var(--ink); text-align:right; }

  .section-head { display:flex; align-items:baseline; gap:12px; border-bottom:2px solid var(--ink); padding-bottom:8px; margin-bottom:16px; }
  .section-num { font-size:12px; font-weight:700; color:var(--brand); letter-spacing:0.06em; }
  .section-head h2 { font-size:20px; letter-spacing:-0.02em; font-weight:700; }
  .lede { font-size:14px; line-height:1.6; color:var(--ink); margin-bottom:18px; font-weight:500; }

  .kpi-grid { display:flex; flex-direction:column; gap:10px; margin-bottom:16px; }
  .kpi-group { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
  .kpi { border:1px solid var(--line); border-radius:9px; padding:11px 12px; background:var(--subtle); }
  .kpi-top { display:flex; align-items:center; gap:6px; }
  .pip { width:7px; height:7px; border-radius:50%; display:inline-block; }
  .kpi-label { font-size:9.5px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-3); font-weight:600; }
  .kpi-value { font-size:22px; font-weight:700; letter-spacing:-0.02em; margin:5px 0 3px; font-variant-numeric:tabular-nums; }
  .delta { font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; }
  .delta.good { color:#128A4E; } .delta.bad { color:#DC2626; } .delta.neutral { color:var(--ink-3); }

  .bullets { list-style:none; margin:0 0 16px; display:flex; flex-direction:column; gap:8px; }
  .bullets li { position:relative; padding-left:16px; color:var(--ink-2); line-height:1.55; }
  .bullets li::before { content:''; position:absolute; left:2px; top:7px; width:5px; height:5px; border-radius:50%; background:var(--brand); }

  .chart-card { border:1px solid var(--line); border-radius:11px; overflow:hidden; margin-bottom:6px; }
  .chart-head { display:flex; justify-content:space-between; align-items:center; padding:11px 14px; border-bottom:1px solid var(--line-2); font-weight:600; font-size:12.5px; }
  .chart-body { padding:12px 10px 6px; }
  .chart-body svg { width:100%; height:auto; display:block; }
  .legend { display:flex; gap:14px; font-weight:500; color:var(--ink-3); font-size:11px; }
  .lg { display:flex; align-items:center; gap:5px; }
  .lg-mark { width:12px; height:4px; border-radius:2px; display:inline-block; }
  .lg-bar { height:9px; width:9px; border-radius:2px; }

  table.data { width:100%; border-collapse:collapse; font-size:11px; margin-top:6px; }
  table.data thead th { text-align:left; font-weight:600; color:var(--ink-3); font-size:10px; text-transform:uppercase; letter-spacing:0.04em; padding:7px 8px; border-bottom:1.5px solid var(--line); }
  table.data td { padding:8px; border-bottom:1px solid var(--line-2); vertical-align:middle; }
  table.data td.num, table.data th.num { text-align:right; font-variant-numeric:tabular-nums; }
  table.data td.strong { font-weight:700; }
  table.data td.rank, th.rank { width:22px; color:var(--ink-3); text-align:center; }
  .t-name { font-weight:500; color:var(--ink); }
  .obj { display:inline-block; margin-left:8px; font-size:9px; font-weight:600; color:var(--ink-3); background:var(--subtle); border:1px solid var(--line); padding:1px 6px; border-radius:20px; text-transform:uppercase; letter-spacing:0.03em; }
  .dot { display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:7px; }
  .dot.active { background:#128A4E; } .dot.paused { background:#B4700A; } .dot.deleted, .dot.pending { background:#9AA1AB; }

  .highlights { padding-left:20px; display:flex; flex-direction:column; gap:9px; color:var(--ink-2); }
  .highlights li { padding-left:4px; }

  .recs { display:flex; flex-direction:column; gap:10px; }
  .rec { display:flex; gap:12px; border:1px solid var(--line); border-left-width:3px; border-radius:9px; padding:12px 14px; }
  .rec-high { border-left-color:#DC2626; } .rec-medium { border-left-color:#C98500; } .rec-low { border-left-color:#2A78D6; }
  .rec-pri { align-self:flex-start; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; padding:3px 8px; border-radius:20px; color:#fff; white-space:nowrap; }
  .rec-pri.rec-high { background:#DC2626; } .rec-pri.rec-medium { background:#C98500; } .rec-pri.rec-low { background:#2A78D6; }
  .rec-title { font-weight:700; margin-bottom:2px; }
  .rec-detail { color:var(--ink-2); }

  .confidence { display:flex; align-items:center; gap:12px; margin-top:16px; padding-top:16px; border-top:1px solid var(--line); flex-wrap:wrap; }
  .conf-label { font-weight:600; }
  .conf-pill { font-weight:700; padding:3px 12px; border-radius:20px; font-size:11px; }
  .conf-high { background:#DCF5E8; color:#128A4E; } .conf-medium { background:#FDF0D9; color:#B4700A; } .conf-low { background:#FBE3E3; color:#DC2626; }
  `;
}
