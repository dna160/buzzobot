import {
  formatCurrencyCompact,
  formatNumberCompact,
  formatPercent,
  type Currency,
} from '@tempo/core';
import type { CampaignBreakdown, HourPoint, Totals } from '@tempo/db';
import { comboChart, multiLineChart, rankChart } from './charts.js';
import type { HourlyReportModel, HourlyReportDay } from './hourly-model.js';
import type { Finding } from './hourly-analysis.js';
import type { ReportCopy } from './i18n.js';
import {
  ENG_COLOR,
  MUTED_COLOR,
  PAID_COLOR,
  callout,
  chartCard,
  cover,
  entityCards,
  esc,
  hourLabel,
  kpiRow,
  legend,
  prose,
  riskCards,
  sectionTitle,
  shortDate,
  styles,
} from './layout.js';

/**
 * Render the intraday report as a narrative deliverable.
 *
 * Each section follows the same shape — a visual, a named finding, then the
 * analyst reading of it — and the document closes on a prioritized action plan
 * and an outlook, so a reader ends with decisions rather than numbers. The
 * hour-by-hour tables live in an appendix at the back for anyone who wants to
 * audit the figures.
 *
 * Self-contained HTML: inline styles, inline SVG, no network, no JS.
 */
export function renderHourlyReportHtml(model: HourlyReportModel): string {
  const { client, copy } = model;
  const h = copy.hourly;
  const cur = client.currency as Currency;
  const brand = client.brandColor ?? '#0FA79A';
  const money = (v: number) => formatCurrencyCompact(Math.round(v), cur);
  const na = `<span class="na">${esc(h.notReported)}</span>`;
  const ratio = (v: number | null, fmt: (n: number) => string) => (v === null ? na : esc(fmt(v)));
  // The narrative is already resolved on the model (LLM or deterministic);
  // the renderer treats both identically.
  const a = model.narrative.narrative;

  const cmp = model.comparison;
  const caption = cmp ? `${cmp.label}` : undefined;

  return `<!doctype html>
<html lang="${copy.locale}">
<head>
<meta charset="utf-8"/>
<title>${esc(client.name)} — ${esc(h.subtitle)}</title>
<style>${styles(brand)}</style>
</head>
<body>
  ${cover({
    clientName: client.name,
    subtitle: h.subtitle,
    periodKey: h.cover.period,
    periodValue: model.periodLabel,
    preparedForKey: h.cover.preparedFor,
    generatedLabel: model.generatedLabel,
    brand,
  })}

  <section class="sheet">
    ${sectionTitle('01', h.sections.summary)}
    <p class="lede">${esc(a.headline)}</p>
    ${kpiRow([
      { label: h.stat.impressions, value: formatNumberCompact(model.windowTotals.impressions), delta: cmp?.deltas.impressions, goodDirection: 'up', caption },
      { label: h.stat.reach, value: formatNumberCompact(model.windowTotals.reach), delta: cmp?.deltas.reach, goodDirection: 'up', caption },
      { label: h.stat.vtr6s, value: model.windowTotals.vtr6s === null ? h.notReported : formatPercent(model.windowTotals.vtr6s), delta: cmp?.deltas.vtr6s, goodDirection: 'up', caption },
      { label: h.stat.vtr15s, value: model.windowTotals.vtr15s === null ? h.notReported : formatPercent(model.windowTotals.vtr15s), delta: cmp?.deltas.vtr15s, goodDirection: 'up', caption },
    ])}
    ${kpiRow([
      { label: h.stat.frequency, value: model.windowTotals.frequency === null ? h.notReported : `${model.windowTotals.frequency.toFixed(1)}×` },
      { label: h.stat.spend, value: money(model.windowTotals.spend), delta: cmp?.deltas.spend, goodDirection: 'neutral', caption },
      { label: h.stat.hours, value: String(model.totalHours) },
      { label: h.table.campaign, value: String(model.campaigns.length) },
    ])}
    ${dailyTrendCard(model, copy, cur)}
    ${prose([a.summaryProse])}
  </section>

  <section class="sheet">
    ${sectionTitle('02', h.sections.pattern)}
    ${pacingCard(model.focus, copy)}
    ${deliveryCard(model.focus, copy)}
    ${a.daypart ? findingBlock(a.daypart.finding, a.daypart.prose) : ''}
  </section>

  <section class="sheet">
    ${sectionTitle('03', h.sections.efficiency)}
    ${efficiencyCard(model.focus, copy, cur)}
    ${a.efficiency ? findingBlock(a.efficiency.finding, a.efficiency.prose) : ''}
    ${bestWorstTable(model.focus, copy, ratio, money)}
  </section>

  ${a.mix ? `<section class="sheet">
    ${sectionTitle('04', h.sections.campaigns)}
    ${chartCard(
      h.sections.campaigns,
      rankChart(
        model.campaigns.map((c) => ({
          label: c.name,
          value: c.totals.spend,
          note: `${formatPercent(c.totals.spend / Math.max(1, model.windowTotals.spend), 0)} · CPM ${
            c.totals.cpm === null ? h.notReported : money(c.totals.cpm)
          }`,
        })),
        { format: money },
      ),
      '',
    )}
    ${findingBlock(a.mix.finding, a.mix.prose)}
    ${campaignTable(model.campaigns, copy, ratio, money, false)}
  </section>` : ''}

  ${a.adgroup ? `<section class="sheet">
    ${sectionTitle('05', h.sections.adgroups)}
    ${adgroupCards(model.campaigns, copy, money)}
    ${findingBlock(a.adgroup.finding, a.adgroup.prose)}
  </section>` : ''}

  <section class="sheet">
    ${sectionTitle('06', h.sections.quality)}
    ${callout(a.dataGap.title, a.dataGap.body, a.dataGap.tone)}
    ${coverageTable(model, copy)}
    ${prose([h.appendixNote])}
  </section>

  <section class="sheet">
    ${sectionTitle('07', h.sections.risks)}
    ${riskCards(
      a.risks.map((r) => ({ ...r, severityLabel: h.severity[r.severity] })),
      h.ownerLabel,
    )}
  </section>

  <section class="sheet">
    ${sectionTitle('08', h.sections.outlook)}
    ${prose(a.outlook)}
    <div class="confidence">
      <span class="conf-label">${esc(h.confidenceLabel)}</span>
      <span class="conf-pill conf-${a.confidence.toLowerCase()}">${esc(h.confidence[a.confidence])}</span>
      <span class="muted small">${esc(h.coverage.hoursCounted({ hours: model.totalHours, days: model.days.length }))}</span>
    </div>
    ${provenance(model, copy)}
  </section>

  <section class="sheet">
    ${sectionTitle('09', h.sections.appendix)}
    <p class="muted small" style="margin-bottom:14px">${esc(h.appendixNote)}</p>
    ${model.days.map((d) => appendixDay(d, copy, ratio, money)).join('')}
  </section>
</body>
</html>`;
}

// --- Section helpers --------------------------------------------------------

/**
 * States how the prose was produced. A reader deserves to know whether the
 * analysis was written by a model or by the rule-based fallback, and — when the
 * model was tried and rejected — that a fallback occurred at all.
 */
function provenance(model: HourlyReportModel, copy: ReportCopy): string {
  const n = model.narrative;
  const h = copy.hourly;
  const line =
    n.source === 'llm'
      ? h.provenance.llm({ model: n.model ?? 'model', provider: n.provider ?? '' })
      : n.fallbackReason
        ? h.provenance.fallback({ reason: n.fallbackReason })
        : h.provenance.deterministic;
  return `<p class="muted small" style="margin-top:10px">${esc(line)}</p>`;
}

const findingBlock = (f: Finding, body: string): string =>
  `${callout(f.title, f.body, f.tone)}${prose([body])}`;

/** Daily totals across the window — the "is the trend up or down" view. */
function dailyTrendCard(model: HourlyReportModel, copy: ReportCopy, cur: Currency): string {
  const h = copy.hourly;
  const svg = comboChart(
    model.days.map((d) => ({
      label: shortDate(d.date, copy),
      bar: d.totals.spend,
      line: d.totals.clicks,
    })),
    {
      formatBar: (v) => formatCurrencyCompact(Math.round(v), cur),
      formatLine: (v) => formatNumberCompact(v),
      barColor: PAID_COLOR,
      lineColor: ENG_COLOR,
      maxXLabels: 10,
    },
  );
  return chartCard(
    `${h.stat.spend} · ${h.stat.clicks}`,
    svg,
    legend([
      [h.stat.spend, PAID_COLOR, 'bar'],
      [h.stat.clicks, ENG_COLOR, 'line'],
    ]),
  );
}

function pacingCard(day: HourlyReportDay, copy: ReportCopy): string {
  const h = copy.hourly;
  const svg = multiLineChart(
    [
      { points: day.pacing.map((p) => ({ label: hourLabel(p.hour), value: p.share })), color: PAID_COLOR },
      {
        points: day.pacing.map((p) => ({ label: hourLabel(p.hour), value: p.evenShare })),
        color: MUTED_COLOR,
        dashed: true,
      },
    ],
    { format: (v) => formatPercent(v, 0), max: 1 },
  );
  return chartCard(
    `${h.chart.pacingTitle} — ${shortDate(day.date, copy)}`,
    svg,
    legend([
      [h.chart.delivered, PAID_COLOR, 'line'],
      [h.chart.evenPace, MUTED_COLOR, 'line'],
    ]),
  );
}

/** The headline chart: impressions (bars) against the 6-second VTR (line). */
function deliveryCard(day: HourlyReportDay, copy: ReportCopy): string {
  const h = copy.hourly;
  const svg = comboChart(
    day.hours.map((x) => ({ label: hourLabel(x.hour), bar: x.impressions, line: x.vtr6s ?? 0 })),
    {
      formatBar: (v) => formatNumberCompact(v),
      formatLine: (v) => formatPercent(v, 1),
      barColor: PAID_COLOR,
      lineColor: ENG_COLOR,
      maxXLabels: 8,
    },
  );
  return chartCard(
    `${h.chart.deliveryTitle} — ${shortDate(day.date, copy)}`,
    svg,
    legend([
      [h.chart.impressions, PAID_COLOR, 'bar'],
      [h.chart.vtr6s, ENG_COLOR, 'line'],
    ]),
  );
}

/** View quality: the 6s and 15s view-through rates side by side, by hour. */
function efficiencyCard(day: HourlyReportDay, copy: ReportCopy, _cur: Currency): string {
  const h = copy.hourly;
  const pts = day.hours.filter((x) => x.impressions > 0);
  const svg = multiLineChart(
    [
      { points: pts.map((x) => ({ label: hourLabel(x.hour), value: x.vtr6s })), color: PAID_COLOR },
      { points: pts.map((x) => ({ label: hourLabel(x.hour), value: x.vtr15s })), color: ENG_COLOR },
    ],
    { format: (v) => formatPercent(v, 1) },
  );
  return chartCard(
    `${h.chart.vtrTitle} — ${shortDate(day.date, copy)}`,
    svg,
    legend([
      [h.chart.vtr6s, PAID_COLOR, 'line'],
      [h.chart.vtr15s, ENG_COLOR, 'line'],
    ]),
  );
}

/** The three cheapest and three dearest hours, side by side. */
function bestWorstTable(
  day: HourlyReportDay,
  copy: ReportCopy,
  ratio: (v: number | null, fmt: (n: number) => string) => string,
  money: (v: number) => string,
): string {
  const h = copy.hourly;
  const priced = day.hours.filter((x) => x.cpc !== null && x.clicks >= 20);
  if (priced.length < 4) return '';
  const sorted = [...priced].sort((a, b) => (a.cpc ?? 0) - (b.cpc ?? 0));
  const pick = [...sorted.slice(0, 3), ...sorted.slice(-3).reverse()];

  const row = (x: HourPoint, rank: 'best' | 'worst') => `<tr>
      <td>${esc(hourLabel(x.hour))}</td>
      <td class="num">${esc(money(x.spend))}</td>
      <td class="num">${esc(formatNumberCompact(x.clicks))}</td>
      <td class="num">${ratio(x.ctr, (v) => formatPercent(v))}</td>
      <td class="num strong">${ratio(x.cpc, money)}</td>
      <td class="num">${ratio(x.cpm, money)}</td>
      <td><span class="sev sev-${rank === 'best' ? 'low' : 'medium'}">${esc(
        rank === 'best' ? h.rankLabel.cheapest : h.rankLabel.dearest,
      )}</span></td>
    </tr>`;

  return `<table class="data">
    <thead><tr>
      <th>${esc(h.table.hour)}</th>
      <th class="num">${esc(h.table.spend)}</th>
      <th class="num">${esc(h.table.clicks)}</th>
      <th class="num">${esc(h.table.ctr)}</th>
      <th class="num">${esc(h.table.cpc)}</th>
      <th class="num">${esc(h.table.cpm)}</th>
      <th></th>
    </tr></thead>
    <tbody>${pick.map((x, i) => row(x, i < 3 ? 'best' : 'worst')).join('')}</tbody>
  </table>`;
}

/** Below this, a cost-per-click figure is too noisy to stand unqualified. */
const MIN_CLICKS_FOR_CPC = 100;

function adgroupCards(
  campaigns: CampaignBreakdown[],
  copy: ReportCopy,
  money: (v: number) => string,
): string {
  const h = copy.hourly;
  const rows = campaigns
    .flatMap((c) => c.adgroups.map((ag) => ({ ag, campaign: c.name })))
    .sort((a, b) => b.ag.totals.spend - a.ag.totals.spend)
    .slice(0, 8);

  let anyLowVolume = false;
  const items = rows.map(({ ag, campaign }) => {
    // A CPC computed over a handful of clicks is arithmetically real but
    // statistically meaningless. Show it, and mark it, rather than letting it
    // read as a solid figure next to ones backed by thousands of clicks.
    const lowVolume = ag.totals.cpc !== null && ag.totals.clicks < MIN_CLICKS_FOR_CPC;
    if (lowVolume) anyLowVolume = true;
    return {
      name: ag.name,
      sub: campaign,
      metrics: [
        { label: h.stat.spend, value: money(ag.totals.spend) },
        { label: h.stat.clicks, value: formatNumberCompact(ag.totals.clicks) },
        {
          label: h.stat.ctr,
          value: ag.totals.ctr === null ? h.notReported : formatPercent(ag.totals.ctr),
        },
        {
          label: h.stat.cpc,
          value:
            ag.totals.cpc === null
              ? h.notReported
              : `${money(ag.totals.cpc)}${lowVolume ? ' *' : ''}`,
        },
      ],
    };
  });

  return `${entityCards(items)}${
    anyLowVolume
      ? `<p class="muted small" style="margin-top:8px">${esc(
          h.lowVolumeNote({ min: MIN_CLICKS_FOR_CPC }),
        )}</p>`
      : ''
  }`;
}

function coverageTable(model: HourlyReportModel, copy: ReportCopy): string {
  const h = copy.hourly;
  return `<table class="data">
    <thead><tr>
      <th>${esc(h.cover.period)}</th>
      <th class="num">${esc(h.stat.hours)}</th>
      <th class="num">${esc(h.table.spend)}</th>
      <th>${esc(h.coverageTitle)}</th>
    </tr></thead>
    <tbody>${model.days
      .map((d) => {
        const notes: string[] = [];
        const material = d.coverage.aggregatedHours.filter((x) => x.spanHours >= 3);
        if (material.length) {
          notes.push(material.map((x) => `${hourLabel(x.hour)} (${x.spanHours}h)`).join(', '));
        }
        if (!d.coverage.isComplete && d.coverage.lastHour !== null) {
          notes.push(`→ ${hourLabel(d.coverage.lastHour)}`);
        }
        return `<tr>
          <td class="strong">${esc(shortDate(d.date, copy))}</td>
          <td class="num">${d.hours.length}</td>
          <td class="num">${esc(
            formatCurrencyCompact(Math.round(d.totals.spend), model.client.currency as Currency),
          )}</td>
          <td class="muted">${esc(notes.join(' · ') || '—')}</td>
        </tr>`;
      })
      .join('')}</tbody>
  </table>`;
}

// --- Tables -----------------------------------------------------------------

function campaignTable(
  campaigns: CampaignBreakdown[],
  copy: ReportCopy,
  ratio: (v: number | null, fmt: (n: number) => string) => string,
  money: (v: number) => string,
  withAdgroups = true,
): string {
  const h = copy.hourly;
  const t = h.table;
  const row = (
    name: string,
    totals: Totals,
    opts: { child?: boolean; objective?: string } = {},
  ) => `<tr>
      <td class="${opts.child ? '' : 'strong'}">${opts.child ? '<span class="muted">└ </span>' : ''}${esc(name)}${
        opts.objective
          ? `<span class="obj">${esc(copy.objective[opts.objective] ?? opts.objective)}</span>`
          : ''
      }</td>
      <td class="num">${esc(money(totals.spend))}</td>
      <td class="num">${esc(formatNumberCompact(totals.impressions))}</td>
      <td class="num">${esc(formatNumberCompact(totals.clicks))}</td>
      <td class="num">${ratio(totals.ctr, (v) => formatPercent(v))}</td>
      <td class="num">${ratio(totals.cpc, money)}</td>
      <td class="num">${ratio(totals.cpm, money)}</td>
    </tr>`;

  return `<table class="data">
    <thead><tr>
      <th>${esc(t.campaign)}</th>
      <th class="num">${esc(t.spend)}</th>
      <th class="num">${esc(t.impressions)}</th>
      <th class="num">${esc(t.clicks)}</th>
      <th class="num">${esc(t.ctr)}</th>
      <th class="num">${esc(t.cpc)}</th>
      <th class="num">${esc(t.cpm)}</th>
    </tr></thead>
    <tbody>${campaigns
      .map(
        (c) =>
          row(c.name, c.totals, { objective: c.objective }) +
          (withAdgroups
            ? c.adgroups.map((ag) => row(ag.name, ag.totals, { child: true })).join('')
            : ''),
      )
      .join('')}</tbody>
  </table>`;
}

function appendixDay(
  day: HourlyReportDay,
  copy: ReportCopy,
  ratio: (v: number | null, fmt: (n: number) => string) => string,
  money: (v: number) => string,
): string {
  const h = copy.hourly;
  const t = h.table;
  if (day.hours.length === 0) return '';

  const peak = day.hours.reduce<HourPoint | null>(
    (best, x) => (best === null || x.spend > best.spend ? x : best),
    null,
  );

  const totalRow = day.hours.reduce(
    (acc, x) => {
      acc.spend += x.spend;
      acc.impressions += x.impressions;
      acc.clicks += x.clicks;
      return acc;
    },
    { spend: 0, impressions: 0, clicks: 0 },
  );
  // Footer ratios pooled from the column sums, matching the read-model's rule.
  const footCtr = totalRow.impressions > 0 ? totalRow.clicks / totalRow.impressions : null;
  const footCpc = totalRow.clicks > 0 ? totalRow.spend / totalRow.clicks : null;
  const footCpm = totalRow.impressions > 0 ? (totalRow.spend / totalRow.impressions) * 1000 : null;

  return `<div class="appendix-day">
    <h3>${esc(shortDate(day.date, copy))}</h3>
    <div class="sub">${esc(
      h.appendixDaySub({
        first: hourLabel(day.hours[0]!.hour),
        last: hourLabel(day.hours[day.hours.length - 1]!.hour),
        hours: day.hours.length,
      }),
    )}</div>
    <table class="hours">
      <thead><tr>
        <th>${esc(t.hour)}</th>
        <th>${esc(t.spend)}</th>
        <th>${esc(t.impressions)}</th>
        <th>${esc(t.clicks)}</th>
        <th>${esc(t.ctr)}</th>
        <th>${esc(t.cpc)}</th>
        <th>${esc(t.cpm)}</th>
      </tr></thead>
      <tbody>${day.hours
        .map(
          (x) => `<tr${peak && x.hour === peak.hour ? ' class="peak"' : ''}>
          <td>${esc(hourLabel(x.hour))}</td>
          <td>${esc(money(x.spend))}</td>
          <td>${esc(formatNumberCompact(x.impressions))}</td>
          <td>${esc(formatNumberCompact(x.clicks))}</td>
          <td>${ratio(x.ctr, (v) => formatPercent(v))}</td>
          <td>${ratio(x.cpc, money)}</td>
          <td>${ratio(x.cpm, money)}</td>
        </tr>`,
        )
        .join('')}</tbody>
      <tfoot><tr>
        <td>${esc(t.total)}</td>
        <td>${esc(money(totalRow.spend))}</td>
        <td>${esc(formatNumberCompact(totalRow.impressions))}</td>
        <td>${esc(formatNumberCompact(totalRow.clicks))}</td>
        <td>${ratio(footCtr, (v) => formatPercent(v))}</td>
        <td>${ratio(footCpc, money)}</td>
        <td>${ratio(footCpm, money)}</td>
      </tr></tfoot>
    </table>
  </div>`;
}
