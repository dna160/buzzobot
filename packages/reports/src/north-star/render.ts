import { renderTable } from '../deck/render.js';
import {
  esc,
  renderAreaTable,
  renderLegend,
  renderRecommendations,
  renderReportHeader,
  renderRiskTable,
  renderSourceBreakdown,
  statusBadge,
  styles,
  toTableSpec,
} from '../template-report/html.js';
import type { NorthStarReportModel, NorthStarTable } from './model.js';

/**
 * Renders the Awareness / App Install Template Report as portrait A4 HTML.
 * Same page furniture, styles and table renderer as the GMV report
 * (`template-report/render.ts`) — only the content differs — and like it,
 * reads nothing but the already-computed model (no DB/clock access).
 */

function table(title: string, t: NorthStarTable): string {
  const spec = toTableSpec(title, t.headers, t.rows, -1, t.emptyNote);
  return renderTable(spec);
}

export function renderNorthStarReportHtml(model: NorthStarReportModel): string {
  const health = statusBadge(model.healthScore === 'Sehat' ? 'Baik' : model.healthScore);

  const kpiGroups = model.kpiGroups
    .map(
      (g) => `
    <div class="kpi-group">
      <h3 class="kpi-group__title">${esc(g.title)}</h3>
      <div class="kpi-row">
        ${g.tiles
          .map(
            (t) =>
              `<div class="kpi-tile"><div class="label">${esc(t.label)}</div><div class="value">${esc(t.value)}</div><div class="sub">${esc(t.sub)}</div></div>`,
          )
          .join('')}
        <div class="kpi-tile kpi-tile--health"><div class="label">Overall Health Score</div><div class="value">${health}</div><div class="sub">Berdasarkan 6 indikator</div></div>
      </div>
    </div>`,
    )
    .join('');

  const funnelTable = toTableSpec(
    'Proporsi Budget per Funnel',
    ['Funnel', 'Objective / Campaign Type', 'Budget', '% dari Total', 'Benchmark Ideal', 'Status'],
    model.funnelRows.map((r) => ({
      cells: [r.stage, r.objectiveLabel, r.budget, r.pct, r.benchmarkLabel, r.status],
      status: r.status,
    })),
    5,
  );

  const benchmarkTables = model.benchmarkSections
    .map((section) => {
      const spec = toTableSpec(
        section.title,
        ['Metric', 'Hasil Aktual', 'Benchmark', 'Gap', 'Status'],
        section.rows.map((r) => ({
          cells: [r.metric, r.actual, r.benchmark, r.gap, r.scored === false ? '—' : r.status],
          status: r.scored === false ? undefined : r.status,
        })),
        4,
      );
      return `<h3>${esc(section.title)}</h3>${renderTable(spec)}`;
    })
    .join('');

  const trendTable = toTableSpec(
    model.trendTitle,
    ['Metric', 'Periode Ini', 'Periode Pembanding', 'Growth', 'Insight'],
    model.trendRows.map((r) => ({ cells: [r.metric, r.l30, r.l60_30, r.growth, r.insight] })),
    -1,
  );

  const outlookTable = toTableSpec(
    'Outlook & Target Periode Berikutnya',
    ['Metric', 'Kondisi Saat Ini', 'Target Periode Berikutnya', 'Strategi Utama'],
    model.outlook.map((r) => ({ cells: [r.metric, r.current, r.target, r.strategy] })),
    -1,
  );

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8" />
<title>${esc(model.clientName)} — ${esc(model.reportTitle)}</title>
<style>${styles(model.brandColor)}</style>
</head><body>

<section class="section">
  ${renderReportHeader({
    clientName: model.clientName,
    reportTitle: model.reportTitle,
    period: model.period,
    adAccountIds: model.adAccountIds,
  })}

  <h2>1. Ringkasan Eksekutif &amp; Health Check</h2>
  <div class="kpi-groups">${kpiGroups}</div>
  <h3>Skor Kesehatan per Area</h3>
  ${renderAreaTable(model.areaRows)}
  <p>${esc(model.execNarrative)}</p>
</section>

<section class="section">
  <h2>2. Proporsi Budget per Funnel (Awareness – Consideration – Conversion)</h2>
  <p class="muted">Benchmark Ideal: ${esc(model.benchmarkSource.label)}</p>
  ${renderTable(funnelTable)}
  <div class="insight"><span class="tag">Insight Alokasi Budget</span>${esc(model.funnelInsight)}</div>
</section>

<section class="section">
  <h2>3. Result Metric vs Benchmark</h2>
  <p class="muted">Benchmark: ${esc(model.benchmarkSource.label)}</p>
  ${benchmarkTables}
  <div class="insight"><span class="tag">Insight Efisiensi</span>${esc(model.efficiencyInsight)}</div>
</section>

<section class="section">
  <h2>4. ${esc(model.trendTitle)} — Periode Ini vs Periode Pembanding</h2>
  ${renderTable(trendTable)}
  <div class="insight"><span class="tag">Insight Tren</span>${esc(model.trendInsight)}</div>
  ${renderSourceBreakdown(model.sourceBreakdown, model.sourceInsight)}
</section>

<section class="section">
  <h2>5. ${esc(model.campaignTitle)}</h2>
  ${table(model.campaignTitle, model.campaignTable)}
  <div class="insight"><span class="tag">Insight Campaign</span>${esc(model.campaignInsight)}</div>
</section>

<section class="section">
  <h2>6. ${esc(model.creativeTitle)}</h2>
  ${table(model.creativeTitle, model.creativeTable)}
  <div class="insight"><span class="tag">Insight Creative</span>${esc(model.creativeInsight)}</div>
</section>

<section class="section">
  <h2>7. Risiko Utama</h2>
  ${renderRiskTable(model.risks)}
</section>

<section class="section">
  <h2>8. Rekomendasi Next Steps</h2>
  ${renderRecommendations(model.recommendations, model.recommendationInsight)}
</section>

<section class="section">
  <h2>9. Outlook &amp; Target Periode Berikutnya</h2>
  ${renderTable(outlookTable)}
</section>

<section class="appendix">
  <h2>Lampiran A. Legenda &amp; Definisi</h2>
  <p class="muted">Penjelasan istilah, rumus, dan cara membaca status yang dipakai di laporan ini.</p>
  ${renderLegend(model.legend)}
</section>

</body></html>`;
}
