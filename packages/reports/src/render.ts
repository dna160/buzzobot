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
import {
  ENG_COLOR,
  ORGANIC_COLOR,
  PAID_COLOR,
  ROAS_COLOR,
  bullets,
  chartCard,
  cover as coverBlock,
  esc,
  legend,
  sectionTitle,
  shortDate,
  styles,
} from './layout.js';

/**
 * Render a ReportModel into a single self-contained HTML document, optimized
 * for A4 print / PDF. All styles are inline in a <style> block and all charts
 * are inline SVG, so the output needs no network, no fonts, and no JS — it
 * renders identically in headless Chromium as in a browser. All copy comes
 * from the model's locale pack (`model.copy`).
 */


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
  ${coverBlock({
    clientName: client.name,
    subtitle: copy.reportSubtitle,
    periodKey: copy.cover.period,
    periodValue: model.periodLabel,
    preparedForKey: copy.cover.preparedFor,
    generatedLabel: model.generatedLabel,
    brand,
  })}

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


// --- Building blocks --------------------------------------------------------



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
