import { renderTable } from '../deck/render.js';
import type { TemplateReportModel } from './model.js';
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
} from './html.js';

// Re-exported so existing importers of these helpers keep working.
export { esc, statusBadge, styles, toTableSpec };

/**
 * Renders the GMV / TikTok Shop Template Report ("TikTok Ads Performance
 * Report") as a portrait A4 HTML document, mirroring `deck/render.ts`'s own
 * contract: reads only the already-computed `TemplateReportModel`, no
 * DB/clock access. Reuses `renderTable` from the deck renderer for the plain
 * tabular sections and `html.ts` for the blocks every template variant shares
 * (header, health table, source breakdown, risks, recommendations, legend).
 */

export function renderTemplateReportHtml(model: TemplateReportModel): string {
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
    'Tren Performa Gabungan (TTAM + GMV Max)',
    ['Metric', 'Periode Ini', 'Periode Pembanding', 'Growth', 'Insight'],
    model.trendRows.map((r) => ({ cells: [r.metric, r.l30, r.l60_30, r.growth, r.insight] })),
    -1,
  );

  const productTable = toTableSpec(
    'Produk Andalan yang Bisa Dimaksimalkan',
    ['Produk', 'GMV', 'Orders', 'ROI', '% Kontribusi thd Total GMV', 'Rekomendasi'],
    model.productRows.map((r) => ({ cells: [r.produk, r.gmv, r.orders, r.roi, r.pctKontribusi, r.rekomendasi] })),
    -1,
    'Belum ada data produk GMV Max pada periode ini.',
  );

  const creativeTable = toTableSpec(
    'Creative yang Winning',
    ['Creative / Sesi', 'Format', 'Cost', 'CTR / ROI', 'Status', 'Catatan'],
    model.creativeRows.map((r) => ({ cells: [r.creative, r.format, r.cost, r.ctrRoi, r.status, r.catatan] })),
    -1,
    'Belum ada data creative pada periode ini.',
  );

  const outlookTable = toTableSpec(
    'Outlook & Target Periode Berikutnya',
    ['Metric', 'Kondisi Saat Ini', 'Target Periode Berikutnya', 'Strategi Utama'],
    model.outlook.map((r) => ({ cells: [r.metric, r.current, r.target, r.strategy] })),
    -1,
  );

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8" />
<title>${esc(model.clientName)} — TikTok Ads Performance Report</title>
<style>${styles(model.brandColor)}</style>
</head><body>

<section class="section">
  ${renderReportHeader({
    clientName: model.clientName,
    reportTitle: 'TikTok Ads Performance Report',
    period: model.period,
    adAccountIds: model.adAccountIds,
  })}

  <h2>1. Ringkasan Eksekutif &amp; Health Check</h2>
  <div class="kpi-groups">
    <div class="kpi-group">
      <h3 class="kpi-group__title">TTAM &middot; Reach &amp; Engagement</h3>
      <div class="kpi-row">
        <div class="kpi-tile"><div class="label">Spend</div><div class="value">${esc(model.kpis.ttam.spend)}</div><div class="sub">${esc(model.kpis.ttam.spendDelta)} vs periode pembanding</div></div>
        <div class="kpi-tile"><div class="label">Reach</div><div class="value">${esc(model.kpis.ttam.reach)}</div><div class="sub">${esc(model.kpis.ttam.reachDelta)} vs periode pembanding</div></div>
        <div class="kpi-tile"><div class="label">Engagement</div><div class="value">${esc(model.kpis.ttam.engagement)}</div><div class="sub">${esc(model.kpis.ttam.engagementDelta)} vs periode pembanding</div></div>
        <div class="kpi-tile kpi-tile--health"><div class="label">Overall Health Score</div><div class="value">${statusBadge(model.kpis.healthScore === 'Sehat' ? 'Baik' : model.kpis.healthScore)}</div><div class="sub">Berdasarkan 6 indikator</div></div>
      </div>
    </div>
    <div class="kpi-group">
      <h3 class="kpi-group__title">GMV Max &middot; Conversion</h3>
      <div class="kpi-row">
        <div class="kpi-tile"><div class="label">Spend</div><div class="value">${esc(model.kpis.gmvMax.spend)}</div><div class="sub">${esc(model.kpis.gmvMax.spendDelta)} vs periode pembanding</div></div>
        <div class="kpi-tile"><div class="label">Revenue</div><div class="value">${esc(model.kpis.gmvMax.revenue)}</div><div class="sub">${esc(model.kpis.gmvMax.revenueDelta)} vs periode pembanding</div></div>
        <div class="kpi-tile"><div class="label">ROI / ROAS</div><div class="value">${esc(model.kpis.gmvMax.roi)}</div><div class="sub">${esc(model.kpis.gmvMax.roiDelta)} &middot; Target: ${esc(model.kpis.gmvMax.roiTarget)}</div></div>
        <div class="kpi-tile kpi-tile--health"><div class="label">Overall Health Score</div><div class="value">${statusBadge(model.kpis.healthScore === 'Sehat' ? 'Baik' : model.kpis.healthScore)}</div><div class="sub">Berdasarkan 6 indikator</div></div>
      </div>
    </div>
    <div class="kpi-group">
      <h3 class="kpi-group__title">Total &middot; TTAM + GMV Max</h3>
      <div class="kpi-row">
        <div class="kpi-tile"><div class="label">Total Spend</div><div class="value">${esc(model.kpis.total.spend)}</div><div class="sub">${esc(model.kpis.total.spendDelta)} vs periode pembanding</div></div>
        <div class="kpi-tile"><div class="label">CPM (Blended)</div><div class="value">${esc(model.kpis.total.cpm)}</div><div class="sub">${esc(model.kpis.total.cpmDelta)} vs periode pembanding</div></div>
        <div class="kpi-tile"><div class="label">ROI / ROAS (Blended)</div><div class="value">${esc(model.kpis.total.roi)}</div><div class="sub">${esc(model.kpis.total.roiDelta)} vs periode pembanding</div></div>
        <div class="kpi-tile kpi-tile--health"><div class="label">Overall Health Score</div><div class="value">${statusBadge(model.kpis.healthScore === 'Sehat' ? 'Baik' : model.kpis.healthScore)}</div><div class="sub">Berdasarkan 6 indikator</div></div>
      </div>
    </div>
  </div>
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
  <h2>4. Tren Performa Gabungan (TTAM + GMV Max) — Periode Ini vs Periode Pembanding</h2>
  ${renderTable(trendTable)}
  <div class="insight"><span class="tag">Insight Tren</span>${esc(model.trendInsight)}</div>
  ${renderSourceBreakdown(model.roiBreakdown, model.roiInsight)}
</section>

<section class="section">
  <h2>5. Produk Andalan yang Bisa Dimaksimalkan</h2>
  ${renderTable(productTable)}
  <div class="insight"><span class="tag">Insight Produk</span>${esc(model.productInsight)}</div>
</section>

<section class="section">
  <h2>6. Creative yang Winning</h2>
  ${renderTable(creativeTable)}
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
