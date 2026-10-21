import { esc } from '../template-report/html.js';
import { funnelChart, mixChart, rankChart, spendChart } from './charts.js';
import { idDate, pct, num } from './format.js';
import type { ActionRowModel, StrategyReportModel, StrategySectionModel } from './model.js';

/**
 * `StrategyReportModel` → A4 HTML (Strategy Report PRD §5.1, §9.4). Reads the
 * model and nothing else. Printed with `htmlToPdf(html, 'a4')`.
 */

const CHIP_TONE: Record<string, string> = {
  critical: 'bad',
  off_track: 'bad',
  watch: 'warn',
  good: 'good',
  on_track: 'good',
  unknown: 'muted',
};
const SIGNAL: Record<string, { tone: string; label: string }> = {
  investigate: { tone: 'bad', label: 'Selidiki' },
  watch: { tone: 'warn', label: 'Pantau' },
  good: { tone: 'good', label: 'Baik' },
  locked: { tone: 'muted', label: 'Terkunci' },
};
const VERDICT: Record<string, { tone: string; label: string }> = {
  worked: { tone: 'good', label: 'Berhasil' },
  weak: { tone: 'warn', label: 'Lemah' },
  failed: { tone: 'bad', label: 'Gagal' },
  running: { tone: 'muted', label: 'Berjalan' },
};
const DEGRADED: Record<string, string> = {
  full_tier_not_built: 'tier penuh belum tersedia — teks dari templat',
  class_highlight: 'bagian kelas tidak memuat temuan utamanya',
  llm_unavailable: 'model lokal tidak terjangkau — teks dari templat',
};

function css(): string {
  return `
  @page { size: A4; margin: 14mm 14mm 16mm; }
  :root { --ink:#1d1d24; --muted:#6b6b78; --line:#e5e4ea; --soft:#f6f5f9; --brand:#5b54d6; --bench:#c4c2d0; --earned:#0f8a72;
          --good:#18794e; --good-bg:#e8f5ee; --warn:#a15c07; --warn-bg:#fdf3e1; --bad:#b42318; --bad-bg:#fdecea; }
  * { box-sizing: border-box; }
  body { margin:0; font: 10.5pt/1.5 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: var(--ink); background:#fff; }
  h1 { font-size: 17pt; margin: 0; letter-spacing: -0.01em; }
  h2 { font-size: 12.5pt; margin: 0 0 2px; }
  h3 { font-size: 11pt; margin: 0 0 6px; }
  p { margin: 0 0 6px; }
  .muted { color: var(--muted); }
  .badge { display:inline-block; padding: 1px 8px; border-radius: 999px; font-size: 8.5pt; font-weight: 600; background: var(--soft); color: var(--muted); margin-left: 6px; }
  .tone-good { background: var(--good-bg); color: var(--good); }
  .tone-warn { background: var(--warn-bg); color: var(--warn); }
  .tone-bad { background: var(--bad-bg); color: var(--bad); }
  .tone-muted { background: var(--soft); color: var(--muted); }
  .head { display:flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--line); padding-bottom: 10px; margin-bottom: 14px; }
  .head .asof { text-align:right; font-size: 9pt; color: var(--muted); }
  .head .asof strong { font-size: 12pt; color: var(--ink); }
  .banner { font-size: 8.5pt; color: var(--warn); background: var(--warn-bg); border-radius: 6px; padding: 6px 10px; margin-bottom: 12px; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; break-inside: avoid; }
  .verdict { display:grid; grid-template-columns: 1.5fr 1fr; gap: 14px; }
  .eyebrow { font-size: 8pt; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--brand); margin-bottom: 4px; }
  .verdict h2 { font-size: 15pt; line-height: 1.25; margin-bottom: 6px; }
  .chips { display:flex; flex-direction: column; gap: 6px; }
  .chip { background: var(--soft); border-radius: 8px; padding: 6px 10px; display:flex; justify-content: space-between; gap: 8px; align-items:center; }
  .chip .k { font-size: 8pt; color: var(--muted); }
  .chip .v { font-weight: 600; font-size: 9.5pt; }
  .actions { display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .action { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; break-inside: avoid; font-size: 9pt; }
  .action .top { display:flex; justify-content: space-between; align-items:center; margin-bottom: 6px; font-size: 8.5pt; color: var(--muted); }
  .action .langkah { font-weight: 650; font-size: 10pt; margin-bottom: 6px; }
  .action .stake { background: var(--soft); border-radius: 6px; padding: 6px 8px; margin-bottom: 6px; }
  .action .k { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .action .fail { border-top: 1px dashed var(--line); padding-top: 5px; margin-top: 5px; }
  section.sec { break-inside: avoid-page; margin-top: 4px; }
  .sec .title { display:flex; justify-content: space-between; align-items: baseline; }
  .sec .headline { font-weight: 600; margin: 2px 0 6px; }
  .chart { width: 100%; height: auto; margin: 6px 0; }
  .chart text { font-family: inherit; }
  .c-lab { font-size: 11px; fill: var(--ink); } .c-sub { font-size: 10px; fill: var(--muted); } .c-val { font-size: 11px; fill: var(--ink); font-weight: 600; }
  .c-inbar { font-size: 11px; fill: #fff; font-weight: 600; }
  .c-brand { fill: var(--brand); } .c-bench { fill: var(--bench); } .c-earned { fill: var(--earned); } .c-sub-bar { fill: #9e99e8; }
  .c-tick { stroke: var(--ink); stroke-width: 2; } .c-dot { fill: var(--brand); } .c-line { fill:none; stroke: var(--brand); stroke-width: 2; }
  .c-fit { fill:none; stroke: var(--ink); stroke-width: 1.6; } .c-knee { stroke: var(--warn); stroke-dasharray: 4 3; stroke-width: 1.5; }
  .c-kneel { font-size: 10px; fill: var(--warn); } .c-axis { stroke: var(--line); }
  .c-target { stroke: var(--muted); stroke-dasharray: 2 3; } .c-proj { stroke: var(--brand); stroke-dasharray: 5 4; stroke-width: 1.6; }
  .c-range { stroke: var(--brand); stroke-width: 6; opacity: .25; stroke-linecap: round; }
  .ratio { font-size: 9pt; margin: 2px 0; }
  .dot { display:inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: var(--bench); }
  .dot-green { background: var(--good); } .dot-yellow { background: var(--warn); } .dot-red { background: var(--bad); }
  table { width:100%; border-collapse: collapse; font-size: 9pt; margin: 6px 0; }
  th, td { text-align:left; padding: 5px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.own td { font-weight: 700; background: var(--soft); }
  .signal { display:flex; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line); }
  .signal:last-child { border-bottom: 0; }
  .signal .body { flex: 1; } .signal .t { font-weight: 600; } .signal.locked { color: var(--muted); }
  .notes { font-size: 8.5pt; color: var(--muted); margin-top: 4px; }
  footer { margin-top: 14px; border-top: 1px solid var(--line); padding-top: 6px; font-size: 8pt; color: var(--muted); }
  `;
}

const badge = (text: string, tone: string) => `<span class="badge tone-${tone}">${esc(text)}</span>`;

function header(m: StrategyReportModel): string {
  const meta = m.meta;
  const cls = `${meta.classLabel}${meta.classOverridden ? ' · ditetapkan oleh AM' : ''}`;
  return `
  <div class="head">
    <div>
      <h1>${esc(meta.brandName)} ${badge(meta.plan, 'muted')} ${badge(cls, 'muted')}</h1>
      <div class="muted">${esc([meta.vertical, meta.clientName !== meta.brandName ? meta.clientName : null].filter(Boolean).join(' · '))}</div>
    </div>
    <div class="asof">Data per <strong>${esc(idDate(meta.asOf))}</strong><br/>Periode ${esc(idDate(meta.windowStart))} – ${esc(idDate(meta.windowEnd))} · tanggal UTC<br/>Data TTMS tersedia ±3 hari setelah tanggalnya</div>
  </div>`;
}

function verdict(m: StrategyReportModel): string {
  const chips = m.verdict.chips
    .map((c) => `<div class="chip"><div><div class="k">${esc(c.label)}</div><div class="v">${esc(c.value)}</div></div>${badge(statusLabel(c.status), CHIP_TONE[c.status] ?? 'muted')}</div>`)
    .join('');
  return `
  <div class="card verdict">
    <div>
      <div class="eyebrow">Vonis minggu ini · ${esc(idDate(m.meta.windowStart))} – ${esc(idDate(m.meta.windowEnd))}</div>
      <h2>${esc(m.verdict.headline)}</h2>
      <p>${esc(m.verdict.paragraph)}</p>
    </div>
    <div class="chips">${chips}</div>
  </div>`;
}

function statusLabel(s: string): string {
  return ({ critical: 'Kritis', off_track: 'Meleset', watch: 'Pantau', good: 'Baik', on_track: 'Sesuai jalur', unknown: '—' } as Record<string, string>)[s] ?? s;
}

function action(a: ActionRowModel): string {
  const tone = a.priority === 'P0' ? 'bad' : a.priority === 'P1' ? 'warn' : 'muted';
  return `
  <div class="action">
    <div class="top"><span>Keputusan ${a.rank} · ${esc(a.leverLabel)}</span>${badge(a.priority, tone)}</div>
    <div class="langkah">${esc(a.langkah)}</div>
    ${a.stake ? `<div class="stake"><div class="k">Taruhan</div>${esc(a.stake)}</div>` : ''}
    <div>${badge(a.confidenceLabel, 'muted')}</div>
    <p style="margin-top:6px"><span class="k">Dasar</span><br/>${esc(a.dasar)}</p>
    <p><span class="k">Cara</span><br/>${esc(a.cara)}</p>
    <div class="fail"><span class="k">Gagal jika</span><br/>${esc(a.gagalJika)}</div>
    <div class="notes">${esc(a.sources)}</div>
  </div>`;
}

function visual(s: StrategySectionModel): string {
  const v = s.visual;
  if (!v) return '';
  if (v.kind === 'funnel') {
    const ratios = v.bars
      .slice(0, -1)
      .map((b, i) =>
        b.ratio != null
          ? `<div class="ratio"><span class="dot dot-${b.light === 'none' ? 'none' : b.light}"></span>Ukuran ${esc(v.bars[i + 1]!.stage)} dibanding ${esc(b.stage)}: <strong>${esc(pct(b.ratio))}</strong> · Top 10 ${esc(pct(b.benchRatio))}</div>`
          : '',
      )
      .join('');
    return funnelChart(v.bars) + ratios;
  }
  if (v.kind === 'spend') return spendChart(v.chart);
  if (v.kind === 'rank') return rankChart(v.chart);
  if (v.kind === 'mix') return mixChart(v.mix);
  const rows = v.rows
    .map((r) => `<tr class="${r.own ? 'own' : ''}"><td class="num">#${r.rank}</td><td>${esc(r.brand)}</td><td class="num">${esc(r.movement)}</td></tr>`)
    .join('');
  return `<table><thead><tr><th>Peringkat ${esc(v.stageLabel)}</th><th>Merek${v.n ? ` (dari ${num(v.n)})` : ''}</th><th>vs 7 hari lalu</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function section(s: StrategySectionModel): string {
  const signals = s.signals
    .map((x) => {
      const t = SIGNAL[x.status] ?? { tone: 'muted', label: x.status };
      return `<div class="signal ${x.status === 'locked' ? 'locked' : ''}"><div class="body"><div class="t">${esc(x.title)}</div><div>${esc(x.detail)}</div></div>${badge(t.label, t.tone)}</div>`;
    })
    .join('');
  const log = s.log.length
    ? `<table><thead><tr><th>Mulai</th><th>Tindakan</th><th>Hasil terukur</th><th>Kategori, periode sama</th><th>Vonis</th></tr></thead><tbody>${s.log
        .map((l) => {
          const v = VERDICT[l.verdict] ?? { tone: 'muted', label: l.verdict };
          return `<tr><td>${esc(l.startedAt)}</td><td>${esc(l.langkah)}</td><td class="num">${esc(l.measured)}</td><td class="num">${esc(l.category)}</td><td>${badge(v.label, v.tone)}</td></tr>`;
        })
        .join('')}</tbody></table>`
    : '';
  const table = s.table
    ? `<table><thead><tr>${s.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${s.table.rows
        .map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`
    : '';
  const paras = s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
  return `
  <section class="card sec" data-section="${s.id}">
    <div class="title"><h3>${esc(s.title)}</h3><span class="muted" style="font-size:8pt">${esc(s.key)}</span></div>
    ${s.headline ? `<div class="headline">${esc(s.headline)}</div>` : ''}
    ${visual(s)}
    ${paras}
    ${signals}${log}${table}
    ${s.notes.map((n) => `<div class="notes">${esc(n)}</div>`).join('')}
  </section>`;
}

export function renderStrategyReportHtml(m: StrategyReportModel): string {
  const meta = m.meta;
  const banner = meta.degraded.length
    ? `<div class="banner">Catatan: ${esc(meta.degraded.map((d) => DEGRADED[d] ?? d).join('; '))}.</div>`
    : '';
  const tierLabel = meta.tier === 'full' ? 'tier penuh (agen + model lokal)' : 'tier instan (templat, tanpa model)';
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"/><title>${esc(meta.brandName)} — Tempo Strategy Report</title><style>${css()}</style></head>
<body>
  ${header(m)}
  ${banner}
  ${verdict(m)}
  <div class="card">
    <h3>Keputusan minggu ini</h3>
    <p class="muted" style="font-size:9pt">Diurutkan menurut taruhan. Setiap keputusan menyebut besarnya, seberapa yakin Tempo, dan hasil apa yang membuktikannya salah.</p>
    ${m.actions.length ? `<div class="actions">${m.actions.map(action).join('')}</div>` : '<p>Tidak ada keputusan yang cukup kuat untuk diusulkan dari data periode ini.</p>'}
  </div>
  ${m.sections.map(section).join('')}
  <footer>Tempo Strategy Report · ${esc(tierLabel)} · run ${esc(meta.runId ?? '—')} · engine ${esc(meta.engineVersion)}${meta.promptVersion ? ` · prompt ${esc(meta.promptVersion)}` : ''} · data TikTok Market Scope + TikTok Ads</footer>
</body></html>`;
}
