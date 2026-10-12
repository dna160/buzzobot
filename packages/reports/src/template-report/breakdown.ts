/**
 * "Where does the result come from" breakdown — ranks the individual sources
 * (campaigns) behind an account-level efficiency number into the best and
 * worst performers, and explains how much each one pulls the blended number
 * up or down. Used for ROI in the GMV report, and for cost-per-reach / CPI in
 * the Awareness / Install reports. Pure and deterministic (ties broken by
 * spend, then name) so the same data always produces the same table.
 *
 * Internally every source's efficiency is `output / spend` — higher is
 * better in all modes (ROI = revenue/spend; installs-per-rupiah is 1/CPI;
 * reach-per-rupiah is 1000/cost-per-1000-reach). The caller's formatters turn
 * that back into the metric a reader knows.
 */

export interface PerformanceSource {
  name: string;
  /** e.g. "GMV Max" or "TTAM" — which delivery type this source is. */
  channel: string;
  spend: number;
  /** Revenue (ROI mode), installs, reach… the thing the spend bought. */
  output: number;
}

export interface RankedSource extends PerformanceSource {
  /** output ÷ spend. */
  efficiency: number;
  spendShare: number;
  outputShare: number;
  /** outputShare − spendShare, in fractions: > 0 means the source delivers more than its share of the budget. */
  shareGap: number;
  /**
   * How far this source moves the blended efficiency, in blended-efficiency
   * units: (output − blended × spend) ÷ totalSpend. Sums to 0 over all sources;
   * > 0 lifts the blended number, < 0 drags it down.
   */
  impact: number;
}

export interface SourceRanking {
  top: RankedSource[];
  bottom: RankedSource[];
  /** How many sources were big enough to be ranked. */
  rankedCount: number;
  /** Sources left out of the ranking because their spend share was below the floor. */
  skippedCount: number;
  totals: { spend: number; output: number };
  /** Blended output ÷ spend over every source. */
  blended: number | null;
  /** Every source with spend, in rank order (best → worst) — the ranked ones first, skipped ones after. */
  all: RankedSource[];
}

export interface RankOptions {
  /** A source needs at least this share of total spend to be ranked (default 2%). */
  minSpendShare?: number;
  /** Rows per side when there are enough sources (default 3). */
  size?: number;
}

export function rankSources(sources: PerformanceSource[], opts: RankOptions = {}): SourceRanking {
  const minShare = opts.minSpendShare ?? 0.02;
  const size = opts.size ?? 3;
  const live = sources.filter((s) => s.spend > 0);
  const totalSpend = live.reduce((a, s) => a + s.spend, 0);
  const totalOutput = live.reduce((a, s) => a + s.output, 0);
  const blended = totalSpend > 0 ? totalOutput / totalSpend : null;

  const ranked: RankedSource[] = live.map((s) => {
    const efficiency = s.output / s.spend;
    const spendShare = totalSpend > 0 ? s.spend / totalSpend : 0;
    const outputShare = totalOutput > 0 ? s.output / totalOutput : 0;
    return {
      ...s,
      efficiency,
      spendShare,
      outputShare,
      shareGap: outputShare - spendShare,
      impact: blended === null || totalSpend === 0 ? 0 : (s.output - blended * s.spend) / totalSpend,
    };
  });

  const byRank = (a: RankedSource, b: RankedSource): number =>
    b.efficiency - a.efficiency || b.spend - a.spend || a.name.localeCompare(b.name);

  let eligible = ranked.filter((s) => s.spendShare >= minShare).sort(byRank);
  if (eligible.length === 0) eligible = [...ranked].sort(byRank);
  const eligibleSet = new Set(eligible);
  const skipped = ranked.filter((s) => !eligibleSet.has(s)).sort(byRank);

  const n = eligible.length;
  let top: RankedSource[];
  let bottom: RankedSource[];
  if (n >= size * 2) {
    // Enough sources for a clean top-N / bottom-N (worst first in the bottom: "BOTTOM 1" is the weakest).
    top = eligible.slice(0, size);
    bottom = eligible.slice(n - size).reverse();
  } else {
    // Too few for N+N. Adjust by the average rather than by count, so a source
    // is only called "top" if it actually lifts the blended number and only
    // "bottom" if it actually drags it. If every source falls on one side of
    // the average (e.g. skipped tiny sources skew it), split the list in half.
    const above = blended === null ? [] : eligible.filter((s) => s.efficiency >= blended - 1e-12);
    const below = blended === null ? [] : eligible.filter((s) => s.efficiency < blended - 1e-12);
    if (above.length > 0 && below.length > 0) {
      top = above.slice(0, size);
      bottom = below.slice(-size).reverse();
    } else {
      const topCount = Math.ceil(n / 2);
      top = eligible.slice(0, topCount);
      bottom = eligible.slice(topCount).reverse();
    }
  }

  return {
    top,
    bottom,
    rankedCount: n,
    skippedCount: skipped.length,
    totals: { spend: totalSpend, output: totalOutput },
    blended,
    all: [...eligible, ...skipped],
  };
}

// --- Table model -----------------------------------------------------------

export interface SourceBreakdownRow {
  tone: 'top' | 'bottom';
  /** "TOP 1" … "BOTTOM 1" */
  peringkat: string;
  sumber: string;
  tipe: string;
  spend: string;
  output: string;
  efisiensi: string;
  pctSpend: string;
  pctOutput: string;
  dampak: string;
  dampakTone: 'lift' | 'drag' | 'neutral';
}

export interface SourceBreakdownSummaryRow {
  label: string;
  spend: string;
  output: string;
  efisiensi: string;
}

export interface SourceBreakdownModel {
  title: string;
  /** Deterministic one-paragraph explanation of what the table shows (numbers filled in by the caller). */
  intro: string;
  outputLabel: string;
  efficiencyLabel: string;
  impactLabel: string;
  rows: SourceBreakdownRow[];
  summaryRows: SourceBreakdownSummaryRow[];
  notes: string[];
}

export interface BreakdownFormatters {
  money: (n: number) => string;
  /** Formats an output total/row (revenue in rupiah, installs as a count…). */
  output: (n: number) => string;
  /** Formats `output ÷ spend` as the metric a reader knows (ROI "9.60x", CPI "Rp6,5Rb"…). */
  efficiency: (outputPerSpend: number) => string;
  /** The "dampak" cell for one source. */
  impact: (r: RankedSource) => string;
}

export function buildSourceBreakdown(input: {
  title: string;
  intro: string;
  outputLabel: string;
  efficiencyLabel: string;
  impactLabel: string;
  sources: PerformanceSource[];
  fmt: BreakdownFormatters;
  rank?: RankOptions;
  /** Rows appended under the subtotal (e.g. spend that isn't ranked, then the grand total). */
  extraSummaryRows?: SourceBreakdownSummaryRow[];
  extraNotes?: string[];
}): { model: SourceBreakdownModel; ranking: SourceRanking } {
  const ranking = rankSources(input.sources, input.rank);
  const { fmt } = input;
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

  const toRow = (r: RankedSource, tone: 'top' | 'bottom', index: number): SourceBreakdownRow => ({
    tone,
    peringkat: `${tone === 'top' ? 'TOP' : 'BOTTOM'} ${index + 1}`,
    sumber: r.name,
    tipe: r.channel,
    spend: fmt.money(r.spend),
    output: fmt.output(r.output),
    efisiensi: fmt.efficiency(r.efficiency),
    pctSpend: pct(r.spendShare),
    pctOutput: pct(r.outputShare),
    dampak: fmt.impact(r),
    dampakTone: Math.abs(r.impact) < 1e-12 ? 'neutral' : r.impact > 0 ? 'lift' : 'drag',
  });

  const rows = [
    ...ranking.top.map((r, i) => toRow(r, 'top', i)),
    ...ranking.bottom.map((r, i) => toRow(r, 'bottom', i)),
  ];

  const notes: string[] = [];
  if (ranking.rankedCount === 0) {
    notes.push('Belum ada sumber dengan spend pada periode ini.');
  } else if (ranking.rankedCount < 6) {
    notes.push(
      `Hanya ${ranking.rankedCount} sumber yang memenuhi syarat, sehingga tabel dibagi menurut rata-rata (bukan 3/3): ${ranking.top.length} teratas (di atas rata-rata) dan ${ranking.bottom.length} terbawah (di bawah rata-rata).`,
    );
  }
  if (ranking.skippedCount > 0) {
    notes.push(
      `${ranking.skippedCount} sumber dengan porsi spend < ${((input.rank?.minSpendShare ?? 0.02) * 100).toFixed(0)}% tidak diperingkat karena terlalu kecil untuk disimpulkan (tetap masuk subtotal).`,
    );
  }
  notes.push(...(input.extraNotes ?? []));

  const subtotal: SourceBreakdownSummaryRow = {
    label: 'Subtotal semua sumber yang dinilai',
    spend: fmt.money(ranking.totals.spend),
    output: fmt.output(ranking.totals.output),
    efisiensi: ranking.blended === null ? 'n/a' : fmt.efficiency(ranking.blended),
  };

  return {
    ranking,
    model: {
      title: input.title,
      intro: input.intro,
      outputLabel: input.outputLabel,
      efficiencyLabel: input.efficiencyLabel,
      impactLabel: input.impactLabel,
      rows,
      summaryRows: [subtotal, ...(input.extraSummaryRows ?? [])],
      notes,
    },
  };
}
