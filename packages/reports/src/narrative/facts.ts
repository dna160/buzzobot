import { formatCurrencyCompact, formatPercent, type Currency } from '@tempo/core';
import type { HourlyReportBase } from '../hourly-model.js';
import { analyseHourly, type HourlyAnalysis } from '../hourly-analysis.js';
import { hourLabel } from '../layout.js';

/**
 * The fact sheet handed to the model.
 *
 * This is the scaffolding that makes an LLM-written report trustworthy: the
 * deterministic engine computes every figure first, and the model is given
 * *only* those figures, pre-formatted, with an explicit instruction that it may
 * not introduce any other number. The model's job is interpretation and prose —
 * never arithmetic, never recall.
 *
 * `allowedNumbers` is the enforcement surface: after generation, every
 * number-like token in the output is checked against it (see verify.ts).
 */
export interface FactSheet {
  client: { name: string; currency: string; timezone: string };
  window: { firstDate: string; lastDate: string; days: number; trueHours: number };
  totals: Record<string, string>;
  comparison: { basis: string; deltas: Record<string, string> } | null;
  focusDay: {
    date: string;
    hoursCovered: string;
    peak: { hour: string; spend: string };
    trough: { hour: string; spend: string };
    heavierHalfShare: string;
    cheapestClickHour: { hour: string; cpc: string; ctr: string } | null;
    dearestClickHour: { hour: string; cpc: string; ctr: string } | null;
    /** Pooled CPC of the top-spend third vs the bottom-spend third. */
    spendWeightedCpcRatio: string | null;
    hourly: Array<Record<string, string>>;
  };
  campaigns: Array<{
    name: string;
    objective: string;
    spend: string;
    shareOfSpend: string;
    impressions: string;
    clicks: string;
    ctr: string;
    cpc: string;
    cpm: string;
    adgroups: Array<{
      name: string;
      spend: string;
      clicks: string;
      ctr: string;
      cpc: string;
      /** True when click volume is too low for CPC to be meaningful. */
      cpcUnreliable: boolean;
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

const MIN_CLICKS_FOR_CPC = 100;

export function buildFactSheet(
  model: HourlyReportBase,
  analysis: HourlyAnalysis = analyseHourly(model),
): FactSheet {
  const cur = model.client.currency as Currency;
  const money = (v: number) => formatCurrencyCompact(Math.round(v), cur);
  const pct = (v: number | null, dp = 2) => (v === null ? 'n/a' : formatPercent(v, dp));
  const num = (v: number) => Math.round(v).toLocaleString('en-US');

  const focus = model.focus;
  const hours = focus.hours;

  const allowed = new Set<string>();
  const track = <T extends string>(s: T): T => {
    for (const m of s.matchAll(/[\d][\d.,]*/g)) allowed.add(m[0]);
    return s;
  };

  const totals: Record<string, string> = {
    spend: track(money(model.windowTotals.spend)),
    impressions: track(num(model.windowTotals.impressions)),
    clicks: track(num(model.windowTotals.clicks)),
    ctr: track(pct(model.windowTotals.ctr)),
    cpc: track(model.windowTotals.cpc === null ? 'n/a' : money(model.windowTotals.cpc)),
    cpm: track(model.windowTotals.cpm === null ? 'n/a' : money(model.windowTotals.cpm)),
  };

  const comparison = model.comparison
    ? {
        basis: track(model.comparison.label),
        deltas: Object.fromEntries(
          Object.entries(model.comparison.deltas).map(([k, v]) => [
            k,
            track(v === null ? 'n/a' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`),
          ]),
        ),
      }
    : null;

  const peak = hours.length ? hours.reduce((a, b) => (b.spend > a.spend ? b : a)) : null;
  const trough = hours.length ? hours.reduce((a, b) => (b.spend < a.spend ? b : a)) : null;

  const mid = Math.floor(hours.length / 2);
  const firstHalf = hours.slice(0, mid).reduce((s, x) => s + x.spend, 0);
  const secondHalf = hours.slice(mid).reduce((s, x) => s + x.spend, 0);
  const totalHalves = firstHalf + secondHalf;

  const priced = hours.filter((x) => x.cpc !== null && x.clicks >= 20);
  const byCpc = [...priced].sort((a, b) => (a.cpc ?? 0) - (b.cpc ?? 0));
  const cheapest = byCpc[0] ?? null;
  const dearest = byCpc[byCpc.length - 1] ?? null;

  const bySpend = [...priced].sort((a, b) => b.spend - a.spend);
  const third = Math.max(1, Math.round(bySpend.length / 3));
  const pooled = (hs: typeof priced) => {
    const c = hs.reduce((s, x) => s + x.clicks, 0);
    return c > 0 ? hs.reduce((s, x) => s + x.spend, 0) / c : null;
  };
  const topCpc = pooled(bySpend.slice(0, third));
  const botCpc = pooled(bySpend.slice(-third));
  const ratio = topCpc && botCpc && botCpc > 0 ? topCpc / botCpc : null;

  const campaigns = model.campaigns.map((c) => ({
    name: c.name,
    objective: c.objective,
    spend: track(money(c.totals.spend)),
    shareOfSpend: track(
      model.windowTotals.spend > 0 ? formatPercent(c.totals.spend / model.windowTotals.spend, 0) : 'n/a',
    ),
    impressions: track(num(c.totals.impressions)),
    clicks: track(num(c.totals.clicks)),
    ctr: track(pct(c.totals.ctr)),
    cpc: track(c.totals.cpc === null ? 'n/a' : money(c.totals.cpc)),
    cpm: track(c.totals.cpm === null ? 'n/a' : money(c.totals.cpm)),
    adgroups: c.adgroups.map((a) => ({
      name: a.name,
      spend: track(money(a.totals.spend)),
      clicks: track(num(a.totals.clicks)),
      ctr: track(pct(a.totals.ctr)),
      cpc: track(a.totals.cpc === null ? 'n/a' : money(a.totals.cpc)),
      cpcUnreliable: a.totals.clicks < MIN_CLICKS_FOR_CPC,
    })),
  }));

  const sheet: FactSheet = {
    client: {
      name: model.client.name,
      currency: model.client.currency,
      timezone: model.client.timezone,
    },
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
      peak: peak
        ? { hour: track(hourLabel(peak.hour)), spend: track(money(peak.spend)) }
        : { hour: 'n/a', spend: 'n/a' },
      trough: trough
        ? { hour: track(hourLabel(trough.hour)), spend: track(money(trough.spend)) }
        : { hour: 'n/a', spend: 'n/a' },
      heavierHalfShare: track(
        totalHalves > 0 ? formatPercent(Math.max(firstHalf, secondHalf) / totalHalves, 0) : 'n/a',
      ),
      cheapestClickHour: cheapest
        ? {
            hour: track(hourLabel(cheapest.hour)),
            cpc: track(money(cheapest.cpc ?? 0)),
            ctr: track(pct(cheapest.ctr)),
          }
        : null,
      dearestClickHour: dearest
        ? {
            hour: track(hourLabel(dearest.hour)),
            cpc: track(money(dearest.cpc ?? 0)),
            ctr: track(pct(dearest.ctr)),
          }
        : null,
      spendWeightedCpcRatio: ratio ? track(`${ratio.toFixed(1)}×`) : null,
      hourly: hours.map((x) => ({
        hour: track(hourLabel(x.hour)),
        spend: track(money(x.spend)),
        impressions: track(num(x.impressions)),
        clicks: track(num(x.clicks)),
        ctr: track(pct(x.ctr)),
        cpc: track(x.cpc === null ? 'n/a' : money(x.cpc)),
        cpm: track(x.cpm === null ? 'n/a' : money(x.cpm)),
      })),
    },
    campaigns,
    dataGaps: [
      'The export contains no revenue or conversion-value column, so ROAS and CPA cannot be computed.',
      'The source is a TikTok Ads (paid) export; organic content performance is not included.',
      ...model.days
        .filter((d) => !d.coverage.isComplete && d.coverage.lastHour !== null)
        .map(
          (d) =>
            `${d.date} is incomplete — the export stops after ${hourLabel(d.coverage.lastHour!)}.`,
        ),
      ...model.days.flatMap((d) =>
        d.coverage.aggregatedHours
          .filter((a) => a.spanHours >= 3)
          .map(
            (a) =>
              `${d.date} ${hourLabel(a.hour)} carries ${a.spanHours} hours of accumulation, not one hour; it is excluded from hourly figures.`,
          ),
      ),
    ],
    establishedFindings: [
      analysis.daypart?.finding.body,
      analysis.efficiency?.finding.body,
      analysis.mix?.finding.body,
      analysis.adgroup?.finding.body,
    ].filter((x): x is string => Boolean(x)),
    allowedNumbers: [],
  };

  // Numbers appearing in the established findings are also fair game.
  for (const f of sheet.establishedFindings) track(f);

  sheet.allowedNumbers = [...allowed].sort();
  return sheet;
}
