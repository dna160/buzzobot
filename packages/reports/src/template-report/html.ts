import type { Light, TableSpec } from '../deck/model.js';
import type { SourceBreakdownModel } from './breakdown.js';
import type { LegendGroup } from './legend.js';
import type { ReportPeriodInfo } from './period.js';
import type { Status } from './rubric.js';
import type { TemplateReportAreaRow, TemplateReportRecommendations, TemplateReportRiskRow } from './model.js';

/**
 * HTML building blocks shared by every Template Report variant (GMV,
 * Awareness, App Install). Pure string builders that read only the
 * already-computed model — no DB/clock access — so a report renders the same
 * on any machine. Anything a reader sees that isn't variant-specific (header
 * block, health table, source breakdown, risks, recommendations, legend)
 * lives here, which is what keeps the three templates visually identical.
 */

export const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const STATUS_CLASS: Record<Status, string> = { Baik: 'ok', Waspada: 'warn', Kritis: 'bad' };
const STATUS_LIGHT: Record<Status, Light> = { Baik: 'green', Waspada: 'yellow', Kritis: 'red' };

export function statusBadge(status: Status): string {
  return `<span class="badge badge--${STATUS_CLASS[status]}">${esc(status)}</span>`;
}

/**
 * `renderTable` (shared with the Brief Deck) always HTML-escapes cell text —
 * correctly, since a table cell is plain data everywhere else it's used — so
 * a badge `<span>` passed as cell text would render as literal visible
 * markup, not a colored pill. Status rows use `renderTable`'s existing
 * `row.light` row-tinting instead (the same mechanism the deck's own tables
 * use): the status word stays plain text in its cell, and the whole row gets
 * a colored left edge via the `row--{light}` CSS below.
 */
export function toTableSpec(
  title: string,
  headers: string[],
  rows: Array<{ cells: string[]; status?: Status }>,
  statusColumnIndex: number,
  emptyNote?: string,
): TableSpec {
  return {
    title,
    headers,
    emptyNote,
    rows: rows.map(({ cells, status }) => ({
      cells: cells.map((text, i) => ({ text, numeric: i > 0 && i !== statusColumnIndex })),
      light: status ? STATUS_LIGHT[status] : undefined,
    })),
  };
}

export function styles(brandColor: string): string {
  return `
    /* Playwright's 'a4' pdf mode sets format:'A4' and margin:{top:10mm,bottom:14mm,left:0,right:0}
       via its own API (not preferCSSPageSize) and draws its own footer — so
       horizontal padding lives on body, not an @page rule, and this file draws
       no footer of its own. */
    * { box-sizing: border-box; }
    /* An explicit background: the report must read the same whether it is printed to PDF or dropped into a dark-themed page. */
    body { font-family: 'Segoe UI', system-ui, sans-serif; color: #1a1f2b; background: #fff; font-size: 10.5px; line-height: 1.45; padding: 0 14mm; }
    h1 { font-size: 22px; margin: 0 0 2px; color: #0f172a; }
    h2 { font-size: 13px; margin: 22px 0 6px; color: #0f172a; border-bottom: 2px solid ${esc(brandColor)}; padding-bottom: 4px; }
    h3 { font-size: 11px; margin: 14px 0 4px; color: #334155; }
    p { margin: 4px 0; }
    .muted { color: #64748b; }
    .section { break-inside: avoid-page; }
    .kpi-groups { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
    .kpi-group__title { font-size: 9.5px; margin: 8px 0 4px; color: #475569; text-transform: uppercase; letter-spacing: .04em; }
    .kpi-row { display: flex; gap: 10px; margin: 0 0 4px; }
    .kpi-tile { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; }
    .kpi-tile .label { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: .03em; }
    .kpi-tile .value { font-size: 16px; font-weight: 700; margin-top: 2px; }
    .kpi-tile .sub { font-size: 9px; color: #64748b; margin-top: 2px; }
    .kpi-tile--health { background: #f8fafc; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #e2e8f0; padding: 5px 7px; text-align: left; font-size: 9.5px; vertical-align: top; }
    th { background: #0f172a; color: #fff; font-weight: 600; }
    td.numeric { text-align: right; }
    tr.row--green td:first-child { box-shadow: inset 2mm 0 0 -1.3mm #16a34a; }
    tr.row--yellow td:first-child { box-shadow: inset 2mm 0 0 -1.3mm #d97706; }
    tr.row--red td:first-child { box-shadow: inset 2mm 0 0 -1.3mm #dc2626; }
    .badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 9px; font-weight: 700; white-space: nowrap; }
    .badge--ok { background: #dcfce7; color: #166534; }
    .badge--warn { background: #fef3c7; color: #92400e; }
    .badge--bad { background: #fee2e2; color: #991b1b; }
    .badge--info { background: #e0f2fe; color: #075985; }
    .insight { border-left: 3px solid ${esc(brandColor)}; background: #f8fafc; padding: 8px 12px; margin: 8px 0 14px; font-size: 10px; }
    .insight .tag { font-weight: 700; display: block; margin-bottom: 3px; color: ${esc(brandColor)}; }

    /* Header block */
    .meta { border: 1px solid #cbd5e1; border-left: 4px solid ${esc(brandColor)}; border-radius: 6px; background: #f8fafc; margin: 8px 0 12px; padding: 4px 0; }
    .meta__row { display: flex; gap: 10px; padding: 3px 12px; }
    .meta__k { flex: 0 0 120px; font-size: 9px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: .03em; padding-top: 1px; }
    .meta__v { flex: 1; font-size: 10px; color: #0f172a; }
    .meta__v strong { font-size: 11px; }

    /* Health table: what works / what needs work */
    td.area-good { color: #14532d; background: #f0fdf4; }
    td.area-bad { color: #7f1d1d; background: #fef2f2; }
    .tag-line { font-weight: 700; display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .03em; margin-bottom: 1px; }

    /* Source breakdown */
    tr.band td { font-weight: 700; font-size: 9px; letter-spacing: .03em; text-transform: uppercase; }
    tr.band--top td { background: #dcfce7; color: #166534; }
    tr.band--bottom td { background: #fee2e2; color: #991b1b; }
    tr.src--top td:first-child { box-shadow: inset 2mm 0 0 -1.3mm #16a34a; }
    tr.src--bottom td:first-child { box-shadow: inset 2mm 0 0 -1.3mm #dc2626; }
    .rank { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 8.5px; font-weight: 800; white-space: nowrap; }
    .rank--top { background: #16a34a; color: #fff; }
    .rank--bottom { background: #dc2626; color: #fff; }
    .impact--lift { color: #166534; font-weight: 700; }
    .impact--drag { color: #991b1b; font-weight: 700; }
    tr.sum td { background: #f1f5f9; font-weight: 700; }
    .notes { margin: 2px 0 8px 14px; padding: 0; font-size: 9px; color: #64748b; }

    /* Recommendations */
    .prio { display: inline-block; padding: 1px 8px; border-radius: 4px; font-size: 9px; font-weight: 800; color: #fff; }
    .prio--P1 { background: #dc2626; }
    .prio--P2 { background: #d97706; }
    .prio--P3 { background: #0284c7; }
    .timeline { display: block; margin-top: 3px; color: #64748b; font-style: italic; }

    /* Appendix */
    .appendix { page-break-before: always; }
    td.term { font-weight: 700; white-space: nowrap; width: 24%; }
    td.formula { color: #475569; font-family: Consolas, 'Courier New', monospace; font-size: 9px; width: 26%; }
  `;
}

function table(headers: string[], rowsHtml: string[], widths?: string[]): string {
  const head = headers
    .map((h, i) => `<th${widths?.[i] ? ` style="width:${widths[i]}"` : ''}>${esc(h)}</th>`)
    .join('');
  return `<div class="block"><table><thead><tr>${head}</tr></thead><tbody>${rowsHtml.join('')}</tbody></table></div>`;
}

export function renderReportHeader(input: {
  clientName: string;
  reportTitle: string;
  period: ReportPeriodInfo;
  adAccountIds: string[];
}): string {
  const { period } = input;
  const row = (k: string, v: string): string => `<div class="meta__row"><div class="meta__k">${esc(k)}</div><div class="meta__v">${v}</div></div>`;
  return `
  <h1>${esc(input.clientName)}</h1>
  <p class="muted">${esc(input.reportTitle)}</p>
  <div class="meta">
    ${row('Periode Laporan', `<strong>${esc(period.label)}</strong> (${period.days} hari)`)}
    ${row(
      'Periode Pembanding',
      `${esc(period.comparisonLabel)} (${period.comparisonDays} hari) &mdash; dipakai untuk kolom growth (%) dan bagian tren`,
    )}
    ${row('Acuan Benchmark', esc(period.benchmarkLabel))}
    ${row('Cakupan Data', esc(period.coverage))}
    ${row('Ad Account ID', esc(input.adAccountIds.length > 0 ? input.adAccountIds.join(', ') : 'tidak ditemukan'))}
    ${row('Template', esc(period.templateLabel))}
    ${row('Dibuat pada', esc(period.generatedAt))}
  </div>`;
}

export function renderAreaTable(rows: TemplateReportAreaRow[]): string {
  const body = rows.map(
    (r) =>
      `<tr><td><strong>${esc(r.area)}</strong></td><td>${esc(r.kondisi)}</td><td>${statusBadge(r.status)}</td>` +
      `<td class="area-good"><span class="tag-line">&#10003; Berjalan baik</span>${esc(r.working)}</td>` +
      `<td class="area-bad"><span class="tag-line">&#10007; Perlu perbaikan</span>${esc(r.improve)}</td></tr>`,
  );
  return table(['Area', 'Kondisi', 'Status', 'Yang Berjalan Baik', 'Yang Perlu Diperbaiki'], body, ['15%', '15%', '8%', '31%', '31%']);
}

export function renderSourceBreakdown(model: SourceBreakdownModel, insight: string): string {
  const headers = [
    'Peringkat',
    'Sumber',
    'Tipe',
    'Spend',
    model.outputLabel,
    model.efficiencyLabel,
    '% Spend',
    `% ${model.outputLabel}`,
    model.impactLabel,
  ];
  const topRows = model.rows.filter((r) => r.tone === 'top');
  const bottomRows = model.rows.filter((r) => r.tone === 'bottom');
  const dataRow = (r: SourceBreakdownRowLike): string =>
    `<tr class="src--${r.tone}"><td><span class="rank rank--${r.tone}">${esc(r.peringkat)}</span></td>` +
    `<td>${esc(r.sumber)}</td><td>${esc(r.tipe)}</td>` +
    `<td class="numeric">${esc(r.spend)}</td><td class="numeric">${esc(r.output)}</td>` +
    `<td class="numeric"><strong>${esc(r.efisiensi)}</strong></td>` +
    `<td class="numeric">${esc(r.pctSpend)}</td><td class="numeric">${esc(r.pctOutput)}</td>` +
    `<td class="numeric impact--${r.dampakTone === 'neutral' ? 'lift' : r.dampakTone}">${r.dampakTone === 'lift' ? '&#9650; ' : r.dampakTone === 'drag' ? '&#9660; ' : ''}${esc(r.dampak)}</td></tr>`;
  const band = (tone: 'top' | 'bottom', text: string): string =>
    `<tr class="band band--${tone}"><td colspan="${headers.length}">${esc(text)}</td></tr>`;

  const body: string[] = [];
  if (topRows.length > 0) {
    body.push(band('top', `▲ ${topRows.length} sumber dengan ${model.efficiencyLabel} tertinggi`));
    body.push(...topRows.map(dataRow));
  }
  if (bottomRows.length > 0) {
    body.push(band('bottom', `▼ ${bottomRows.length} sumber dengan ${model.efficiencyLabel} terendah (relatif terhadap sumber lain)`));
    body.push(...bottomRows.map(dataRow));
  }
  for (const s of model.summaryRows) {
    body.push(
      `<tr class="sum"><td colspan="3">${esc(s.label)}</td><td class="numeric">${esc(s.spend)}</td>` +
        `<td class="numeric">${esc(s.output)}</td><td class="numeric">${esc(s.efisiensi)}</td><td colspan="3"></td></tr>`,
    );
  }
  if (model.rows.length === 0) {
    body.unshift(`<tr><td colspan="${headers.length}">${esc(model.notes[0] ?? 'Belum ada data.')}</td></tr>`);
  }

  const notes = model.notes.length > 0 ? `<ul class="notes">${model.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  return `
  <h3>${esc(model.title)}</h3>
  <p>${esc(model.intro)}</p>
  ${table(headers, body, ['9%', '24%', '8%', '9%', '10%', '9%', '7%', '7%', '17%'])}
  ${notes}
  <div class="insight"><span class="tag">Insight Sumber Hasil</span>${esc(insight)}</div>`;
}

type SourceBreakdownRowLike = SourceBreakdownModel['rows'][number];

export function renderRiskTable(risks: TemplateReportRiskRow[]): string {
  const levelClass = { High: 'bad', Medium: 'warn', Low: 'ok' } as const;
  const body =
    risks.length === 0
      ? [`<tr><td colspan="4">Tidak ada risiko material periode ini.</td></tr>`]
      : risks.map(
          (r) =>
            `<tr><td><strong>${esc(r.risiko)}</strong></td><td><span class="badge badge--${levelClass[r.level]}">${esc(r.level)}</span></td>` +
            `<td>${esc(r.bukti)}</td><td>${esc(r.dampak)}</td></tr>`,
        );
  return table(['Risiko', 'Level', 'Bukti Data', 'Dampak jika Dibiarkan'], body, ['22%', '8%', '40%', '30%']);
}

export function renderRecommendations(rec: TemplateReportRecommendations, insight: string): string {
  const body = rec.rows.map(
    (r) =>
      `<tr><td><span class="prio prio--${r.prioritas}">${esc(r.prioritas)}</span></td><td><strong>${esc(r.area)}</strong></td>` +
      `<td>${esc(r.langkah)}</td><td>${esc(r.alokasi)}</td><td>${esc(r.dasar)}</td>` +
      `<td>${esc(r.target)}<span class="timeline">Timeline: ${esc(r.timeline)}</span></td></tr>`,
  );
  const plan =
    rec.funnelPlan.length > 0
      ? `<h3>Usulan Alokasi Budget Funnel — Periode Berikutnya</h3>
  <p class="muted">${esc(rec.funnelPlanNote)}</p>
  ${table(
    ['Funnel', 'Budget Saat Ini', 'Usulan Budget', 'Perubahan'],
    rec.funnelPlan.map(
      (p) => `<tr><td><strong>${esc(p.stage)}</strong></td><td>${esc(p.saatIni)}</td><td>${esc(p.usulan)}</td><td>${esc(p.perubahan)}</td></tr>`,
    ),
    ['25%', '25%', '25%', '25%'],
  )}`
      : '';
  return `
  <p class="muted">Urutan prioritas: P1 = 0–3 hari, P2 = 1–2 minggu, P3 = siklus berikutnya. Angka estimasi bersifat indikatif dan konservatif.</p>
  ${table(['Prioritas', 'Area', 'Next Step', 'Alokasi Budget / Strategi', 'Dasar Data', 'Target & Timeline'], body, ['8%', '11%', '24%', '22%', '19%', '16%'])}
  <div class="insight"><span class="tag">Ringkasan Rekomendasi</span>${esc(insight)}</div>
  ${plan}`;
}

export function renderLegend(groups: LegendGroup[]): string {
  return groups
    .map((g) => {
      const body = g.entries.map(
        (e) =>
          `<tr><td class="term">${esc(e.term)}</td><td>${esc(e.definition)}</td><td class="formula">${e.formula ? esc(e.formula) : '—'}</td></tr>`,
      );
      return `<h3>${esc(g.title)}</h3>${table(['Istilah', 'Definisi', 'Cara Menghitung'], body)}`;
    })
    .join('');
}
