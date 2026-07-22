import type { ReportCopy } from './i18n.js';

/**
 * Shared presentation primitives for report documents — escaping, the palette,
 * the page furniture (cover, section heads, chart cards) and the print
 * stylesheet. Extracted so every report renderer produces the same document
 * design instead of each one carrying its own copy of the CSS.
 */

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const PAID_COLOR = '#2A78D6';
export const ORGANIC_COLOR = '#1BAF7A';
export const ROAS_COLOR = '#C98500';
export const ENG_COLOR = '#4A3AA7';
export const MUTED_COLOR = '#8A9099';

export const shortDate = (iso: string, copy: ReportCopy): string => {
  const [, m, d] = iso.split('-').map(Number);
  return `${copy.months[(m ?? 1) - 1]} ${d}`;
};

/** Hour-of-day label, e.g. 9 → "09:00". */
export const hourLabel = (h: number): string => `${String(h).padStart(2, '0')}:00`;

export function sectionTitle(num: string, title: string): string {
  return `<div class="section-head"><span class="section-num">${num}</span><h2>${esc(title)}</h2></div>`;
}

export function bullets(items: string[]): string {
  if (!items.length) return '';
  return `<ul class="bullets">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

export function chartCard(title: string, svg: string, legendHtml: string): string {
  return `<figure class="chart-card">
    <figcaption class="chart-head"><span>${esc(title)}</span>${legendHtml}</figcaption>
    <div class="chart-body">${svg}</div>
  </figure>`;
}

export function legend(items: Array<[string, string, 'bar' | 'line']>): string {
  return `<span class="legend">${items
    .map(
      ([label, color, shape]) =>
        `<span class="lg"><span class="lg-mark lg-${shape}" style="background:${color}"></span>${esc(label)}</span>`,
    )
    .join('')}</span>`;
}

export interface CoverMeta {
  clientName: string;
  subtitle: string;
  periodKey: string;
  periodValue: string;
  preparedForKey: string;
  generatedLabel: string;
  brand: string;
}

export function cover(m: CoverMeta): string {
  return `<header class="cover">
    <div class="cover-bar" style="background:${m.brand}"></div>
    <div class="cover-body">
      <div class="brandline">
        <span class="logo-dot" style="background:${m.brand}"></span>
        <span class="logo-text">Tempo <span class="logo-sub">Insight Engine</span></span>
      </div>
      <div class="cover-avatar" style="background:${m.brand}">${esc(m.clientName.charAt(0))}</div>
      <h1 class="cover-title">${esc(m.clientName)}</h1>
      <p class="cover-subtitle">${esc(m.subtitle)}</p>
      <div class="cover-meta">
        <div><span class="meta-k">${esc(m.periodKey)}</span><span class="meta-v">${esc(m.periodValue)}</span></div>
        <div><span class="meta-k">${esc(m.preparedForKey)}</span><span class="meta-v">${esc(m.clientName)}</span></div>
        <div><span class="meta-k">${esc(m.generatedLabel)}</span></div>
      </div>
    </div>
  </header>`;
}

/**
 * A callout for statements about the data itself (coverage gaps, buckets that
 * are not true hours). Rendered distinctly from analysis so a reader can tell
 * "this is a caveat about the source" from "this is a finding".
 */
export function dataNote(title: string, items: string[]): string {
  if (!items.length) return '';
  return `<aside class="datanote">
    <div class="datanote-title">${esc(title)}</div>
    <ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
  </aside>`;
}

/** Tone of a callout. Insight is neutral-positive; warning and risk escalate. */
export type CalloutTone = 'insight' | 'warning' | 'risk';

/**
 * A titled callout pairing one named finding with its explanation — the unit
 * that turns a chart into an argument. Every section carries one.
 */
export function callout(title: string, body: string, tone: CalloutTone = 'insight'): string {
  return `<aside class="callout callout-${tone}">
    <div class="callout-title">${esc(title)}</div>
    <p>${esc(body)}</p>
  </aside>`;
}

/** Analyst prose beneath a section's visual. */
export function prose(paragraphs: string[]): string {
  return paragraphs.filter(Boolean).map((p) => `<p class="prose">${esc(p)}</p>`).join('');
}

export interface KpiCell {
  label: string;
  value: string;
  /** Fractional change, or null when there is no comparable baseline. */
  delta?: number | null;
  /** Which direction is favourable, for colouring. */
  goodDirection?: 'up' | 'down' | 'neutral';
  /** Basis caption, e.g. "vs 10h on Jul 19". */
  caption?: string;
}

function deltaSpan(
  delta: number | null | undefined,
  goodDirection: 'up' | 'down' | 'neutral' = 'neutral',
): string {
  if (delta === null || delta === undefined) return `<span class="kdelta flat">—</span>`;
  const flat = Math.abs(delta) < 0.0005;
  const rising = delta > 0;
  const tone =
    flat || goodDirection === 'neutral'
      ? 'flat'
      : rising === (goodDirection === 'up')
        ? 'good'
        : 'bad';
  const arrow = flat ? '→' : rising ? '▲' : '▼';
  const pct = `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
  return `<span class="kdelta ${tone}">${arrow} ${esc(pct)}</span>`;
}

/** The headline KPI row: label, large tabular value, coloured delta. */
export function kpiRow(cells: KpiCell[]): string {
  return `<div class="kpi-row">${cells
    .map(
      (c) => `<div class="kcard">
        <div class="klabel">${esc(c.label)}</div>
        <div class="kvalue">${esc(c.value)}</div>
        <div class="kfoot">${deltaSpan(c.delta, c.goodDirection)}${
          c.caption ? `<span class="kcaption">${esc(c.caption)}</span>` : ''
        }</div>
      </div>`,
    )
    .join('')}</div>`;
}

export type Severity = 'high' | 'medium' | 'low';

export interface RiskCard {
  risk: string;
  severity: Severity;
  action: string;
  owner: string;
  severityLabel: string;
}

/** A prioritized risk with the action that answers it and who owns it. */
export function riskCards(items: RiskCard[], ownerLabel: string): string {
  if (!items.length) return '';
  return `<div class="risks">${items
    .map(
      (r) => `<div class="risk">
        <div class="risk-head">
          <span class="risk-title">${esc(r.risk)}</span>
          <span class="sev sev-${r.severity}">${esc(r.severityLabel)}</span>
        </div>
        <p class="risk-action">${esc(r.action)}</p>
        <div class="risk-owner">${esc(ownerLabel)}: ${esc(r.owner)}</div>
      </div>`,
    )
    .join('')}</div>`;
}

/**
 * A per-entity diagnosis card: name plus a strip of its key figures. Used for
 * the adgroup breakdown, mirroring the reference's creative-diagnosis cards.
 */
export function entityCards(
  items: Array<{ name: string; sub?: string; metrics: Array<{ label: string; value: string }> }>,
): string {
  if (!items.length) return '';
  return `<div class="ecards">${items
    .map(
      (e) => `<div class="ecard">
        <div class="ecard-metrics">${e.metrics
          .map(
            (m) =>
              `<div class="em"><span class="em-l">${esc(m.label)}</span><span class="em-v">${esc(m.value)}</span></div>`,
          )
          .join('')}</div>
        <div class="ecard-name">${esc(e.name)}</div>
        ${e.sub ? `<div class="ecard-sub">${esc(e.sub)}</div>` : ''}
      </div>`,
    )
    .join('')}</div>`;
}

export function statGrid(cells: Array<{ label: string; value: string; sub?: string }>): string {
  return `<div class="kpi-grid"><div class="kpi-group">${cells
    .map(
      (c) => `<div class="kpi">
        <div class="kpi-top"><span class="pip" style="background:${PAID_COLOR}"></span><span class="kpi-label">${esc(c.label)}</span></div>
        <div class="kpi-value">${esc(c.value)}</div>
        ${c.sub ? `<span class="delta neutral">${esc(c.sub)}</span>` : ''}
      </div>`,
    )
    .join('')}</div></div>`;
}

/** Print stylesheet shared by every report document. */
export function styles(brand: string): string {
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

  /* Caveats about the source data, kept visually distinct from analysis. */
  .datanote { border:1px solid #E7D9B0; background:#FDFAF1; border-radius:9px; padding:11px 14px; margin:0 0 16px; }
  .datanote-title { font-weight:700; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#8A6A15; margin-bottom:5px; }
  .datanote ul { list-style:none; display:flex; flex-direction:column; gap:5px; }
  .datanote li { position:relative; padding-left:14px; color:var(--ink-2); font-size:11px; line-height:1.5; }
  .datanote li::before { content:''; position:absolute; left:2px; top:6px; width:4px; height:4px; border-radius:50%; background:#C9A227; }

  /* Hourly appendix: dense, repeating header on page breaks. */
  table.hours { width:100%; border-collapse:collapse; font-size:10px; margin-top:4px; }
  table.hours thead { display:table-header-group; }
  table.hours thead th { text-align:right; font-weight:600; color:var(--ink-3); font-size:9px; text-transform:uppercase; letter-spacing:0.04em; padding:5px 6px; border-bottom:1.5px solid var(--line); }
  table.hours thead th:first-child { text-align:left; }
  table.hours td { padding:4.5px 6px; border-bottom:1px solid var(--line-2); text-align:right; font-variant-numeric:tabular-nums; }
  table.hours td:first-child { text-align:left; font-weight:600; }
  table.hours tr.peak td { background:#F2F7FE; }
  table.hours tfoot td { border-top:1.5px solid var(--line); border-bottom:none; font-weight:700; padding-top:6px; }
  /* --- Narrative report components --------------------------------------- */

  .kpi-row { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:16px; }
  .kcard { border:1px solid var(--line); border-radius:9px; padding:12px 13px; }
  .klabel { font-size:10.5px; font-weight:600; color:var(--ink-3); margin-bottom:5px; }
  .kvalue { font-size:21px; font-weight:750; letter-spacing:-0.022em; font-variant-numeric:tabular-nums; line-height:1.15; }
  .kfoot { margin-top:7px; display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
  .kdelta { font-size:11.5px; font-weight:700; font-variant-numeric:tabular-nums; }
  .kdelta.good { color:#128A4E; } .kdelta.bad { color:#DC2626; } .kdelta.flat { color:var(--ink-3); }
  .kcaption { font-size:10px; color:var(--ink-3); }

  .callout { border:1px solid; border-radius:9px; padding:11px 14px; margin:14px 0; page-break-inside:avoid; }
  .callout-title { font-weight:700; font-size:12px; margin-bottom:3px; }
  .callout p { font-size:11.5px; line-height:1.55; }
  .callout-insight { background:#EFF5FE; border-color:#C7DDF8; }
  .callout-insight .callout-title { color:#1B4E8F; } .callout-insight p { color:#2E4A6B; }
  .callout-warning { background:#FDFAF1; border-color:#EBDCA9; }
  .callout-warning .callout-title { color:#8A6A15; } .callout-warning p { color:#6B5A2C; }
  .callout-risk { background:#FDF1F1; border-color:#F3CFCF; }
  .callout-risk .callout-title { color:#A82121; } .callout-risk p { color:#7B3636; }

  .prose { color:var(--ink-2); line-height:1.6; margin-bottom:9px; }

  .risks { display:flex; flex-direction:column; gap:9px; }
  .risk { border:1px solid var(--line); border-radius:9px; padding:11px 13px; page-break-inside:avoid; }
  .risk-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  .risk-title { font-weight:650; font-size:12.5px; }
  .sev { border:1px solid; border-radius:20px; padding:2px 9px; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; white-space:nowrap; }
  .sev-high { border-color:#F3CFCF; background:#FDF1F1; color:#A82121; }
  .sev-medium { border-color:#EBDCA9; background:#FDFAF1; color:#8A6A15; }
  .sev-low { border-color:#C7DDF8; background:#EFF5FE; color:#1B4E8F; }
  .risk-action { margin-top:6px; color:var(--ink-2); font-size:11.5px; line-height:1.5; }
  .risk-owner { margin-top:6px; font-size:10px; color:var(--ink-3); font-weight:600; }

  .ecards { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin-top:4px; }
  .ecard { border:1px solid var(--line); border-radius:9px; padding:11px 12px; page-break-inside:avoid; }
  .ecard-metrics { display:flex; flex-wrap:wrap; gap:10px 16px; margin-bottom:8px; }
  .em { display:flex; flex-direction:column; gap:1px; }
  .em-l { font-size:9px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--ink-3); }
  .em-v { font-size:13.5px; font-weight:700; font-variant-numeric:tabular-nums; }
  .ecard-name { font-size:11.5px; font-weight:600; line-height:1.4; border-top:1px solid var(--line-2); padding-top:7px; }
  .ecard-sub { font-size:10px; color:var(--ink-3); margin-top:2px; }

  .appendix-day { page-break-inside:avoid; margin-bottom:18px; }
  .appendix-day h3 { font-size:13px; font-weight:700; margin-bottom:2px; }
  .appendix-day .sub { color:var(--ink-3); font-size:10.5px; margin-bottom:6px; }
  .na { color:var(--ink-3); }
  `;
}
