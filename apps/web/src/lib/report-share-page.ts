import type { ClientSummary } from '@tempo/db';
import { esc, formatIdDate, type ReportDateRange } from '@tempo/reports';
import { SHARE_MAX_RANGE_DAYS } from '@/lib/report-share';

/**
 * The page behind a shared report link (`/r/:token`), as one self-contained
 * HTML string — the same way the reports themselves are rendered.
 *
 * Deliberately not a React page: no app shell (whose sidebar lists every
 * client), no `/_next/*` bundle, no font CDN. Tempo is internal, so a link a
 * brand opens means exposing a path to the outside, and this keeps that path
 * to `/r/*` and nothing else. The report is shown in a script-less sandboxed
 * iframe so its own `<style>` never meets the page's.
 */

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** The last `count` months up to the one `latestDay` is in, newest first — the month picker's options. */
function monthOptions(latestDay: string, count: number): Array<{ value: string; label: string }> {
  const [y, m] = latestDay.split('-').map(Number);
  const out: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(y!, m! - 1 - i, 1));
    out.push({
      value: d.toISOString().slice(0, 7),
      label: `${MONTHS_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    });
  }
  return out;
}

/** JSON safe to drop inside a <script> — a client name containing "</script>" stays inert. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const STYLES = (accent: string) => `
  :root { --accent: ${accent}; --ink: #18181b; --muted: #71717a; --line: #e4e4e7; --bg: #f4f4f5; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .bar { background: #fff; border-bottom: 1px solid var(--line); }
  .wrap { max-width: 960px; margin: 0 auto; padding: 16px; }
  h1 { margin: 0; font-size: 18px; }
  .sub { margin: 2px 0 0; color: var(--muted); font-size: 12.5px; }
  .controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; margin-top: 14px; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .seg button { border: 0; background: #fff; padding: 7px 14px; font: inherit; cursor: pointer; color: var(--muted); }
  .seg button[aria-pressed="true"] { background: var(--accent); color: #fff; }
  label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); }
  select, input[type="date"] { font: inherit; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; background: #fff; color: var(--ink); }
  .apply { border: 0; border-radius: 9px; padding: 8px 16px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  .apply:disabled { opacity: .5; cursor: default; }
  .pdf { margin-left: auto; color: var(--accent); font-weight: 600; text-decoration: none; padding: 8px 4px; }
  [hidden] { display: none !important; }
  .state { margin: 16px auto; max-width: 960px; padding: 0 16px; }
  .note { background: #fff; border: 1px dashed var(--line); border-radius: 12px; padding: 28px 16px;
    text-align: center; color: var(--muted); }
  .note.err { border: 1px solid #fecaca; background: #fef2f2; color: #b91c1c; }
  .note button { margin-top: 10px; }
  .spin { display: inline-block; width: 14px; height: 14px; margin-right: 8px; vertical-align: -2px;
    border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: s 0.8s linear infinite; }
  @keyframes s { to { transform: rotate(360deg); } }
  .frame { max-width: 960px; margin: 0 auto 32px; padding: 0 16px; }
  iframe { display: block; width: 100%; min-height: 70vh; border: 1px solid var(--line); border-radius: 12px; background: #fff; }
`;

/** Runs in the viewer's browser. Plain ES2017, no dependencies. */
const SCRIPT = `
(function () {
  var C = JSON.parse(document.getElementById('cfg').textContent);
  var MONTHS = ${scriptJson(MONTHS_ID)};
  var $ = function (id) { return document.getElementById(id); };
  var mode = 'month', seq = 0;

  function lastOfMonth(ym) {
    var p = ym.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1], 0)).toISOString().slice(0, 10);
  }
  function monthRange(ym) {
    var to = lastOfMonth(ym);
    return { from: ym + '-01', to: to < C.latestDay ? to : C.latestDay };
  }
  function idDate(iso) {
    var p = iso.split('-').map(Number);
    return p[2] + ' ' + MONTHS[p[1] - 1] + ' ' + p[0];
  }
  function days(r) { return Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1; }
  function issue(r) {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(r.from) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(r.to)) return 'Pilih tanggal mulai dan selesai.';
    if (r.from > r.to) return 'Tanggal mulai harus sebelum tanggal selesai.';
    if (r.to > C.latestDay) return 'Data tersedia sampai ' + idDate(C.latestDay) + '.';
    if (days(r) > C.maxDays) return 'Rentang maksimal ' + C.maxDays + ' hari.';
    return null;
  }
  function picked() {
    return mode === 'month' ? monthRange($('month').value) : { from: $('from').value, to: $('to').value };
  }
  function setMode(m) {
    mode = m;
    $('mode-month').setAttribute('aria-pressed', String(m === 'month'));
    $('mode-custom').setAttribute('aria-pressed', String(m === 'custom'));
    $('month-field').hidden = m !== 'month';
    $('custom-fields').hidden = m !== 'custom';
    $('range-issue').textContent = '';
  }
  function show(kind, text, retry) {
    $('frame').hidden = kind !== 'ready';
    $('state').hidden = kind === 'ready';
    if (kind === 'ready') return;
    var note = $('note');
    note.className = 'note' + (kind === 'error' ? ' err' : '');
    note.innerHTML = '';
    if (kind === 'loading') { var s = document.createElement('span'); s.className = 'spin'; note.appendChild(s); }
    note.appendChild(document.createTextNode(text));
    if (retry) {
      var b = document.createElement('button');
      b.className = 'apply'; b.type = 'button'; b.textContent = 'Coba lagi';
      b.onclick = retry;
      note.appendChild(document.createElement('br'));
      note.appendChild(b);
    }
  }
  function reportUrl(r, extra) {
    return '/r/' + encodeURIComponent(C.token) + '/report?from=' + r.from + '&to=' + r.to + (extra || '');
  }

  function load(r) {
    var my = ++seq, started = Date.now();
    $('period').textContent = idDate(r.from) + ' \\u2013 ' + idDate(r.to);
    $('pdf').hidden = true;
    var waiting = 'Laporan sedang disusun \\u2014 biasanya 1\\u20133 menit untuk periode yang belum pernah dibuat.';
    show('loading', waiting);

    function handle(res) {
      if (my !== seq) return;
      return res.json().catch(function () { return null; }).then(function (body) {
        if (my !== seq) return;
        if (!body) return poll();                       // a gateway page, not ours: keep waiting
        if (body.status === 'ready') {
          $('frame-el').srcdoc = body.html;
          $('pdf').href = reportUrl(r, '&format=pdf');
          $('pdf').hidden = false;
          return show('ready');
        }
        if (body.status === 'running') return poll();
        if (body.status === 'idle') return start();
        if (body.status === 'busy') return show('error', 'Laporan lain untuk brand ini sedang disusun. Coba lagi sebentar lagi.', function () { load(r); });
        if (body.status === 'failed') return show('error', body.message, function () { load(r); });
        if (body.status === 'not_found') return show('error', body.message);
        if (body.status === 'invalid') return show('error', 'Periode tidak valid: ' + body.message);
        return poll();
      });
    }
    function poll() {
      if (Date.now() - started > 12 * 60000) {
        return show('error', 'Laporan belum selesai disusun. Coba buka lagi beberapa menit lagi.', function () { load(r); });
      }
      setTimeout(function () {
        if (my !== seq) return;
        fetch(reportUrl(r, '&wait=1'), { cache: 'no-store' }).then(handle, poll);
      }, 5000);
    }
    function start() {
      // A proxy may cut this long request before it answers; the generation
      // carries on server-side, so a dropped connection just means "poll".
      fetch(reportUrl(r), { cache: 'no-store' }).then(handle, poll);
    }
    start();
  }

  function apply(push) {
    var r = picked(), problem = issue(r);
    $('range-issue').textContent = problem || '';
    if (problem) return;
    var q = '?from=' + r.from + '&to=' + r.to;
    if (push) history.pushState(r, '', q); else history.replaceState(r, '', q);
    load(r);
  }
  function fill(r) {
    var mr = monthRange(r.from.slice(0, 7));
    var isMonth = mr.from === r.from && mr.to === r.to && $('month').querySelector('option[value="' + r.from.slice(0, 7) + '"]');
    if (isMonth) $('month').value = r.from.slice(0, 7);
    $('from').value = r.from; $('to').value = r.to;
    setMode(isMonth ? 'month' : 'custom');
  }

  $('mode-month').onclick = function () { setMode('month'); };
  $('mode-custom').onclick = function () { setMode('custom'); };
  $('apply').onclick = function () { apply(true); };
  $('frame-el').onload = function () {
    try { this.style.height = this.contentDocument.documentElement.scrollHeight + 'px'; } catch (e) { /* sizing is cosmetic */ }
  };
  window.onpopstate = function (e) { if (e.state) { fill(e.state); load(e.state); } };

  fill(C.range);
  if (C.issue) { $('range-issue').textContent = 'Periode di tautan tidak valid (' + C.issue + ') \\u2014 menampilkan periode bawaan.'; }
  apply(false);
})();
`;

export function renderSharePage(input: {
  token: string;
  client: ClientSummary;
  latestDay: string;
  range: ReportDateRange;
  issue: string | null;
}): string {
  const { token, client, latestDay, range, issue } = input;
  const accent = client.brandColor && /^#[0-9a-f]{3,8}$/i.test(client.brandColor) ? client.brandColor : '#4f46e5';
  const cfg = { token, latestDay, maxDays: SHARE_MAX_RANGE_DAYS, range, issue };
  const options = monthOptions(latestDay, 24)
    .map((o) => `<option value="${o.value}">${esc(o.label)}</option>`)
    .join('');

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(client.name)} · TikTok Ads Performance Report</title>
<style>${STYLES(accent)}</style>
</head>
<body>
<div class="bar"><div class="wrap">
  <h1>${esc(client.name)}</h1>
  <p class="sub">TikTok Ads Performance Report · <span id="period">${esc(formatIdDate(range.from))} – ${esc(formatIdDate(range.to))}</span></p>
  <div class="controls">
    <div class="seg" role="group" aria-label="Jenis periode">
      <button type="button" id="mode-month" aria-pressed="true">Bulanan</button>
      <button type="button" id="mode-custom" aria-pressed="false">Rentang tanggal</button>
    </div>
    <label id="month-field">Bulan<select id="month">${options}</select></label>
    <span id="custom-fields" hidden style="display:inline-flex;flex-wrap:wrap;gap:10px">
      <label>Dari<input type="date" id="from" max="${latestDay}"></label>
      <label>Sampai<input type="date" id="to" max="${latestDay}"></label>
    </span>
    <button type="button" class="apply" id="apply">Tampilkan</button>
    <a class="pdf" id="pdf" hidden>Unduh PDF</a>
  </div>
  <p class="sub" id="range-issue" role="alert"></p>
</div></div>
<div class="state" id="state"><div class="note" id="note">Memuat…</div></div>
<div class="frame" id="frame" hidden>
  <iframe id="frame-el" title="Laporan" sandbox="allow-same-origin"></iframe>
</div>
<script type="application/json" id="cfg">${scriptJson(cfg)}</script>
<script>${SCRIPT}</script>
</body>
</html>`;
}

/** What an unknown or revoked token gets — says nothing about which clients exist. */
export function renderShareNotFound(): string {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Link tidak ditemukan</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#f4f4f5;color:#18181b;font:14px/1.5 system-ui,sans-serif}
div{max-width:420px;padding:24px;text-align:center}h1{font-size:18px;margin:0 0 6px}p{color:#71717a;margin:0}</style></head>
<body><div><h1>Link tidak ditemukan</h1><p>Link laporan ini tidak valid atau sudah dicabut. Minta link terbaru dari tim Buzzohero.</p></div></body></html>`;
}
