import { formatCurrencyCompact, formatNumberCompact, formatPercent, type Currency } from '@tempo/core';
import type { HourlyReportBase } from '../hourly-model.js';
import { hourLabel } from '../layout.js';

/**
 * The fact sheet handed to the model.
 *
 * This is the scaffolding that makes an LLM-written report trustworthy AND keeps
 * it focused on the right metric. The client is an FMCG brand whose product is
 * already on shelves everywhere, so clicks and cost-per-click are not the goal —
 * efficient *views* are. The sheet therefore leads with impressions and the two
 * view-through rates (6s and 15s), hour by hour, and demotes cost to a single
 * context figure.
 *
 * The deterministic engine computes every figure first; the model is given
 * *only* those figures, pre-formatted, and may not introduce any other number.
 * `allowedNumbers` is the enforcement surface: after generation, every
 * number-like token in the output is checked against it (see verify.ts).
 */
export interface FactSheet {
  client: { name: string; currency: string; timezone: string };
  /** Plain-language framing so a small model optimises for the right thing. */
  brief: string;
  window: { firstDate: string; lastDate: string; days: number; trueHours: number };
  /** Window-level headline. Impressions & VTR lead; spend is context only. */
  totals: {
    impressions: string;
    reach: string;
    frequency: string;
    vtr6s: string;
    vtr15s: string;
    videoWatched6s: string;
    engagedView15s: string;
    /** Kept for context; not the objective for this brand. */
    spendContext: string;
  };
  comparison: { basis: string; deltas: Record<string, string> } | null;
  focusDay: {
    date: string;
    hoursCovered: string;
    peakImpressionsHour: { hour: string; impressions: string } | null;
    bestViewHour: { hour: string; vtr6s: string } | null;
    weakestViewHour: { hour: string; vtr6s: string } | null;
    /** Share of the day's impressions delivered by its busiest third of hours. */
    impressionsConcentration: string;
    /** The hour-by-hour grain: impressions against both view-through rates. */
    hourly: Array<{ hour: string; impressions: string; vtr6s: string; vtr15s: string }>;
  };
  campaigns: Array<{
    name: string;
    objective: string;
    impressions: string;
    shareOfImpressions: string;
    vtr6s: string;
    vtr15s: string;
    adgroups: Array<{
      name: string;
      impressions: string;
      vtr6s: string;
      vtr15s: string;
      /** True when impressions are too thin for the rate to be meaningful. */
      rateUnreliable: boolean;
    }>;
  }>;
  dataGaps: string[];
  /** Findings the deterministic engine already established, as grounding. */
  establishedFindings: string[];
  /**
   * Every numeric token the model is permitted to use. Anything outside this
   * set in the generated prose is treated as a hallucination.
   */
  allowedNumbers: string[];
}

/** Below this, an hour/adgroup has too few impressions to trust a VTR. */
const MIN_IMPRESSIONS_FOR_VTR = 5_000;

export function buildFactSheet(model: HourlyReportBase): FactSheet {
  const cur = model.client.currency as Currency;
  const money = (v: number) => formatCurrencyCompact(Math.round(v), cur);
  const num = (v: number) => formatNumberCompact(Math.round(v));
  const pct = (v: number | null, dp = 2) => (v === null ? 'n/a' : formatPercent(v, dp));
  const mult = (v: number | null) => (v === null ? 'n/a' : `${v.toFixed(1)}×`);

  const t = model.windowTotals;
  const focus = model.focus;
  const hours = focus.hours;

  const allowed = new Set<string>();
  const track = <T extends string>(s: T): T => {
    for (const m of s.matchAll(/[\d][\d.,]*/g)) allowed.add(m[0]);
    return s;
  };

  const totals = {
    impressions: track(num(t.impressions)),
    reach: track(num(t.reach)),
    frequency: track(mult(t.frequency)),
    vtr6s: track(pct(t.vtr6s)),
    vtr15s: track(pct(t.vtr15s)),
    videoWatched6s: track(num(t.videoWatched6s)),
    engagedView15s: track(num(t.engagedView15s)),
    spendContext: track(money(t.spend)),
  };

  const comparison = model.comparison
    ? {
        basis: track(model.comparison.label),
        deltas: Object.fromEntries(
          Object.entries(model.comparison.deltas)
            // Keep the view-first metrics; drop cost deltas from the model's view.
            .filter(([k]) => ['impressions', 'reach', 'vtr6s', 'vtr15s'].includes(k))
            .map(([k, v]) => [
              k,
              track(v === null ? 'n/a' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`),
            ]),
        ),
      }
    : null;

  // Hours thick enough for a VTR to mean something.
  const solid = hours.filter((x) => x.impressions >= MIN_IMPRESSIONS_FOR_VTR);
  const byVtr = [...solid].sort((a, b) => (a.vtr6s ?? 0) - (b.vtr6s ?? 0));
  const best = byVtr[byVtr.length - 1] ?? null;
  const weakest = byVtr[0] ?? null;
  const peakImpr = hours.length ? hours.reduce((a, b) => (b.impressions > a.impressions ? b : a)) : null;

  // Impressions concentration: the busiest third of hours' share of the day.
  const totalImpr = hours.reduce((s, x) => s + x.impressions, 0);
  const bySize = [...hours].sort((a, b) => b.impressions - a.impressions);
  const topThird = bySize.slice(0, Math.max(1, Math.round(hours.length / 3)));
  const concentration = totalImpr > 0 ? topThird.reduce((s, x) => s + x.impressions, 0) / totalImpr : null;

  const campaigns = model.campaigns.map((c) => ({
    name: c.name,
    objective: c.objective,
    impressions: track(num(c.totals.impressions)),
    shareOfImpressions: track(
      t.impressions > 0 ? formatPercent(c.totals.impressions / t.impressions, 0) : 'n/a',
    ),
    vtr6s: track(pct(c.totals.vtr6s)),
    vtr15s: track(pct(c.totals.vtr15s)),
    adgroups: c.adgroups.map((a) => ({
      name: a.name,
      impressions: track(num(a.totals.impressions)),
      vtr6s: track(pct(a.totals.vtr6s)),
      vtr15s: track(pct(a.totals.vtr15s)),
      rateUnreliable: a.totals.impressions < MIN_IMPRESSIONS_FOR_VTR,
    })),
  }));

  const sheet: FactSheet = {
    client: {
      name: model.client.name,
      currency: model.client.currency,
      timezone: model.client.timezone,
    },
    brief:
      `${model.client.name} is an FMCG brand whose products are already widely available in stores. ` +
      `The goal of this TikTok activity is efficient video views, measured by view-through rate (VTR): ` +
      `VTR6s = 6-second views ÷ impressions, VTR15s = 15-second views ÷ impressions. ` +
      `Clicks, cost-per-click and conversions are NOT the objective here — do not frame the analysis around them. ` +
      `Read the report by hour: where impressions and VTR are strong, and where impressions are spent on hours that view poorly.`,
    window: {
      firstDate: model.days[0]?.date ?? '',
      lastDate: model.days[model.days.length - 1]?.date ?? '',
      days: track(String(model.days.length)) as unknown as number,
      trueHours: track(String(model.totalHours)) as unknown as number,
    },
    totals,
    comparison,
    focusDay: {
      date: focus.date,
      hoursCovered: track(
        focus.coverage.firstHour !== null && focus.coverage.lastHour !== null
          ? `${hourLabel(focus.coverage.firstHour)}–${hourLabel(focus.coverage.lastHour)}`
          : 'n/a',
      ),
      peakImpressionsHour: peakImpr
        ? { hour: track(hourLabel(peakImpr.hour)), impressions: track(num(peakImpr.impressions)) }
        : null,
      bestViewHour: best
        ? { hour: track(hourLabel(best.hour)), vtr6s: track(pct(best.vtr6s)) }
        : null,
      weakestViewHour: weakest
        ? { hour: track(hourLabel(weakest.hour)), vtr6s: track(pct(weakest.vtr6s)) }
        : null,
      impressionsConcentration: track(concentration === null ? 'n/a' : formatPercent(concentration, 0)),
      hourly: hours.map((x) => ({
        hour: track(hourLabel(x.hour)),
        impressions: track(num(x.impressions)),
        vtr6s: track(pct(x.vtr6s)),
        vtr15s: track(pct(x.vtr15s)),
      })),
    },
    campaigns,
    dataGaps: [
      'The export contains no revenue or conversion-value column, so ROAS and CPA cannot be computed.',
      'The source is a TikTok Ads (paid) export; organic content performance is not included.',
      ...model.days
        .filter((d) => !d.coverage.isComplete && d.coverage.lastHour !== null)
        .map((d) => `${d.date} is incomplete — the export stops after ${hourLabel(d.coverage.lastHour!)}.`),
      ...model.days.flatMap((d) =>
        d.coverage.aggregatedHours
          .filter((a) => a.spanHours >= 3)
          .map(
            (a) =>
              `${d.date} ${hourLabel(a.hour)} carries ${a.spanHours} hours of accumulation, not one hour; it is excluded from hourly figures.`,
          ),
      ),
    ],
    establishedFindings: buildFindings(model, { best, weakest, concentration }, { pct, mult, num }),
    allowedNumbers: [],
  };

  for (const f of sheet.establishedFindings) track(f);
  sheet.allowedNumbers = [...allowed].sort();
  return sheet;
}

/**
 * VTR-based grounding, computed here rather than pulled from the (cost-oriented)
 * analysis engine, so the model's starting facts match the brief.
 */
function buildFindings(
  model: HourlyReportBase,
  ctx: {
    best: { hour: number; vtr6s: number | null } | null;
    weakest: { hour: number; vtr6s: number | null } | null;
    concentration: number | null;
  },
  fmt: { pct: (v: number | null, dp?: number) => string; mult: (v: number | null) => string; num: (v: number) => string },
): string[] {
  const t = model.windowTotals;
  const out: string[] = [];

  // Overall view efficiency.
  out.push(
    `Across ${model.totalHours} observed hours, ${fmt.num(t.impressions)} impressions returned a ${fmt.pct(t.vtr6s)} 6-second view-through rate and a ${fmt.pct(t.vtr15s)} 15-second rate.`,
  );

  // 6s→15s retention: of viewers who reached 6s, how many reached 15s.
  const retention = t.videoWatched6s > 0 ? t.engagedView15s / t.videoWatched6s : null;
  if (retention !== null) {
    out.push(
      `Of viewers who watched 6 seconds, ${fmt.pct(retention, 0)} went on to a 15-second engaged view — the depth signal for creative that holds attention.`,
    );
  }

  // Best vs weakest viewing hour.
  if (ctx.best && ctx.weakest && ctx.best.hour !== ctx.weakest.hour) {
    out.push(
      `The strongest viewing hour is ${String(ctx.best.hour).padStart(2, '0')}:00 at ${fmt.pct(ctx.best.vtr6s)} VTR6s, against ${String(ctx.weakest.hour).padStart(2, '0')}:00 at ${fmt.pct(ctx.weakest.vtr6s)} — the same impression is worth more in some hours than others.`,
    );
  }

  // Impressions concentration.
  if (ctx.concentration !== null) {
    out.push(
      `The busiest third of hours carries ${fmt.pct(ctx.concentration, 0)} of the day's impressions; whether those hours also view well decides how efficiently reach is bought.`,
    );
  }

  return out;
}
