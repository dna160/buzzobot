import {
  BriefObjective,
  formatNumberCompact,
  formatPercent,
  type Currency,
  type MetricKey,
} from '@tempo/core';
import type {
  CampaignWindowRow,
  DailyBriefDashboardData,
  Totals,
  WindowVideoRow,
} from '@tempo/db';
import { buildFindingCard, namedRowAction } from './cards.js';
import { DECK_COPY, coverageLine, lightAction, metricLabel } from './copy.js';
import {
  selectedFindings,
  type EngineBriefContentV2,
  type EngineFinding,
  type EngineRisk,
} from './engine-content.js';
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
  VideoCell,
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
  /**
   * Videos with organic activity in the window (M4). Optional: a client with
   * no organic account simply has no S5 slide, which is the honest rendering —
   * not an empty grid.
   */
  videos?: WindowVideoRow[];
}

const DEFAULT_BRAND = '#2A78D6';
const PAID_COLOR = '#2A78D6';
const OUTCOME_COLOR = '#1BAF7A';
const MAX_CAMPAIGN_ROWS = 12;
const MAX_RANK_ROWS = 8;
/**
 * How many cards each slide can hold *and still fit its page*.
 *
 * PRD §4 caps S2 at three. The others are lower because their data blocks are
 * bigger: S3 carries a rank chart and a campaign table, S4 a funnel or a reach
 * table. A slide is a fixed page with no reflow, so this budget is what keeps
 * the deck honest — the alternative is a card clipped mid-sentence, which
 * looks like a bug and reads like one.
 */
const MAX_CARDS = { s2: 3, s3: 2, s4: 2, s5: 1 } as const;
/**
 * One row of three.
 *
 * A second row fits only by shrinking the thumbnails to the point where they
 * stop being the reason the slide exists, and it pushes the creative findings
 * and the R7 note off the page. "Video Terbaik" is the top few by design —
 * Lampiran B carries every video in the window.
 */
const MAX_VIDEO_CELLS = 3;

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
  findingIndex: Map<string, EngineFinding>,
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
    // A G04/G05 finding that names this campaign upgrades the generic action
    // to a named one — "Matikan: total cost Rp N" — with figures straight from
    // that finding's evidence, so the numeral gate already covers them.
    const named = namedRowAction(
      findingIndex.get(campaign.id) ?? findingIndex.get(campaign.name),
      currency,
    );
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
      action: named ?? lightAction(rowGrade),
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

/**
 * Cards for one section, in the engine's own ranked order.
 *
 * Prose comes from `card_copy` (per finding, deterministic in both tiers). An
 * engine that predates M3 sends none, so the top card falls back to the
 * section draft rather than the slide losing its cards entirely — the deck
 * always renders.
 */
function sectionCards(
  content: EngineBriefContentV2,
  sectionId: number,
  currency: Currency,
  max: number,
): Block[] {
  const draft = content.sections[String(sectionId)]?.draft;
  return selectedFindings(content, sectionId)
    .slice(0, max)
    .map((finding, index) => {
      const copy = content.card_copy[finding.id];
      const headline = copy?.headline ?? (index === 0 ? draft?.headline : undefined);
      const mechanism = copy?.mechanism ?? (index === 0 ? draft?.mechanism : undefined);
      if (!headline || !mechanism) return null;
      return {
        kind: 'findingCard' as const,
        card: buildFindingCard(
          finding,
          {
            headline,
            mechanism,
            action: copy?.action ?? (index === 0 ? draft?.action : undefined),
            implication: index === 0 ? draft?.implication : undefined,
          },
          currency,
        ),
      };
    })
    .filter((block): block is Extract<Block, { kind: 'findingCard' }> => block !== null);
}

/**
 * "4 dari 6 sinyal tersedia" — PRD §4: coverage gaps render as counted
 * denominators, not silence, so thinness reads as honesty.
 *
 * Printed only when something is actually missing. A section with full
 * coverage does not need to announce it, and a line on every slide would
 * quickly stop being read at all.
 */
function coverageBlocks(content: EngineBriefContentV2, sectionId: number): Block[] {
  const signal = content.coverage?.signals[String(sectionId)];
  if (!signal || signal.total <= signal.available) return [];
  return [{ kind: 'coverageNote', text: coverageLine(signal.available, signal.total) }];
}

/**
 * Findings that name a specific campaign, indexed for the row-action upgrade.
 * Matched on entity id *or* display name: the engine reads campaigns straight
 * from Tempo's Postgres, but which identifier reaches a `Finding` depends on
 * the generator, so a name match is the reliable fallback rather than a guess.
 */
function findingsByEntity(content: EngineBriefContentV2): Map<string, EngineFinding> {
  const byEntity = new Map<string, EngineFinding>();
  for (const finding of content.findings) {
    for (const key of [finding.entity.id, finding.entity.display_name]) {
      const current = byEntity.get(key);
      if (!current || finding.materiality > current.materiality) byEntity.set(key, finding);
    }
  }
  return byEntity;
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

/**
 * S4 — the one slide that is genuinely different per objective (PRD §4).
 *
 * Every figure below is read from `Totals`, which `daily-brief.ts` already
 * derived from summed numerators and denominators. Nothing is averaged across
 * days and nothing is summed across levels — the two arithmetic traps the
 * engine PRD §3.1 binds every generator to, applying equally here.
 */
function buildS4Blocks(
  dashboard: DailyBriefDashboardData,
  objective: BriefObjective,
  currency: Currency,
): Block[] {
  if (objective === BriefObjective.Awareness) return buildReachBlocks(dashboard, objective, currency);
  return buildFunnelBlocks(dashboard, objective, currency);
}

/** Awareness: frequency and effective reach — the one place reach non-additivity is the signal. */
function buildReachBlocks(
  dashboard: DailyBriefDashboardData,
  objective: BriefObjective,
  currency: Currency,
): Block[] {
  const blocks: Block[] = [];

  if (dashboard.days.length > 0) {
    const reachValues = dashboard.days.map((d) => d.totals.reach);
    const frequencyValues = dashboard.days.map((d) => d.totals.frequency);
    blocks.push({
      kind: 'chart',
      spec: {
        kind: 'combo',
        title: `${metricLabel('reach', objective)} & ${metricLabel('frequency', objective)} per hari`,
        labels: dashboard.days.map((d) => shortDate(d.date)),
        series: [
          { label: metricLabel('reach', objective), color: PAID_COLOR, kind: 'bar', values: reachValues, metric: 'reach' },
          {
            label: metricLabel('frequency', objective),
            color: OUTCOME_COLOR,
            kind: 'line',
            values: frequencyValues,
            metric: 'frequency',
          },
        ],
      },
    });
  }

  const rows: TableRow[] = [...dashboard.campaigns]
    .sort((a, b) => b.totals.reach - a.totals.reach)
    .slice(0, MAX_CAMPAIGN_ROWS)
    .map((campaign) => ({
      cells: [
        { text: campaign.name },
        { text: formatMetric('reach', campaign.totals.reach, currency), numeric: true },
        { text: formatMetric('impressions', campaign.totals.impressions, currency), numeric: true },
        { text: formatMetric('frequency', campaign.totals.frequency, currency), numeric: true },
        { text: formatMetric('vtr6s', campaign.totals.vtr6s, currency), numeric: true },
        { text: formatMetric('cpm', campaign.totals.cpm, currency), numeric: true },
      ],
    }));

  blocks.push({
    kind: 'table',
    spec: {
      title: DECK_COPY.slideTitles.s4.awareness,
      headers: [
        DECK_COPY.tables.campaignHeaders[0]!,
        metricLabel('reach', objective),
        metricLabel('impressions', objective),
        metricLabel('frequency', objective),
        metricLabel('vtr6s', objective),
        metricLabel('cpm', objective),
      ],
      rows,
      emptyNote: DECK_COPY.tables.emptyCampaigns,
    },
  });

  // Campaign-level reach is deduped by TikTok; account-level reach here is a
  // sum across campaigns and therefore an overlap-inflated upper bound (the
  // engine's AWARENESS contract says so in its own additivity_trap). Saying it
  // on the slide is cheaper than a client discovering it later.
  blocks.push({ kind: 'coverageNote', text: DECK_COPY.labels.reachCaveat });
  return blocks;
}

/** GMV and Install: where the funnel leaks, stage by stage. */
function buildFunnelBlocks(
  dashboard: DailyBriefDashboardData,
  objective: BriefObjective,
  currency: Currency,
): Block[] {
  const totals = dashboard.windowTotals;
  const outcomeLabel = metricLabel('conversions', objective);
  const stages: Array<{ label: string; value: number | null; rate: string }> = [
    { label: metricLabel('impressions', objective), value: totals.impressions, rate: DECK_COPY.labels.notReported },
    {
      label: metricLabel('clicks', objective),
      value: totals.clicks,
      rate: formatMetric('ctr', totals.ctr, currency),
    },
    {
      label: outcomeLabel,
      value: totals.conversions,
      rate: formatMetric('conversionRate', totals.conversionRate, currency),
    },
  ];

  if (objective === BriefObjective.Gmv) {
    stages.push({
      label: metricLabel('conversionValue', objective),
      value: totals.conversionValue,
      rate: formatMetric('roas', totals.roas, currency),
    });
  }

  const rows: TableRow[] = stages.map((stage, index) => ({
    cells: [
      { text: stage.label },
      {
        text:
          index === 3
            ? formatMetric('conversionValue', stage.value, currency)
            : formatMetric(index === 0 ? 'impressions' : index === 1 ? 'clicks' : 'conversions', stage.value, currency),
        numeric: true,
      },
      { text: stage.rate, numeric: true },
    ],
  }));

  const costRow: TableRow = {
    cells: [
      { text: metricLabel('cpa', objective) },
      { text: formatMetric('cpa', totals.cpa, currency), numeric: true },
      { text: DECK_COPY.labels.notReported, numeric: true },
    ],
  };

  return [
    {
      kind: 'table',
      spec: {
        title:
          objective === BriefObjective.Gmv
            ? DECK_COPY.slideTitles.s4.gmv
            : DECK_COPY.slideTitles.s4.install,
        headers: [...DECK_COPY.tables.funnelHeaders],
        rows: [...rows, costRow],
        emptyNote: DECK_COPY.tables.emptyDays,
      },
    },
  ];
}

/**
 * S5 — the top videos, as a clickable grid (PRD §4, §6).
 *
 * `href` is the row's own `shareUrl`, never a URL this function assembles: a
 * constructed permalink that 404s inside a client's PDF is worse than no link,
 * and the link-integrity test asserts the equality.
 */
function buildVideoGrid(videos: WindowVideoRow[], objective: BriefObjective): Block[] {
  const cells: VideoCell[] = videos
    .filter((video) => video.views > 0)
    .slice(0, MAX_VIDEO_CELLS)
    .map((video) => ({
      videoId: video.id,
      caption: video.caption,
      href: video.shareUrl ?? '',
      thumbnailSrc: video.thumbnailDataUri ?? undefined,
      metrics: [
        { label: metricLabel('views', objective), value: formatNumberCompact(video.views) },
        {
          label: metricLabel('engagementRate', objective),
          value: video.engagementRate === null ? DECK_COPY.labels.notReported : formatPercent(video.engagementRate),
        },
      ],
      // Per-video grading has no threshold anyone has committed to, and
      // `light()` returns `none` rather than guessing — so the cells carry
      // their figures without a colour that would imply a standard.
      light: 'none' as const,
    }));

  if (cells.length === 0) return [];
  return [{ kind: 'videoGrid', videos: cells }];
}

/** Lampiran B — every video in the window, organic metrics only (R7). */
function buildVideoTable(videos: WindowVideoRow[]): TableSpec {
  return {
    title: DECK_COPY.slideTitles.appendixB,
    headers: [...DECK_COPY.tables.videoHeaders],
    rows: videos.map((video) => ({
      cells: [
        { text: video.caption || video.externalId },
        { text: video.publishedAt },
        { text: formatNumberCompact(video.views), numeric: true },
        { text: formatNumberCompact(video.likes), numeric: true },
        { text: formatNumberCompact(video.comments), numeric: true },
        { text: formatNumberCompact(video.shares), numeric: true },
        {
          text:
            video.engagementRate === null
              ? DECK_COPY.labels.notReported
              : formatPercent(video.engagementRate),
          numeric: true,
        },
      ],
    })),
    emptyNote: DECK_COPY.tables.emptyVideos,
  };
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
  const s2Cards = sectionCards(content, 2, currency, MAX_CARDS.s2);
  if (s2) noteDeterministic(fallbacks, 's2', s2.narration_source);
  // The coverage line sits above the cards, not after them: it qualifies the
  // analysis that follows, and a note placed last is the first thing a full
  // slide clips — losing exactly the disclosure it exists to make.
  s2Blocks.push(...coverageBlocks(content, 2));
  s2Blocks.push(...narratedProseBlocks(s2));
  if (s2Cards.length > 0) {
    s2Blocks.push(...s2Cards);
  } else {
    // Never an empty card and never a fabricated one (PRD §4): the data blocks
    // still render, and the slide says plainly that nothing cleared the bar.
    s2Blocks.push({ kind: 'prose', text: DECK_COPY.labels.noMaterialFindings });
    fallbacks.push({ slideId: 's2', reason: 'no_findings', detail: 'tidak ada temuan material' });
  }

  // --- S3 Kinerja Kampanye -------------------------------------------------
  const s3Blocks: Block[] = [];
  const rank = buildRankChart(dashboard.campaigns, objective);
  if (rank) s3Blocks.push({ kind: 'chart', spec: rank });
  s3Blocks.push({
    kind: 'table',
    spec: buildCampaignTable(dashboard.campaigns, spec, objective, currency, findingsByEntity(content)),
  });
  const s3 = content.sections['3'];
  const s3Cards = sectionCards(content, 3, currency, MAX_CARDS.s3);
  if (s3) noteDeterministic(fallbacks, 's3', s3.narration_source);
  // The coverage line sits above the cards, not after them: it qualifies the
  // analysis that follows, and a note placed last is the first thing a full
  // slide clips — losing exactly the disclosure it exists to make.
  s3Blocks.push(...coverageBlocks(content, 3));
  s3Blocks.push(...narratedProseBlocks(s3));
  if (s3Cards.length > 0) {
    s3Blocks.push(...s3Cards);
  } else {
    s3Blocks.push({ kind: 'prose', text: DECK_COPY.labels.noMaterialFindings });
    fallbacks.push({ slideId: 's3', reason: 'no_findings', detail: 'tidak ada temuan material' });
  }

  // --- S4 — the objective-specific slide ----------------------------------
  const s4Blocks: Block[] = buildS4Blocks(dashboard, objective, currency);
  const s4 = content.sections['4'];
  const s4Cards = sectionCards(content, 4, currency, MAX_CARDS.s4);
  if (s4) noteDeterministic(fallbacks, 's4', s4.narration_source);
  // The coverage line sits above the cards, not after them: it qualifies the
  // analysis that follows, and a note placed last is the first thing a full
  // slide clips — losing exactly the disclosure it exists to make.
  s4Blocks.push(...coverageBlocks(content, 4));
  s4Blocks.push(...narratedProseBlocks(s4));
  if (s4Cards.length > 0) {
    s4Blocks.push(...s4Cards);
  } else {
    s4Blocks.push({ kind: 'prose', text: DECK_COPY.labels.noMaterialFindings });
    fallbacks.push({ slideId: 's4', reason: 'no_findings', detail: 'tidak ada temuan material' });
  }

  // --- S6 Risiko & Rencana Aksi -------------------------------------------
  const roadmap = buildRoadmap(content, objective);
  const s6Blocks: Block[] = [{ kind: 'roadmap', rows: roadmap }];
  const outlook = content.s6?.draft.outlook ?? [];
  if (outlook.length > 0) s6Blocks.push({ kind: 'prose', text: outlook.join(' ') });
  if (roadmap.length === 0) {
    fallbacks.push({ slideId: 's6', reason: 'no_findings', detail: DECK_COPY.roadmap.empty });
  }

  // --- S5 Video Terbaik ----------------------------------------------------
  const videos = input.videos ?? [];
  const videoGrid = buildVideoGrid(videos, objective);
  const s5Blocks: Block[] = [...videoGrid];
  if (videoGrid.length > 0) {
    const s5 = content.sections['5'];
    if (s5) noteDeterministic(fallbacks, 's5', s5.narration_source);
    // Both disclosures sit directly under the grid, for the same reason the
    // coverage line does elsewhere: a note placed last is the first thing a
    // full slide clips, and R7's "no revenue per video" is exactly the sentence
    // that must not go missing.
    s5Blocks.push(...coverageBlocks(content, 5));
    s5Blocks.push({ kind: 'coverageNote', text: DECK_COPY.labels.organicOnly });
    s5Blocks.push(...narratedProseBlocks(s5));
    s5Blocks.push(...sectionCards(content, 5, currency, MAX_CARDS.s5));
  }

  // Built in reading order rather than assembled and spliced: S5 is optional
  // (a client with no organic account has no video slide at all — an empty
  // grid saying "no videos" is a slide that exists to say nothing), and a
  // positional insert would silently move if a slide were ever added above it.
  const slides: Slide[] = [
    { id: 's0', title: dashboard.client.name, variant: 'cover', blocks: [] },
    { id: 's1', title: DECK_COPY.slideTitles.s1, variant: 'content', blocks: s1Blocks },
    { id: 's2', title: DECK_COPY.slideTitles.s2, variant: 'content', blocks: s2Blocks },
    { id: 's3', title: DECK_COPY.slideTitles.s3, variant: 'content', blocks: s3Blocks },
    { id: 's4', title: DECK_COPY.slideTitles.s4[objective], variant: 'content', blocks: s4Blocks },
    ...(s5Blocks.length > 0
      ? [{ id: 's5', title: DECK_COPY.slideTitles.s5, variant: 'content' as const, blocks: s5Blocks }]
      : []),
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

  if (spec.appendix.allVideos && videos.length > 0) {
    slides.push({
      id: 'appendix-b',
      title: DECK_COPY.slideTitles.appendixB,
      variant: 'appendix',
      blocks: [
        { kind: 'table', spec: buildVideoTable(videos) },
        { kind: 'coverageNote', text: DECK_COPY.labels.organicOnly },
      ],
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

/**
 * The narrated section prose, above the cards — but only when an agent
 * actually wrote it.
 *
 * At the instant tier the section draft *is* the top finding's template copy,
 * so printing it here would say the same sentence twice on one slide. When the
 * narrators ran, their reading is genuinely additional to the per-finding
 * cards, and it leads the slide.
 */
function narratedProseBlocks(entry: { draft: { headline: string; mechanism: string }; narration_source: string } | undefined): Block[] {
  if (!entry || entry.narration_source !== 'llm') return [];
  return proseBlocks(`${entry.draft.headline} ${entry.draft.mechanism}`.trim());
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
