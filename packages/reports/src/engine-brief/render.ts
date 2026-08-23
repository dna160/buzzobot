import { formatCurrencyCompact, formatNumberCompact, formatPercent, NorthStar, type Currency } from '@tempo/core';
import type { CampaignWindowRow, DailyBriefDashboardData, ClientSummary } from '@tempo/db';
import { comboChart, rankChart } from '../charts.js';
import {
  callout,
  chartCard,
  cover,
  esc,
  kpiRow,
  legend,
  prose,
  riskCards,
  sectionTitle,
  styles,
  PAID_COLOR,
  ENG_COLOR,
  type RiskCard,
} from '../layout.js';
import { BriefObjective, type BriefObjective as BriefObjectiveType } from '../brief-objective.js';

/**
 * Renders a brief pairing two sources: real windowed performance data
 * (`DailyBriefDashboardData`, from `@tempo/db` — the same day-grain rollup
 * the dashboard UI itself reads) for the charts/KPIs/tables, and
 * `tempo-engine`'s narrated analysis (`EngineBriefContent`, from `POST
 * /v1/briefs/sync`) for the prose overlaid on top of them — the same
 * "chart + named finding + analyst reading" structure the reference report
 * uses, just with the reading now coming from a real generator battery +
 * agentic probe loop instead of a single LLM narration pass.
 *
 * tempo-engine's S2-S5 are four generic analysis sections, not pre-mapped
 * to "trend" vs. "campaign mix" the way the old schema was — S2 (period
 * comparison) is paired with the daily trend chart, S3 (primary channel) is
 * paired with the campaign chart, and S4/S5 render as their own narrative
 * sections. Any section tempo-engine didn't produce (coverage gap, or a
 * lower confidence tier) is simply omitted rather than shown empty.
 */

export interface EngineSectionDraft {
  headline: string;
  mechanism: string;
  implication?: string;
  action: string;
  confidence: 'high' | 'medium' | 'low';
  evidence_refs: string[];
}

export interface EngineRisk {
  risk: string;
  severity: 'high' | 'medium' | 'low';
  action: string;
  owner: string;
  evidence_refs: string[];
}

export interface EngineBriefContent {
  s1: { draft: { headline: string; summary: string }; source: string; fallback_reason: string | null } | null;
  sections: Record<string, { draft: EngineSectionDraft; narration_source: string; critic_approved: boolean }> | null;
  s6: { draft: { risks: EngineRisk[]; outlook: string[]; confidence: string }; source: string; fallback_reason: string | null } | null;
  probe_loop: { enabled: boolean | null; probes_executed: number | null; yield_rate: number | null; rounds_used: number | null } | null;
}

const OBJECTIVE_LABEL: Record<BriefObjectiveType, string> = {
  [BriefObjective.Awareness]: 'Awareness Brief',
  [BriefObjective.Gmv]: 'GMV Brief',
  [BriefObjective.Install]: 'Install Brief',
};

function provenanceLine(content: EngineBriefContent): string {
  const probe = content.probe_loop;
  if (!probe || !probe.enabled || probe.probes_executed === null || probe.probes_executed === 0) {
    return 'Dihasilkan oleh Tempo Intelligence Engine dari baterai generator deterministik.';
  }
  const yieldPct = probe.yield_rate !== null ? `${Math.round(probe.yield_rate * 100)}%` : 'n/a';
  return `Dihasilkan oleh Tempo Intelligence Engine — ${probe.probes_executed} probe analitis tambahan dijalankan (yield ${yieldPct}).`;
}

function sectionCallout(entry: { draft: EngineSectionDraft } | undefined): string {
  if (!entry) return '';
  const d = entry.draft;
  const paragraphs = [d.implication, d.action].filter((p): p is string => Boolean(p));
  return `${callout(d.headline, d.mechanism)}${prose(paragraphs)}`;
}

export function renderEngineBriefHtml(
  content: EngineBriefContent,
  dashboard: DailyBriefDashboardData,
  objective: BriefObjectiveType,
  northStar: NorthStar,
): string {
  const client: ClientSummary = dashboard.client;
  const cur = client.currency as Currency;
  const brand = client.brandColor ?? '#0FA79A';
  const money = (v: number) => formatCurrencyCompact(Math.round(v), cur);
  const na = '<span class="na">n/a</span>';
  const ratio = (v: number | null, fmt: (n: number) => string) => (v === null ? na : esc(fmt(v)));
  const isVtr = northStar === NorthStar.Vtr;
  const outcomeLabel = northStar === NorthStar.AppInstall ? 'Installs' : 'Conversions';
  const cpaLabel = northStar === NorthStar.AppInstall ? 'CPI' : 'CPA';
  const subtitle = OBJECTIVE_LABEL[objective];
  const s1 = content.s1?.draft;
  const sections = content.sections ?? {};
  const cmp = dashboard.comparison;
  const caption = cmp ? `vs ${dashboard.days.length}-hari sebelumnya` : undefined;

  const firstDate = dashboard.days[0]?.date;
  const lastDate = dashboard.days[dashboard.days.length - 1]?.date;
  const periodLabel = firstDate && lastDate ? (firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`) : `${dashboard.days.length} hari terakhir`;

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8"/>
<title>${esc(client.name)} — ${esc(subtitle)}</title>
<style>${styles(brand)}</style>
</head>
<body>
  ${cover({
    clientName: client.name,
    subtitle,
    periodKey: 'Periode',
    periodValue: periodLabel,
    preparedForKey: 'Disiapkan untuk',
    generatedLabel: `Dibuat ${new Date().toISOString().slice(0, 10)}`,
    brand,
  })}

  <section class="sheet">
    ${sectionTitle('01', 'Ringkasan Eksekutif')}
    <p class="lede">${esc(s1?.headline ?? subtitle)}</p>
    ${isVtr
      ? kpiRow([
          { label: 'Impressions', value: formatNumberCompact(dashboard.windowTotals.impressions), delta: cmp?.deltas.impressions, goodDirection: 'up', caption },
          { label: 'Reach', value: formatNumberCompact(dashboard.windowTotals.reach), delta: cmp?.deltas.reach, goodDirection: 'up', caption },
          { label: 'VTR 6s', value: dashboard.windowTotals.vtr6s === null ? 'n/a' : formatPercent(dashboard.windowTotals.vtr6s), delta: cmp?.deltas.vtr6s, goodDirection: 'up', caption },
          { label: 'VTR 15s', value: dashboard.windowTotals.vtr15s === null ? 'n/a' : formatPercent(dashboard.windowTotals.vtr15s), delta: cmp?.deltas.vtr15s, goodDirection: 'up', caption },
        ])
      : kpiRow([
          { label: 'Reach', value: formatNumberCompact(dashboard.windowTotals.reach), delta: cmp?.deltas.reach, goodDirection: 'up', caption },
          { label: outcomeLabel, value: formatNumberCompact(dashboard.windowTotals.conversions), delta: cmp?.deltas.conversions, goodDirection: 'up', caption },
          { label: cpaLabel, value: dashboard.windowTotals.cpa === null ? 'n/a' : money(dashboard.windowTotals.cpa), delta: cmp?.deltas.cpa, goodDirection: 'down', caption },
          dashboard.windowTotals.roas !== null
            ? { label: 'ROAS', value: `${dashboard.windowTotals.roas.toFixed(2)}×`, delta: cmp?.deltas.roas, goodDirection: 'up', caption }
            : { label: 'Spend', value: money(dashboard.windowTotals.spend), delta: cmp?.deltas.spend, goodDirection: 'neutral', caption },
        ])}
    ${dailyTrendCard(dashboard, isVtr)}
    ${prose([s1?.summary ?? ''])}
  </section>

  <section class="sheet">
    ${sectionTitle('02', 'Tren Harian')}
    ${sectionCallout(sections['2'])}
    ${dailySeriesTable(dashboard, ratio, money, isVtr)}
  </section>

  <section class="sheet">
    ${sectionTitle('03', 'Kinerja Kampanye')}
    ${campaignRankChart(dashboard.campaigns, isVtr, money)}
    ${sectionCallout(sections['3'])}
    ${campaignTable(dashboard.campaigns, ratio, money, isVtr, outcomeLabel, cpaLabel)}
  </section>

  ${(['4', '5'] as const)
    .map((sid) => {
      const entry = sections[sid];
      if (!entry) return '';
      const title = sid === '4' ? 'Saluran Sekunder & Funnel' : 'Kreatif & Entitas';
      return `<section class="sheet">
        ${sectionTitle(`0${sid}`, title)}
        ${sectionCallout(entry)}
      </section>`;
    })
    .join('')}

  ${s6Section(content)}

  <p class="muted small" style="margin-top:10px">${esc(provenanceLine(content))}</p>
</body>
</html>`;
}

function s6Section(content: EngineBriefContent): string {
  const s6 = content.s6?.draft;
  if (!s6 || s6.risks.length === 0) return '';
  return `<section class="sheet">
    ${sectionTitle('06', 'Risiko & Outlook')}
    ${riskCards(
      s6.risks.map((r): RiskCard => ({ ...r, severityLabel: r.severity.toUpperCase() })),
      'Pemilik',
    )}
    ${prose(s6.outlook)}
  </section>`;
}

function dailyTrendCard(dashboard: DailyBriefDashboardData, isVtr: boolean): string {
  const svg = comboChart(
    dashboard.days.map((d) => ({
      label: shortDateId(d.date),
      bar: d.totals.impressions,
      line: isVtr ? (d.totals.vtr6s ?? 0) : d.totals.conversions,
    })),
    {
      formatBar: (v) => formatNumberCompact(v),
      formatLine: (v) => (isVtr ? formatPercent(v, 1) : formatNumberCompact(v)),
      barColor: PAID_COLOR,
      lineColor: ENG_COLOR,
      maxXLabels: 10,
    },
  );
  return chartCard(
    isVtr ? 'Impressions · VTR 6s' : 'Impressions · Conversions',
    svg,
    legend([
      ['Impressions', PAID_COLOR, 'bar'],
      [isVtr ? 'VTR 6s' : 'Conversions', ENG_COLOR, 'line'],
    ]),
  );
}

function campaignRankChart(campaigns: CampaignWindowRow[], isVtr: boolean, money: (v: number) => string): string {
  if (campaigns.length === 0) return '';
  const outcomeTotal = campaigns.reduce((s, c) => s + (isVtr ? c.totals.impressions : c.totals.conversions), 0);
  const svg = rankChart(
    campaigns.slice(0, 8).map((c) => {
      const outcome = isVtr ? c.totals.impressions : c.totals.conversions;
      const share = outcomeTotal > 0 ? formatPercent(outcome / outcomeTotal, 0) : '0%';
      const secondary = isVtr
        ? c.totals.vtr6s === null
          ? 'n/a'
          : formatPercent(c.totals.vtr6s)
        : c.totals.cpa === null
          ? 'n/a'
          : money(c.totals.cpa);
      return {
        label: c.name,
        value: c.totals.spend,
        note: `${share} dari ${isVtr ? 'impressions' : 'conversions'} · ${isVtr ? 'VTR' : 'CPA'} ${secondary}`,
      };
    }),
    { format: money },
  );
  return chartCard('Spend by Campaign', svg, '');
}

function dailySeriesTable(
  dashboard: DailyBriefDashboardData,
  ratio: (v: number | null, fmt: (n: number) => string) => string,
  money: (v: number) => string,
  isVtr: boolean,
): string {
  return `<table class="data">
    <thead><tr>
      <th>Tanggal</th>
      <th class="num">Belanja</th>
      <th class="num">Impressions</th>
      ${isVtr ? '<th class="num">VTR 6s</th>' : '<th class="num">Conversions</th><th class="num">CPA</th>'}
    </tr></thead>
    <tbody>${dashboard.days
      .map(
        (d) => `<tr>
        <td class="strong">${esc(shortDateId(d.date))}</td>
        <td class="num">${esc(money(d.totals.spend))}</td>
        <td class="num">${esc(formatNumberCompact(d.totals.impressions))}</td>
        ${
          isVtr
            ? `<td class="num strong">${ratio(d.totals.vtr6s, (v) => formatPercent(v))}</td>`
            : `<td class="num">${esc(formatNumberCompact(d.totals.conversions))}</td><td class="num strong">${ratio(d.totals.cpa, money)}</td>`
        }
      </tr>`,
      )
      .join('')}</tbody>
  </table>`;
}

function campaignTable(
  campaigns: CampaignWindowRow[],
  ratio: (v: number | null, fmt: (n: number) => string) => string,
  money: (v: number) => string,
  isVtr: boolean,
  outcomeLabel: string,
  cpaLabel: string,
): string {
  const row = (c: CampaignWindowRow) => `<tr>
      <td class="strong">${esc(c.name)}</td>
      <td class="num">${esc(money(c.totals.spend))}</td>
      <td class="num">${esc(formatNumberCompact(c.totals.impressions))}</td>
      ${
        isVtr
          ? `<td class="num strong">${ratio(c.totals.vtr6s, (v) => formatPercent(v))}</td>
      <td class="num">${ratio(c.totals.cpm, money)}</td>`
          : `<td class="num">${esc(formatNumberCompact(c.totals.conversions))}</td>
      <td class="num strong">${ratio(c.totals.cpa, money)}</td>`
      }
    </tr>`;

  return `<table class="data">
    <thead><tr>
      <th>Kampanye</th>
      <th class="num">Belanja</th>
      <th class="num">Impressions</th>
      ${isVtr ? `<th class="num">VTR 6s</th><th class="num">CPM</th>` : `<th class="num">${esc(outcomeLabel)}</th><th class="num">${esc(cpaLabel)}</th>`}
    </tr></thead>
    <tbody>${campaigns.map(row).join('')}</tbody>
  </table>`;
}

function shortDateId(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${d} ${months[(m ?? 1) - 1]}`;
}
