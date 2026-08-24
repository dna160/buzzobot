import type { Currency } from '@tempo/core';
import { comboChart, rankChart } from '../charts.js';
import { DECK_COPY, objectiveLabel, tierBadge } from './copy.js';
import { formatMetric } from './metric-values.js';
import type {
  Block,
  ChartSpec,
  DeckMeta,
  DeckModel,
  FindingCard,
  KpiTile,
  RoadmapRow,
  Slide,
  TableSpec,
} from './model.js';

/**
 * `renderDeckHtml(model)` — a self-contained 16:9 landscape HTML document,
 * one slide per printed page (Brief Deck PRD §6).
 *
 * It reads `DeckModel` and nothing else: no engine JSON, no read-model rows, no
 * database, no clock. That is the hard rule from PRD §0.1, and it is what makes
 * a second renderer (pptxgenjs, one day) an additive milestone rather than a
 * redesign.
 *
 * Fidelity constraints this file has to satisfy:
 *  - `@page { size: 338.67mm 190.5mm }` — 16:9, landscape, `printBackground`.
 *  - One slide = one page, `break-after: page`; a block never straddles a page.
 *  - Inline SVG charts only. No client-side JS, no canvas, no network request:
 *    the renderer runs in headless Chromium with no network, and a font or an
 *    image fetched at render time is a blank space in the PDF.
 *  - Brand colour drives the cover, chips and chart accents through CSS vars.
 */

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 16:9 at 96dpi-equivalent print geometry: 1280×720pt → mm. */
export const SLIDE_WIDTH_MM = 338.67;
export const SLIDE_HEIGHT_MM = 190.5;

/**
 * Chart geometry, chosen for a 16:9 slide column rather than the A4 report the
 * generators were written for. The SVGs scale to the column width, so these
 * numbers set the *ratio* — and therefore how much vertical space a chart
 * takes once it lands on the page.
 */
const COMBO_CHART_WIDTH = 1100;
const COMBO_CHART_HEIGHT = 230;
const RANK_CHART_WIDTH = 2000;

const LIGHT_COLORS = {
  green: '#1BAF7A',
  yellow: '#C98500',
  red: '#D6453D',
  none: '#8A9099',
} as const;

function styles(brand: string): string {
  return `
    :root {
      --brand: ${brand};
      --ink: #0D0F12;
      --muted: #6B7280;
      --hairline: #E5E8EC;
      --surface: #FFFFFF;
      --surface-alt: #F7F8FA;
      --green: ${LIGHT_COLORS.green};
      --yellow: ${LIGHT_COLORS.yellow};
      --red: ${LIGHT_COLORS.red};
      --none: ${LIGHT_COLORS.none};
    }
    @page { size: ${SLIDE_WIDTH_MM}mm ${SLIDE_HEIGHT_MM}mm; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, "Helvetica Neue", Arial, sans-serif;
      color: var(--ink);
      background: var(--surface);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .slide {
      width: ${SLIDE_WIDTH_MM}mm;
      height: ${SLIDE_HEIGHT_MM}mm;
      padding: 12mm 14mm 10mm;
      position: relative;
      overflow: hidden;
      break-after: page;
      display: flex;
      flex-direction: column;
    }
    .slide:last-child { break-after: auto; }
    .slide__title {
      font-size: 19pt;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin: 0 0 5mm;
    }
    /* The slide is a fixed page, so the body must fit inside it: it reserves
       room for the footer and lets flexible blocks (charts) absorb whatever is
       left rather than pushing content under the footer or onto a second page. */
    .slide__body {
      flex: 1; display: flex; flex-direction: column; gap: 4mm;
      min-height: 0; padding-bottom: 8mm;
      /* One slide is one page: content that does not fit is clipped here,
         cleanly above the footer, rather than printing across it. The block
         budget in build.ts is what keeps a slide inside its page in the
         first place — this is the backstop, not the plan. */
      overflow: hidden;
    }
    /* A block may never straddle a page — one slide is one page, so anything
       that would overflow is clipped visibly rather than silently reflowed. */
    .block { break-inside: avoid; }

    .cover { background: var(--brand); color: #FFF; justify-content: flex-end; }
    .cover__client { font-size: 40pt; font-weight: 800; letter-spacing: -0.02em; margin: 0; }
    .cover__objective { font-size: 16pt; font-weight: 500; opacity: 0.9; margin: 2mm 0 0; }
    .cover__meta { margin-top: 6mm; font-size: 10pt; opacity: 0.85; display: flex; gap: 8mm; }
    .cover__badge {
      display: inline-block; border: 1px solid rgba(255,255,255,0.55); border-radius: 999px;
      padding: 1.2mm 4mm; font-size: 9pt; font-weight: 600; letter-spacing: 0.02em;
    }

    .kpis { display: grid; gap: 3.5mm; }
    .kpis--1x3 { grid-template-columns: repeat(3, 1fr); }
    .kpis--2x2 { grid-template-columns: repeat(2, 1fr); }
    .kpis--2x3 { grid-template-columns: repeat(3, 1fr); }
    .kpi {
      border: 1px solid var(--hairline); border-radius: 3mm; padding: 4mm 4.5mm;
      background: var(--surface-alt); position: relative;
    }
    .kpi__label { font-size: 8.5pt; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .kpi__value { font-size: 21pt; font-weight: 750; margin-top: 1.5mm; font-variant-numeric: tabular-nums; }
    .kpi__delta { font-size: 9pt; margin-top: 1mm; font-variant-numeric: tabular-nums; }
    .kpi__delta--up { color: var(--green); }
    .kpi__delta--down { color: var(--red); }
    .kpi__delta--flat { color: var(--muted); }
    .kpi__light { position: absolute; top: 4mm; right: 4.5mm; width: 2.6mm; height: 2.6mm; border-radius: 50%; }
    .kpi__suggested { font-size: 7.5pt; color: var(--muted); font-style: italic; margin-top: 0.8mm; }

    .chart {
      border: 1px solid var(--hairline); border-radius: 3mm; padding: 4mm;
      background: var(--surface); overflow: hidden;
      /* Natural size, not a flex slot. An SVG told to fill a short, wide box
         preserves its own ratio and letterboxes — the chart ends up a postage
         stamp floating in the middle of it. Charts are drawn at a ratio chosen
         for this page instead (see renderChart), and the per-slide card budget
         in build.ts is what guarantees the slide still fits. */
      flex: 0 0 auto;
    }
    .chart__title { font-size: 9pt; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2mm; }
    .chart svg { width: 100%; height: auto; display: block; }

    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
    th, td { padding: 1.8mm 2.5mm; text-align: left; border-bottom: 1px solid var(--hairline); }
    th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 700; }
    td.numeric, th.numeric { text-align: right; font-variant-numeric: tabular-nums; }
    tr.row--green td:first-child { box-shadow: inset 2mm 0 0 -1.3mm var(--green); }
    tr.row--yellow td:first-child { box-shadow: inset 2mm 0 0 -1.3mm var(--yellow); }
    tr.row--red td:first-child { box-shadow: inset 2mm 0 0 -1.3mm var(--red); }
    td.action { color: var(--muted); font-weight: 600; }

    /* The card grammar (PRD §4): light chip -> headline -> evidence chips ->
       mechanism -> action. Numbers live in the chips, prose carries mechanism —
       which is both how the reference audit format earns trust and what the
       numeral gate wants. */
    .cards { display: flex; flex-direction: column; gap: 2.5mm; }
    .card {
      border: 1px solid var(--hairline); border-left-width: 1.4mm; border-radius: 2.5mm;
      padding: 2.8mm 3.5mm; background: var(--surface);
    }
    .card--green { border-left-color: var(--green); }
    .card--yellow { border-left-color: var(--yellow); }
    .card--red { border-left-color: var(--red); }
    .card--none { border-left-color: var(--hairline); }
    .card__headline { font-size: 10.5pt; font-weight: 700; line-height: 1.25; margin: 0 0 1.6mm; }
    .card__chips { display: flex; flex-wrap: wrap; gap: 1.8mm; margin-bottom: 1.6mm; }
    .chip {
      display: inline-flex; gap: 1.5mm; align-items: baseline;
      background: var(--surface-alt); border: 1px solid var(--hairline);
      border-radius: 1.5mm; padding: 1mm 2.5mm; font-size: 8pt;
    }
    .chip__label { color: var(--muted); }
    .chip__value { font-weight: 700; font-variant-numeric: tabular-nums; }
    .card__mechanism { font-size: 8.8pt; line-height: 1.4; margin: 0 0 1.2mm; }
    .card__action { font-size: 9pt; font-weight: 600; margin: 0; }
    .card__footer { font-size: 7pt; color: var(--muted); margin-top: 1.6mm; }

    .prose { font-size: 10pt; line-height: 1.5; color: var(--ink); margin: 0; }
    .coverage { font-size: 8.5pt; color: var(--muted); font-style: italic; }
    .empty { font-size: 9pt; color: var(--muted); font-style: italic; }

    .priority { font-weight: 800; font-size: 8.5pt; }
    .priority--P0 { color: var(--red); }
    .priority--P1 { color: var(--yellow); }
    .priority--P2 { color: var(--muted); }

    .footer {
      position: absolute; left: 14mm; right: 14mm; bottom: 5mm;
      display: flex; justify-content: space-between; gap: 6mm;
      font-size: 7pt; color: var(--muted); border-top: 1px solid var(--hairline); padding-top: 2mm;
    }
    .footer__notes { text-align: right; max-width: 60%; }
    .appendix table { font-size: 7pt; }
    .appendix th, .appendix td { padding: 1.2mm 2mm; }
  `;
}

function renderChart(spec: ChartSpec, currency: Currency): string {
  // Axis ticks are values the chart generator computed, not series members, so
  // they are formatted from the series' own metric definition. Anything else
  // prints a raw rupiah figure on the axis of a client deck.
  if (spec.kind === 'rank') {
    const series = spec.series[0];
    if (!series) return '';
    const rows = spec.labels.map((l, i) => ({ label: l, value: series.values[i] ?? 0 }));
    // A wide nominal width keeps the rendered height low once the SVG is
    // scaled to the slide's column: the generator sizes rows in absolute
    // units, so ratio is the only lever over how tall it lands.
    return rankChart(rows, {
      width: RANK_CHART_WIDTH,
      barColor: series.color,
      format: (v) => formatMetric(series.metric, v, currency),
    });
  }

  const bar = spec.series.find((s) => s.kind === 'bar');
  const line = spec.series.find((s) => s.kind === 'line');
  if (!bar) return '';
  const points = spec.labels.map((l, i) => ({
    label: l,
    bar: bar.values[i] ?? 0,
    line: line?.values[i] ?? 0,
  }));
  return comboChart(points, {
    width: COMBO_CHART_WIDTH,
    height: COMBO_CHART_HEIGHT,
    barColor: bar.color,
    lineColor: line?.color ?? '#1BAF7A',
    formatBar: (v) => formatMetric(bar.metric, v, currency),
    formatLine: (v) => (line ? formatMetric(line.metric, v, currency) : String(v)),
  });
}

function renderKpiGrid(tiles: KpiTile[], layout: string): string {
  const cells = tiles
    .map(
      (tile) => `
      <div class="kpi">
        <span class="kpi__light" style="background:${LIGHT_COLORS[tile.light]}"></span>
        <div class="kpi__label">${esc(tile.label)}</div>
        <div class="kpi__value">${esc(tile.value)}</div>
        ${
          tile.delta
            ? `<div class="kpi__delta kpi__delta--${tile.deltaDirection ?? 'flat'}">${esc(
                tile.delta,
              )} ${esc(DECK_COPY.labels.previousPeriod)}</div>`
            : ''
        }
        ${tile.suggested ? `<div class="kpi__suggested">${esc(DECK_COPY.labels.suggested)}</div>` : ''}
      </div>`,
    )
    .join('');
  return `<div class="block kpis kpis--${esc(layout)}">${cells}</div>`;
}

function renderTable(spec: TableSpec, appendix = false): string {
  if (spec.rows.length === 0) {
    return `<div class="block"><p class="empty">${esc(spec.emptyNote ?? '')}</p></div>`;
  }
  const hasActions = spec.rows.some((r) => r.action);
  const head = spec.headers
    .map((h, i) => `<th${i > 0 ? ' class="numeric"' : ''}>${esc(h)}</th>`)
    .join('');
  const actionHead = hasActions ? '<th></th>' : '';
  const body = spec.rows
    .map((row) => {
      const cells = row.cells
        .map((cell) => `<td${cell.numeric ? ' class="numeric"' : ''}>${esc(cell.text)}</td>`)
        .join('');
      const action = hasActions ? `<td class="action">${esc(row.action ?? '')}</td>` : '';
      const cls = row.light && row.light !== 'none' ? ` class="row--${row.light}"` : '';
      return `<tr${cls}>${cells}${action}</tr>`;
    })
    .join('');
  return `<div class="block${appendix ? ' appendix' : ''}"><table><thead><tr>${head}${actionHead}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderCard(card: FindingCard): string {
  const chips = card.evidenceChips
    .map(
      (chip) =>
        `<span class="chip"><span class="chip__label">${esc(chip.label)}</span>` +
        `<span class="chip__value">${esc(chip.value)}</span></span>`,
    )
    .join('');
  const action = card.action ? `<p class="card__action">${esc(card.action)}</p>` : '';
  const implication = card.implication
    ? `<p class="card__mechanism">${esc(card.implication)}</p>`
    : '';
  return `<div class="block card card--${card.light}">
    <p class="card__headline">${esc(card.headline)}</p>
    ${chips ? `<div class="card__chips">${chips}</div>` : ''}
    <p class="card__mechanism">${esc(card.mechanism)}</p>
    ${implication}
    ${action}
    <div class="card__footer">${esc(card.footer.level)} · ${esc(
      card.footer.confidence,
    )} · ${esc(card.footer.source)} · ${esc(card.findingId)}</div>
  </div>`;
}

function renderRoadmap(rows: RoadmapRow[]): string {
  if (rows.length === 0) {
    return `<div class="block"><p class="empty">${esc(DECK_COPY.roadmap.empty)}</p></div>`;
  }
  const head = DECK_COPY.roadmap.headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows
    .map(
      (row) => `<tr>
        <td><span class="priority priority--${row.priority}">${row.priority}</span></td>
        <td>${esc(row.action)}</td>
        <td>${esc(row.owner)}</td>
        <td class="numeric">${esc(row.impact)}</td>
        <td>${esc(row.evidenceRef)}</td>
      </tr>`,
    )
    .join('');
  return `<div class="block"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderBlock(block: Block, appendix: boolean, currency: Currency): string {
  switch (block.kind) {
    case 'kpiGrid':
      return renderKpiGrid(block.tiles, block.layout);
    case 'chart':
      return `<div class="block chart"><div class="chart__title">${esc(
        block.spec.title,
      )}</div>${renderChart(block.spec, currency)}</div>`;
    case 'table':
      return renderTable(block.spec, appendix);
    case 'roadmap':
      return renderRoadmap(block.rows);
    case 'prose':
      return `<div class="block"><p class="prose">${esc(block.text)}</p></div>`;
    case 'coverageNote':
      return `<div class="block"><p class="coverage">${esc(block.text)}</p></div>`;
    case 'findingCard':
      return renderCard(block.card);
    case 'videoGrid':
      // Filled at M4 with the video slide. Rendering nothing is correct until
      // then — a placeholder would be a stub, and a stub is not a state this
      // system keeps (PRD §1).
      return '';
    default:
      return '';
  }
}

/**
 * The provenance footer, on every slide (PRD §6). Run id, engine version, tier,
 * probe count, and any section that fell back — so a thin deck is traceable to
 * `/ui/briefs/{run_id}` in one step instead of being argued about.
 */
function renderFooter(meta: DeckMeta): string {
  const probes = `${DECK_COPY.footer.probes} ${meta.probesExecuted}${
    meta.probesExecuted > 0 ? ` · yield ${(meta.probeYieldRate * 100).toFixed(0)}%` : ''
  }`;
  const notes = meta.legacyContent
    ? DECK_COPY.footer.legacyContent
    : meta.fallbacks.map((f) => `${f.slideId}: ${f.detail}`).join(' · ');
  return `<div class="footer">
    <span>${esc(meta.clientName)} · ${esc(objectiveLabel(meta.objective))} · ${esc(meta.period)} · ${esc(
      tierBadge(meta.tier),
    )}</span>
    <span class="footer__notes">${esc(DECK_COPY.footer.engine)} ${esc(meta.engineVersion)} · ${esc(
      DECK_COPY.footer.run,
    )} ${esc(meta.runId)} · ${esc(probes)}${notes ? ` · ${esc(notes)}` : ''}</span>
  </div>`;
}

function renderCover(meta: DeckMeta): string {
  return `<section class="slide cover">
    <div class="cover__badge">${esc(tierBadge(meta.tier))}</div>
    <h1 class="cover__client">${esc(meta.clientName)}</h1>
    <p class="cover__objective">${esc(objectiveLabel(meta.objective))}</p>
    <div class="cover__meta">
      <span>${esc(DECK_COPY.labels.period)}: ${esc(meta.period)}</span>
      <span>${esc(DECK_COPY.labels.generated)}: ${esc(meta.generatedAt.slice(0, 10))}</span>
    </div>
  </section>`;
}

function renderSlide(slide: Slide, meta: DeckMeta): string {
  if (slide.variant === 'cover') return renderCover(meta);
  const appendix = slide.variant === 'appendix';
  const body = slide.blocks
    .map((block) => renderBlock(block, appendix, meta.currency))
    .join('\n');
  return `<section class="slide${appendix ? ' appendix' : ''}">
    <h2 class="slide__title">${esc(slide.title)}</h2>
    <div class="slide__body">${body}</div>
    ${renderFooter(meta)}
  </section>`;
}

export function renderDeckHtml(model: DeckModel): string {
  const { meta, slides } = model;
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>${esc(meta.clientName)} — ${esc(objectiveLabel(meta.objective))} — ${esc(meta.period)}</title>
<style>${styles(meta.brandColor)}</style>
</head>
<body>
${slides.map((slide) => renderSlide(slide, meta)).join('\n')}
</body>
</html>`;
}
