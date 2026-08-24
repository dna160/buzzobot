import { BriefObjective, type Currency, type MetricKey } from '@tempo/core';
import type { CampaignWindowRow, DailyBriefDashboardData, Totals } from '@tempo/db';
import { DECK_COPY, lightAction, metricLabel } from './copy.js';
import type { EngineBriefContentV2, EngineRisk } from './engine-content.js';
import { solveKpiGrid } from './grid.js';
import { deltaDirection, light } from './lights.js';
import { formatMetric, formatMetricDelta, metricDelta, metricValue } from './metric-values.js';
import type {
  Block,
  ChartSpec,
  DeckMeta,
  DeckModel,
  DeckTier,
  KpiTile,
  RoadmapRow,
  SectionFallback,
  Slide,
  TableRow,
  TableSpec,
} from './model.js';
import type { ReportSpec } from './spec.js';

/**
 * `buildDeckModel` — the only place engine content, read-model rows, and the
 * report spec meet (Brief Deck PRD §3.2).
 *
 * Pure by contract: no I/O, no clock (`generatedAt` is passed in), no
 * randomness. That is what makes `DeckModel` snapshot-testable against a real
 * engine fixture, and what keeps renderer bugs and analysis bugs from blurring
 * — a failing model snapshot means the analysis moved, a failing HTML golden
 * means the rendering did (PRD §9 item 8).
 *
 * Milestone note: M2 builds the deck frame — cover, KPI grid, trend, campaigns,
 * roadmap, raw appendix — with engine prose in `prose` blocks. `findingCard`
 * blocks, the objective-specific S4 slide, and counted-denominator coverage
 * lines are M3, which is why the `Block` union already carries them.
 */

export interface BuildDeckInput {
  content: EngineBriefContentV2;
  /** 1 means pre-M0 content: prose only, no findings to render. */
  contentVersion: 1 | 2;
  dashboard: DailyBriefDashboardData;
  spec: ReportSpec;
  objective: BriefObjective;
  runId: string;
  tier: DeckTier;
  /** ISO-8601, supplied by the caller — this function never reads a clock. */
  generatedAt: string;
  windowDays: number;
}

const DEFAULT_BRAND = '#2A78D6';
const PAID_COLOR = '#2A78D6';
const OUTCOME_COLOR = '#1BAF7A';
const MAX_CAMPAIGN_ROWS = 12;
const MAX_RANK_ROWS = 8;

/** Which metric a campaign row is graded and ranked on, per objective. */
const OUTCOME_METRIC: Record<BriefObjective, MetricKey> = {
  [BriefObjective.Awareness]: 'vtr6s',
  [BriefObjective.Gmv]: 'roas',
  [BriefObjective.Install]: 'cpa',
};

/** The line overlaid on the daily spend bars, per objective. */
const TREND_LINE_METRIC: Record<BriefObjective, MetricKey> = {
  [BriefObjective.Awareness]: 'vtr6s',
  [BriefObjective.Gmv]: 'roas',
  [BriefObjective.Install]: 'conversions',
};

function shortDate(iso: string): string {
  // Deliberately not `toLocaleDateString`: a deck rendered in CI and a deck
  // rendered on a laptop must produce byte-identical goldens, and ICU data
  // differs between environments.
  const [, month, day] = iso.split('-');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const index = Number(month) - 1;
  return `${Number(day)} ${MONTHS[index] ?? month}`;
}

function periodLabel(days: DailyBriefDashboardData['days']): string {
  if (days.length === 0) return '—';
  const first = days[0]!.date;
  const last = days[days.length - 1]!.date;
  return first === last ? shortDate(first) : `${shortDate(first)} – ${shortDate(last)}`;
}

function buildKpiTiles(
  spec: ReportSpec,
  objective: BriefObjective,
  totals: Totals,
  previous: Totals | null,
  currency: Currency,
): { tiles: KpiTile[]; block: Block } {
  const solution = solveKpiGrid(spec.metrics, spec.metrics);
  const tiles = solution.tiles.map((metric): KpiTile => {
    const value = metricValue(totals, metric);
    const delta = metricDelta(totals, previous, metric);
    return {
      metric,
      label: metricLabel(metric, objective),
      value: formatMetric(metric, value, currency),
      delta: formatMetricDelta(delta),
      deltaDirection: deltaDirection(delta),
      light: light(metric, { value, delta, target: spec.targets?.[metric], objective }),
      suggested: solution.suggested.includes(metric) || undefined,
    };
  });
  return { tiles, block: { kind: 'kpiGrid', tiles, layout: solution.layout } };
}

function buildTrendChart(
  dashboard: DailyBriefDashboardData,
  objective: BriefObjective,
): ChartSpec | null {
  if (dashboard.days.length === 0) return null;
  const lineMetric = TREND_LINE_METRIC[objective];
  const labels = dashboard.days.map((d) => shortDate(d.date));
  const spendValues = dashboard.days.map((d) => d.totals.spend);
  const lineValues = dashboard.days.map((d) => metricValue(d.totals, lineMetric));

  return {
    kind: 'combo',
    title: `${metricLabel('spend', objective)} & ${metricLabel(lineMetric, objective)} per hari`,
    labels,
    series: [
      {
        label: metricLabel('spend', objective),
        color: PAID_COLOR,
        kind: 'bar',
        values: spendValues,
        metric: 'spend',
      },
      {
        label: metricLabel(lineMetric, objective),
        color: OUTCOME_COLOR,
        kind: 'line',
        values: lineValues,
        metric: lineMetric,
      },
    ],
  };
}

function buildDayTable(
  dashboard: DailyBriefDashboardData,
  spec: ReportSpec,
  objective: BriefObjective,
  currency: Currency,
): TableSpec {
  // Lampiran A: every spec metric, per day. PRD §4's promise — "halaman depan
  // bersih, halaman belakang lengkap" — so this table shows the full spec, not
  // just the six that tiled.
  const metrics = spec.metrics;
  return {
    title: DECK_COPY.slideTitles.appendixA,
    headers: [DECK_COPY.tables.dayHeader, ...metrics.map((m) => metricLabel(m, objective))],
    rows: dashboard.days.map((day) => ({
      cells: [
        { text: shortDate(day.date) },
        ...metrics.map((m) => ({
          text: formatMetric(m, metricValue(day.totals, m), currency),
          numeric: true,
        })),
      ],
    })),
    emptyNote: DECK_COPY.tables.emptyDays,
  };
}

function buildCampaignTable(
  campaigns: CampaignWindowRow[],
  spec: ReportSpec,
  objective: BriefObjective,
  currency: Currency,
): TableSpec {
  const outcome = OUTCOME_METRIC[objective];
  const rows: TableRow[] = campaigns.slice(0, MAX_CAMPAIGN_ROWS).map((campaign) => {
    const value = metricValue(campaign.totals, outcome);
    // PRD §3.5: at campaign granularity the red row *is* the culprit, so a row
    // carries an action as well as a colour. The action is generic here —
    // M3 upgrades it to a named one ("Matikan: X, 0 pesanan pada belanja Rp N")
    // wherever a G04/G05 finding names that campaign.
    const rowGrade = light(outcome, {
      value,
      objective,
      target: spec.targets?.[outcome],
    });
    return {
      cells: [
        { text: campaign.name },
        { text: formatMetric('spend', campaign.totals.spend, currency), numeric: true },
        { text: formatMetric('impressions', campaign.totals.impressions, currency), numeric: true },
        { text: formatMetric('clicks', campaign.totals.clicks, currency), numeric: true },
        { text: formatMetric('ctr', campaign.totals.ctr, currency), numeric: true },
        { text: formatMetric(outcome, value, currency), numeric: true },
      ],
      light: rowGrade,
      action: lightAction(rowGrade),
    };
  });

  return {
    title: DECK_COPY.slideTitles.s3,
    headers: [
      ...DECK_COPY.tables.campaignHeaders.slice(0, 5),
      metricLabel(outcome, objective),
    ],
    rows,
    emptyNote: DECK_COPY.tables.emptyCampaigns,
  };
}

function buildRankChart(campaigns: CampaignWindowRow[], objective: BriefObjective): ChartSpec | null {
  if (campaigns.length === 0) return null;
  const ranked = [...campaigns].sort((a, b) => b.totals.spend - a.totals.spend).slice(0, MAX_RANK_ROWS);
  const values = ranked.map((c) => c.totals.spend);
  return {
    kind: 'rank',
    title: `${metricLabel('spend', objective)} per kampanye`,
    labels: ranked.map((c) => c.name),
    series: [
      {
        label: metricLabel('spend', objective),
        color: PAID_COLOR,
        kind: 'bar',
        values,
        metric: 'spend',
      },
    ],
  };
}

/** P0/P1/P2 = f(severity, magnitude) — PRD §4 S6. */
function priorityFor(risk: EngineRisk, magnitude: number | null): RoadmapRow['priority'] {
  if (risk.severity === 'high') return 'P0';
  if (risk.severity === 'medium') return magnitude !== null && magnitude >= 0.3 ? 'P0' : 'P1';
  return magnitude !== null && magnitude >= 0.5 ? 'P1' : 'P2';
}

/**
 * A roadmap where every line is urgent prioritizes nothing. At the instant
 * tier the engine derives severity from magnitude alone, so `f(severity,
 * magnitude)` can collapse to one value and every risk lands at P0 — this cap
 * keeps the top band meaningful by demoting the lowest-magnitude overflow to
 * P1. Nothing is dropped and no claim changes; only the ordering label does.
 */
const MAX_P0_ROWS = 3;

function buildRoadmap(content: EngineBriefContentV2, objective: BriefObjective): RoadmapRow[] {
  const risks = content.s6?.draft.risks ?? [];
  const byId = new Map(content.findings.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const scored: Array<{ row: RoadmapRow; magnitude: number }> = [];

  for (const risk of risks) {
    const evidenceRef = risk.evidence_refs[0] ?? 'none';
    // The engine can route one finding into more than one risk; a client
    // reading the same action twice loses trust in both.
    const key = `${risk.action}::${evidenceRef}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const finding = byId.get(evidenceRef);
    const magnitude = finding ? finding.magnitude_pct : null;
    scored.push({
      magnitude: magnitude ?? 0,
      row: {
        priority: priorityFor(risk, magnitude),
        action: risk.action,
        owner: risk.owner,
        impact:
          magnitude === null
            ? DECK_COPY.labels.notReported
            : `${Math.round(magnitude * 100)}% ${impactBasis(objective)}`,
        evidenceRef,
      },
    });
  }

  const order = { P0: 0, P1: 1, P2: 2 } as const;
  scored.sort((a, b) => order[a.row.priority] - order[b.row.priority] || b.magnitude - a.magnitude);

  let p0Count = 0;
  return scored.map(({ row }) => {
    if (row.priority !== 'P0') return row;
    p0Count += 1;
    return p0Count <= MAX_P0_ROWS ? row : { ...row, priority: 'P1' as const };
  });
}

function impactBasis(objective: BriefObjective): string {
  return objective === BriefObjective.Awareness ? 'dari impresi' : 'dari belanja';
}

function proseBlocks(text: string | undefined | null): Block[] {
  const trimmed = (text ?? '').trim();
  return trimmed ? [{ kind: 'prose', text: trimmed }] : [];
}

export function buildDeckModel(input: BuildDeckInput): DeckModel {
  const { content, dashboard, spec, objective, runId, tier, generatedAt, windowDays } = input;
  const currency = (dashboard.client.currency || 'IDR') as Currency;
  const previous = dashboard.comparison?.previous ?? null;
  const fallbacks: SectionFallback[] = [];

  const { block: kpiGrid } = buildKpiTiles(
    spec,
    objective,
    dashboard.windowTotals,
    previous,
    currency,
  );

  // --- S1 Ringkasan --------------------------------------------------------
  const s1Blocks: Block[] = [kpiGrid];
  const trend = buildTrendChart(dashboard, objective);
  if (trend) s1Blocks.push({ kind: 'chart', spec: trend });
  const s1Text = content.s1?.draft.headline;
  if (s1Text) {
    // The engine's S1 summary is built from the accepted section headlines, so
    // it usually opens with the headline itself — printing both would repeat a
    // sentence on the client's first content slide.
    const summary = content.s1?.draft.summary ?? '';
    const text = summary.startsWith(s1Text) ? summary : `${s1Text} ${summary}`;
    s1Blocks.push(...proseBlocks(text));
  } else {
    fallbacks.push({
      slideId: 's1',
      reason: 'engine_unavailable',
      detail: 'ringkasan tidak tersedia dari mesin analitik',
    });
  }

  // --- S2 Tren -------------------------------------------------------------
  const s2Blocks: Block[] = [];
  if (trend) s2Blocks.push({ kind: 'chart', spec: trend });
  const s2 = content.sections['2'];
  if (s2) {
    s2Blocks.push(...proseBlocks(sectionProse(s2.draft.headline, s2.draft.mechanism)));
    noteDeterministic(fallbacks, 's2', s2.narration_source);
  } else {
    s2Blocks.push({ kind: 'prose', text: DECK_COPY.labels.noMaterialFindings });
    fallbacks.push({ slideId: 's2', reason: 'no_findings', detail: 'tidak ada bagian S2' });
  }

  // --- S3 Kinerja Kampanye -------------------------------------------------
  const s3Blocks: Block[] = [];
  const rank = buildRankChart(dashboard.campaigns, objective);
  if (rank) s3Blocks.push({ kind: 'chart', spec: rank });
  s3Blocks.push({
    kind: 'table',
    spec: buildCampaignTable(dashboard.campaigns, spec, objective, currency),
  });
  const s3 = content.sections['3'];
  if (s3) {
    s3Blocks.push(...proseBlocks(sectionProse(s3.draft.headline, s3.draft.mechanism)));
    noteDeterministic(fallbacks, 's3', s3.narration_source);
  } else {
    s3Blocks.push({ kind: 'prose', text: DECK_COPY.labels.noMaterialFindings });
    fallbacks.push({ slideId: 's3', reason: 'no_findings', detail: 'tidak ada bagian S3' });
  }

  // --- S6 Risiko & Rencana Aksi -------------------------------------------
  const roadmap = buildRoadmap(content, objective);
  const s6Blocks: Block[] = [{ kind: 'roadmap', rows: roadmap }];
  const outlook = content.s6?.draft.outlook ?? [];
  if (outlook.length > 0) s6Blocks.push({ kind: 'prose', text: outlook.join(' ') });
  if (roadmap.length === 0) {
    fallbacks.push({ slideId: 's6', reason: 'no_findings', detail: DECK_COPY.roadmap.empty });
  }

  const slides: Slide[] = [
    { id: 's0', title: dashboard.client.name, variant: 'cover', blocks: [] },
    { id: 's1', title: DECK_COPY.slideTitles.s1, variant: 'content', blocks: s1Blocks },
    { id: 's2', title: DECK_COPY.slideTitles.s2, variant: 'content', blocks: s2Blocks },
    { id: 's3', title: DECK_COPY.slideTitles.s3, variant: 'content', blocks: s3Blocks },
    { id: 's6', title: DECK_COPY.slideTitles.s6, variant: 'content', blocks: s6Blocks },
  ];

  if (spec.appendix.rawTable) {
    slides.push({
      id: 'appendix-a',
      title: DECK_COPY.slideTitles.appendixA,
      variant: 'appendix',
      blocks: [{ kind: 'table', spec: buildDayTable(dashboard, spec, objective, currency) }],
    });
  }

  const meta: DeckMeta = {
    clientName: dashboard.client.name,
    clientSlug: dashboard.client.slug,
    brandColor: dashboard.client.brandColor || DEFAULT_BRAND,
    currency,
    objective,
    period: periodLabel(dashboard.days),
    windowDays,
    tier,
    runId,
    engineVersion: content.engine_version,
    generatedAt,
    probesExecuted: content.probe_loop.probes_executed,
    probeYieldRate: content.probe_loop.yield_rate,
    fallbacks,
    legacyContent: input.contentVersion === 1,
  };

  return { meta, slides };
}

function sectionProse(headline: string, mechanism: string): string {
  return `${headline} ${mechanism}`.trim();
}

/**
 * A section written by the template table rather than the narrators is not a
 * failure — it is the instant tier working as designed — but the footer says so
 * either way. A thin deck that does not admit it is thin is the failure.
 */
function noteDeterministic(
  fallbacks: SectionFallback[],
  slideId: string,
  narrationSource: string,
): void {
  if (narrationSource === 'llm') return;
  fallbacks.push({
    slideId,
    reason: 'deterministic_copy',
    detail: `narasi ${narrationSource}`,
  });
}

/** Exposed for tests and for M3's card work; not part of the public barrel. */
export const __internals = { buildRoadmap, priorityFor, shortDate, periodLabel };
