import { formatCurrencyCompact, formatNumberCompact, formatPercent, NorthStar, type Currency } from '@tempo/core';
import type { HourPoint } from '@tempo/db';
import type { HourlyReportBase } from '../hourly-model.js';
import { hourLabel } from '../layout.js';

/**
 * The fact sheet handed to the model.
 *
 * This is the scaffolding that makes an LLM-written report trustworthy AND keeps
 * it focused on the right metric — and which metric that is depends on the
 * client's north star (see `@tempo/core`'s `NorthStar`):
 *   'vtr'         — no on-platform outcome exists (offline FMCG retail); the
 *                    sheet leads with impressions and the two view-through
 *                    rates, and omits conversion/ROAS fields entirely.
 *   'shop'        — real TikTok Shop purchases; the sheet leads with
 *                    conversions, CPA and ROAS, and omits VTR fields.
 *   'app_install'  — app installs are the buyable outcome; the sheet leads
 *                    with installs and cost-per-install, and omits VTR/ROAS.
 *
 * Fields for the "wrong" vertical are not merely de-emphasised in the brief —
 * they are absent from the JSON entirely, so a model cannot accidentally cite
 * a VTR figure for a Shop client or vice versa.
 *
 * The deterministic engine computes every figure first; the model is given
 * *only* those figures, pre-formatted, and may not introduce any other number.
 * `allowedNumbers` is the enforcement surface: after generation, every
 * number-like token in the output is checked against it (see verify.ts).
 */
export interface FactSheet {
  client: { name: string; currency: string; timezone: string };
  /** Which figure this client's report is built around — drives everything below. */
  northStar: NorthStar;
  /** Plain-language framing so a small model optimises for the right thing. */
  brief: string;
  window: { firstDate: string; lastDate: string; days: number; trueHours: number };
  /** Window-level headline. Which fields are present depends on `northStar`. */
  totals: {
    impressions: string;
    reach: string;
    frequency: string;
    spendContext: string;
    /** 'vtr' only. */
    vtr6s?: string;
    vtr15s?: string;
    videoWatched6s?: string;
    engagedView15s?: string;
    /** 'shop' / 'app_install' only. */
    clicks?: string;
    ctr?: string;
    conversions?: string;
    conversionValue?: string;
    cpa?: string;
    conversionRate?: string;
    roas?: string;
  };
  comparison: { basis: string; deltas: Record<string, string> } | null;
  focusDay: {
    date: string;
    hoursCovered: string;
    peakImpressionsHour: { hour: string; impressions: string } | null;
    /** 'vtr' only — the hour that viewed best/worst. */
    bestViewHour: { hour: string; vtr6s: string } | null;
    weakestViewHour: { hour: string; vtr6s: string } | null;
    /** 'shop' / 'app_install' only — the hour with the best/worst conversion rate. */
    bestConversionHour: { hour: string; conversionRate: string } | null;
    weakestConversionHour: { hour: string; conversionRate: string } | null;
    /** Share of the day's impressions delivered by its busiest third of hours. */
    impressionsConcentration: string;
    /** The hour-by-hour grain. Which columns are present depends on `northStar`. */
    hourly: Array<{
      hour: string;
      spend: string;
      impressions: string;
      cpm: string;
      vtr6s?: string;
      vtr15s?: string;
      clicks?: string;
      conversions?: string;
      cpa?: string;
    }>;
    /**
     * Does the money follow the outcome? The single most decision-relevant
     * relationship in this dataset, pre-computed so the model interprets it
     * rather than attempting statistics it cannot do. Ranked against VTR6s
     * for a 'vtr' client, against the click-to-conversion rate otherwise.
     */
    spendVsOutcome: {
      /** Plain-language direction of the spend↔outcome rank relationship. */
      direction: string;
      /** Spearman rank correlation of hourly spend against the outcome metric. */
      coefficient: string;
      /** Share of the day's spend landing in below-average-outcome hours. */
      spendInBelowAverageHours: string;
      /** What the day's spend actually bought, weighted by where it landed. */
      spendWeighted: string;
      /** What the same spend would have bought in the best hours. */
      bestCase: string;
      /** The three hours taking the most spend, with what they achieved. */
      heaviestSpendHours: Array<{ hour: string; spend: string; outcome: string }>;
      /** The three best-performing hours, with how little spend they took. */
      bestOutcomeHours: Array<{ hour: string; spend: string; outcome: string }>;
    } | null;
  };
  campaigns: Array<{
    name: string;
    objective: string;
    spend: string;
    shareOfSpend: string;
    impressions: string;
    shareOfImpressions: string;
    cpm: string;
    frequency: string;
    /** 'vtr' only. */
    vtr6s?: string;
    vtr15s?: string;
    /** 6s→15s retention: did this campaign's creative hold attention. 'vtr' only. */
    retention6to15?: string;
    /** 'shop' / 'app_install' only. */
    clicks?: string;
    ctr?: string;
    conversions?: string;
    cpa?: string;
    roas?: string;
    adgroups: Array<{
      name: string;
      spend: string;
      impressions: string;
      vtr6s?: string;
      vtr15s?: string;
      retention6to15?: string;
      clicks?: string;
      conversions?: string;
      cpa?: string;
      /** True when the volume is too thin for the rate to be meaningful. */
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

/** Below this, an hour/campaign/adgroup has too few impressions to trust a rate. */
const MIN_IMPRESSIONS_FOR_RATE = 5_000;
/** Below this, an hour/campaign/adgroup has too few clicks to trust a conversion rate. */
const MIN_CLICKS_FOR_RATE = 100;

/** Average ranks, so ties don't bias the correlation. */
function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j += 1;
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k]!.i] = shared;
    i = j + 1;
  }
  return out;
}

/**
 * Spearman rank correlation. Rank-based rather than Pearson because the
 * question is ordinal — do the heaviest-spend hours tend to be the
 * best-performing hours — and a single outlier hour should not swing the answer.
 */
function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 4) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (n + 1) / 2;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = rx[i]! - mean;
    const b = ry[i]! - mean;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

const BRIEFS: Record<NorthStar, (clientName: string) => string> = {
  [NorthStar.Vtr]: (name) =>
    `${name} is an FMCG brand whose products are already widely available in minimarkets and stores. ` +
    `Shoppers do not buy on TikTok — there is no in-app checkout; the purchase happens later, in person, at the nearest minimarket. ` +
    `The ad's job is mental availability: get people to watch long enough that the brand is top-of-mind at the shelf. ` +
    `Metric hierarchy, in order: (1) VTR is THE goal — VTR6s = 6-second views ÷ impressions (the message reached a watching person), ` +
    `VTR15s = 15-second views ÷ impressions (the creative held them long enough to register); ` +
    `(2) CPM matters as the price of the reach being bought, but ranks below VTR; ` +
    `(3) clicks, CTR and CPC are NOT meaningful — a click buys nothing, so never rank or recommend by them; ` +
    `(4) conversions and ROAS do not exist and never will, because TikTok cannot see an offline minimarket sale — this is structural, not a fixable data gap. ` +
    `Every recommendation must be a VTR move (creative or hour/placement) or, secondarily, a CPM-efficiency move — never a conversion, purchase, click, or ROAS recommendation. ` +
    `Read the report by hour: where impressions and VTR are strong, and where impressions are spent on hours that view poorly. ` +
    `The central allocation question is in focusDay.spendVsOutcome: does the money follow the views? Every hour, campaign and adgroup carries both its spend and its VTR, so say plainly where budget and viewing quality disagree — that gap is the report's most actionable finding.`,
  [NorthStar.Shop]: (name) =>
    `${name} sells through TikTok Shop — the purchase happens on-platform, so this brand has real, measurable conversions and revenue, unlike a brand that sells offline. ` +
    `Metric hierarchy, in order: (1) conversions (on-platform purchases) and the revenue they carry are THE goal; (2) CPA (cost per conversion) and ROAS (revenue ÷ spend) are how efficiently that goal is bought, and rank second; ` +
    `(3) CTR, CPC and CPM matter as the funnel that FEEDS conversions — a campaign with strong clicks but no conversions has a landing-page or offer problem, not a media problem — so read them as diagnostic context, never as the goal itself; ` +
    `(4) never invent a monetary ROAS or revenue figure beyond what the fact sheet states — if conversionValue/roas is absent or n/a for a period, say conversions occurred without a measurable revenue figure, do not estimate one. ` +
    `Every recommendation must be a conversion or ROAS move (creative, targeting, or hour/placement to lift purchases or lower CPA) — never a pure view-through or reach recommendation with no link to the outcome. ` +
    `Read the report by hour: where spend buys conversions efficiently, and where it is spent on hours or campaigns that convert poorly. ` +
    `The central allocation question is in focusDay.spendVsOutcome: does the money follow the conversions? Every hour, campaign and adgroup carries both its spend and its conversion performance, so say plainly where budget and conversion efficiency disagree — that gap is the report's most actionable finding.`,
  [NorthStar.AppInstall]: (name) =>
    `${name} runs TikTok ads to drive app installs — the install is the buyable, measurable outcome; there is no further on-platform revenue signal in this export. ` +
    `Metric hierarchy, in order: (1) app installs are THE goal; (2) CPI (cost per install) is how efficiently that goal is bought, and ranks second; ` +
    `(3) clicks and CTR matter as the funnel that FEEDS installs — a campaign with strong clicks but few installs has a store-listing or targeting-mismatch problem, not a media problem — so read them as diagnostic context, never as the goal itself; ` +
    `(4) CPM is tertiary context on the price of the reach being bought. ` +
    `Never invent a monetary value for an install — there is no revenue/ROAS figure in this export at all, so do not estimate one. ` +
    `Every recommendation must be an install or CPI move (creative, targeting, or hour/placement to lift installs or lower CPI) — never a pure view-through, reach, or revenue recommendation. ` +
    `Read the report by hour: where spend buys installs efficiently, and where it is spent on hours or campaigns that convert poorly to installs. ` +
    `The central allocation question is in focusDay.spendVsOutcome: does the money follow the installs? Every hour, campaign and adgroup carries both its spend and its install performance, so say plainly where budget and install efficiency disagree — that gap is the report's most actionable finding.`,
};

export function buildFactSheet(model: HourlyReportBase): FactSheet {
  const cur = model.client.currency as Currency;
  const money = (v: number) => formatCurrencyCompact(Math.round(v), cur);
  const num = (v: number) => formatNumberCompact(Math.round(v));
  const pct = (v: number | null, dp = 2) => (v === null ? 'n/a' : formatPercent(v, dp));
  const mult = (v: number | null) => (v === null ? 'n/a' : `${v.toFixed(1)}×`);

  const northStar = model.client.northStar;
  const isVtr = northStar === NorthStar.Vtr;

  const t = model.windowTotals;
  const focus = model.focus;
  const hours = focus.hours;

  const allowed = new Set<string>();
  const track = <T extends string>(s: T): T => {
    for (const m of s.matchAll(/[\d][\d.,]*/g)) allowed.add(m[0]);
    return s;
  };

  const totals: FactSheet['totals'] = {
    impressions: track(num(t.impressions)),
    reach: track(num(t.reach)),
    frequency: track(mult(t.frequency)),
    spendContext: track(money(t.spend)),
    ...(isVtr
      ? {
          vtr6s: track(pct(t.vtr6s)),
          vtr15s: track(pct(t.vtr15s)),
          videoWatched6s: track(num(t.videoWatched6s)),
          engagedView15s: track(num(t.engagedView15s)),
        }
      : {
          clicks: track(num(t.clicks)),
          ctr: track(pct(t.ctr)),
          conversions: track(num(t.conversions)),
          ...(t.conversionValue > 0 ? { conversionValue: track(money(t.conversionValue)) } : {}),
          cpa: track(t.cpa === null ? 'n/a' : money(t.cpa)),
          conversionRate: track(pct(t.conversionRate)),
          ...(t.roas !== null ? { roas: track(mult(t.roas)) } : {}),
        }),
  };

  const comparison = model.comparison
    ? {
        basis: track(model.comparison.label),
        deltas: Object.fromEntries(
          Object.entries(model.comparison.deltas)
            .filter(([k]) =>
              isVtr
                ? ['impressions', 'reach', 'vtr6s', 'vtr15s'].includes(k)
                : ['impressions', 'clicks', 'ctr', 'conversions', 'cpa', 'roas'].includes(k),
            )
            .map(([k, v]) => [
              k,
              track(v === null ? 'n/a' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`),
            ]),
        ),
      }
    : null;

  // Hours thick enough for the outcome rate to mean something.
  const solid = hours.filter((x) => x.impressions >= MIN_IMPRESSIONS_FOR_RATE);
  const outcomeOf = (x: HourPoint): number | null => (isVtr ? x.vtr6s : x.conversionRate);
  const ratedSolid = isVtr ? solid : solid.filter((x) => x.clicks >= MIN_CLICKS_FOR_RATE);
  const byOutcome = [...ratedSolid].sort((a, b) => (outcomeOf(a) ?? 0) - (outcomeOf(b) ?? 0));
  const best = byOutcome[byOutcome.length - 1] ?? null;
  const weakest = byOutcome[0] ?? null;
  const peakImpr = hours.length ? hours.reduce((a, b) => (b.impressions > a.impressions ? b : a)) : null;

  // Impressions concentration: the busiest third of hours' share of the day.
  const totalImpr = hours.reduce((s, x) => s + x.impressions, 0);
  const bySize = [...hours].sort((a, b) => b.impressions - a.impressions);
  const topThird = bySize.slice(0, Math.max(1, Math.round(hours.length / 3)));
  const concentration = totalImpr > 0 ? topThird.reduce((s, x) => s + x.impressions, 0) / totalImpr : null;

  // 6s→15s retention: of those who started watching, how many stayed. 'vtr' only.
  const retentionOf = (w6: number, e15: number) => (w6 > 0 ? e15 / w6 : null);

  // Entity names are quotable verbatim — the prompt asks the model to name the
  // specific campaign or adgroup at fault. Many carry digits ("… | 1 - 30 Jun
  // 2026"), so those tokens must be allowed or a correct citation is punished
  // as a fabrication.
  const campaigns: FactSheet['campaigns'] = model.campaigns.map((c) => ({
    name: track(c.name),
    objective: c.objective,
    spend: track(money(c.totals.spend)),
    shareOfSpend: track(t.spend > 0 ? formatPercent(c.totals.spend / t.spend, 0) : 'n/a'),
    impressions: track(num(c.totals.impressions)),
    shareOfImpressions: track(
      t.impressions > 0 ? formatPercent(c.totals.impressions / t.impressions, 0) : 'n/a',
    ),
    cpm: track(c.totals.cpm === null ? 'n/a' : money(c.totals.cpm)),
    frequency: track(mult(c.totals.frequency)),
    ...(isVtr
      ? {
          vtr6s: track(pct(c.totals.vtr6s)),
          vtr15s: track(pct(c.totals.vtr15s)),
          retention6to15: track(pct(retentionOf(c.totals.videoWatched6s, c.totals.engagedView15s), 0)),
        }
      : {
          clicks: track(num(c.totals.clicks)),
          ctr: track(pct(c.totals.ctr)),
          conversions: track(num(c.totals.conversions)),
          cpa: track(c.totals.cpa === null ? 'n/a' : money(c.totals.cpa)),
          ...(c.totals.roas !== null ? { roas: track(mult(c.totals.roas)) } : {}),
        }),
    adgroups: c.adgroups.map((a) => ({
      name: track(a.name),
      spend: track(money(a.totals.spend)),
      impressions: track(num(a.totals.impressions)),
      ...(isVtr
        ? {
            vtr6s: track(pct(a.totals.vtr6s)),
            vtr15s: track(pct(a.totals.vtr15s)),
            retention6to15: track(pct(retentionOf(a.totals.videoWatched6s, a.totals.engagedView15s), 0)),
          }
        : {
            clicks: track(num(a.totals.clicks)),
            conversions: track(num(a.totals.conversions)),
            cpa: track(a.totals.cpa === null ? 'n/a' : money(a.totals.cpa)),
          }),
      rateUnreliable: isVtr
        ? a.totals.impressions < MIN_IMPRESSIONS_FOR_RATE
        : a.totals.clicks < MIN_CLICKS_FOR_RATE,
    })),
  }));

  // --- Does the money follow the outcome? ------------------------------------
  // Restricted to hours thick enough for the rate to mean anything, so a sliver
  // of an hour cannot masquerade as the day's best placement.
  const spendVsOutcome = (() => {
    const pool = isVtr ? solid : ratedSolid;
    if (pool.length < 4) return null;
    const spends = pool.map((x) => x.spend);
    const outcomes = pool.map((x) => outcomeOf(x) ?? 0);
    const coef = spearman(spends, outcomes);

    const totalSpend = spends.reduce((s, v) => s + v, 0);
    if (totalSpend <= 0) return null;

    // Baseline is the volume-weighted rate — what the day actually achieved.
    const avgOutcome = isVtr
      ? (() => {
          const impr = pool.reduce((s, x) => s + x.impressions, 0);
          const w6 = pool.reduce((s, x) => s + x.videoWatched6s, 0);
          return impr > 0 ? w6 / impr : 0;
        })()
      : (() => {
          const clicks = pool.reduce((s, x) => s + x.clicks, 0);
          const conv = pool.reduce((s, x) => s + x.conversions, 0);
          return clicks > 0 ? conv / clicks : 0;
        })();

    const belowSpend = pool
      .filter((x) => (outcomeOf(x) ?? 0) < avgOutcome)
      .reduce((s, x) => s + x.spend, 0);

    // What the spend actually bought, vs. the same spend in the best hours.
    const spendWeighted = pool.reduce((s, x) => s + x.spend * (outcomeOf(x) ?? 0), 0) / totalSpend;
    const byOutcomeDesc = [...pool].sort((a, b) => (outcomeOf(b) ?? 0) - (outcomeOf(a) ?? 0));
    let remaining = totalSpend;
    let bestCase = 0;
    for (const x of byOutcomeDesc) {
      if (remaining <= 0) break;
      // Cap reallocation at each hour's observed spend ceiling, so the
      // best case stays a plausible reshuffle rather than a fantasy.
      const take = Math.min(remaining, totalSpend / pool.length);
      bestCase += take * (outcomeOf(x) ?? 0);
      remaining -= take;
    }
    const bestCaseOutcome = totalSpend > 0 ? bestCase / (totalSpend - Math.max(0, remaining)) : 0;

    const fmtOutcome = isVtr ? (v: number) => pct(v) : (v: number) => pct(v);
    const trio = (xs: readonly HourPoint[]) =>
      xs.slice(0, 3).map((x) => ({
        hour: track(hourLabel(x.hour)),
        spend: track(money(x.spend)),
        outcome: track(fmtOutcome(outcomeOf(x) ?? 0)),
      }));

    return {
      direction: track(
        coef === null
          ? 'n/a'
          : coef <= -0.3
            ? `negative — spend concentrates in the hours that ${isVtr ? 'view' : 'convert'} worst`
            : coef >= 0.3
              ? `positive — spend concentrates in the hours that ${isVtr ? 'view' : 'convert'} best`
              : 'flat — spend is placed with little regard to how hours perform',
      ),
      coefficient: track(coef === null ? 'n/a' : coef.toFixed(2)),
      spendInBelowAverageHours: track(formatPercent(belowSpend / totalSpend, 0)),
      spendWeighted: track(fmtOutcome(spendWeighted)),
      bestCase: track(fmtOutcome(bestCaseOutcome)),
      heaviestSpendHours: trio([...pool].sort((a, b) => b.spend - a.spend)),
      bestOutcomeHours: trio(byOutcomeDesc),
    };
  })();

  const sheet: FactSheet = {
    client: {
      name: track(model.client.name),
      currency: model.client.currency,
      timezone: model.client.timezone,
    },
    northStar,
    brief: BRIEFS[northStar](model.client.name),
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
      bestViewHour: isVtr && best ? { hour: track(hourLabel(best.hour)), vtr6s: track(pct(best.vtr6s)) } : null,
      weakestViewHour:
        isVtr && weakest ? { hour: track(hourLabel(weakest.hour)), vtr6s: track(pct(weakest.vtr6s)) } : null,
      bestConversionHour:
        !isVtr && best
          ? { hour: track(hourLabel(best.hour)), conversionRate: track(pct(best.conversionRate)) }
          : null,
      weakestConversionHour:
        !isVtr && weakest
          ? { hour: track(hourLabel(weakest.hour)), conversionRate: track(pct(weakest.conversionRate)) }
          : null,
      impressionsConcentration: track(concentration === null ? 'n/a' : formatPercent(concentration, 0)),
      hourly: hours.map((x) => ({
        hour: track(hourLabel(x.hour)),
        spend: track(money(x.spend)),
        impressions: track(num(x.impressions)),
        cpm: track(x.cpm === null ? 'n/a' : money(x.cpm)),
        ...(isVtr
          ? { vtr6s: track(pct(x.vtr6s)), vtr15s: track(pct(x.vtr15s)) }
          : {
              clicks: track(num(x.clicks)),
              conversions: track(num(x.conversions)),
              cpa: track(x.cpa === null ? 'n/a' : money(x.cpa)),
            }),
      })),
      spendVsOutcome,
    },
    campaigns,
    dataGaps: isVtr
      ? [
          'The export contains no revenue or conversion-value column, so ROAS and CPA cannot be computed.',
          'The source is a TikTok Ads (paid) export; organic content performance is not included.',
          ...incompleteDayGaps(model),
        ]
      : [
          'The source is a TikTok Ads (paid) export; organic content performance is not included.',
          ...(northStar === NorthStar.AppInstall
            ? ['This export tracks installs only — no post-install revenue or in-app event data exists.']
            : []),
          ...incompleteDayGaps(model),
        ],
    establishedFindings: buildFindings(
      model,
      { best, weakest, concentration, spendVsOutcome },
      { pct, mult, num, money },
    ),
    allowedNumbers: [],
  };

  for (const f of sheet.establishedFindings) track(f);
  sheet.allowedNumbers = [...allowed].sort();
  return sheet;
}

function incompleteDayGaps(model: HourlyReportBase): string[] {
  return [
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
  ];
}

/**
 * Outcome-based grounding, computed here rather than pulled from a separate
 * analysis engine, so the model's starting facts match the brief exactly.
 */
function buildFindings(
  model: HourlyReportBase,
  ctx: {
    best: HourPoint | null;
    weakest: HourPoint | null;
    concentration: number | null;
    spendVsOutcome: FactSheet['focusDay']['spendVsOutcome'];
  },
  fmt: {
    pct: (v: number | null, dp?: number) => string;
    mult: (v: number | null) => string;
    num: (v: number) => string;
    money: (v: number) => string;
  },
): string[] {
  const t = model.windowTotals;
  const isVtr = model.client.northStar === NorthStar.Vtr;
  const out: string[] = [];

  if (isVtr) {
    out.push(
      `Across ${model.totalHours} observed hours, ${fmt.num(t.impressions)} impressions returned a ${fmt.pct(t.vtr6s)} 6-second view-through rate and a ${fmt.pct(t.vtr15s)} 15-second rate.`,
    );
    const retention = t.videoWatched6s > 0 ? t.engagedView15s / t.videoWatched6s : null;
    if (retention !== null) {
      out.push(
        `Of viewers who watched 6 seconds, ${fmt.pct(retention, 0)} went on to a 15-second engaged view — the depth signal for creative that holds attention.`,
      );
    }
    if (ctx.best && ctx.weakest && ctx.best.hour !== ctx.weakest.hour) {
      out.push(
        `The strongest viewing hour is ${String(ctx.best.hour).padStart(2, '0')}:00 at ${fmt.pct(ctx.best.vtr6s)} VTR6s, against ${String(ctx.weakest.hour).padStart(2, '0')}:00 at ${fmt.pct(ctx.weakest.vtr6s)} — the same impression is worth more in some hours than others.`,
      );
    }
  } else {
    out.push(
      `Across ${model.totalHours} observed hours, ${fmt.num(t.clicks)} clicks returned ${fmt.num(t.conversions)} conversions — a ${fmt.pct(t.conversionRate)} click-to-conversion rate at a ${t.cpa === null ? 'n/a cost per conversion' : `${fmt.money(t.cpa)} cost per conversion`}.`,
    );
    if (ctx.best && ctx.weakest && ctx.best.hour !== ctx.weakest.hour) {
      out.push(
        `The strongest converting hour is ${String(ctx.best.hour).padStart(2, '0')}:00 at ${fmt.pct(ctx.best.conversionRate)} conversion rate, against ${String(ctx.weakest.hour).padStart(2, '0')}:00 at ${fmt.pct(ctx.weakest.conversionRate)} — the same click is worth more in some hours than others.`,
      );
    }
  }

  if (ctx.concentration !== null) {
    out.push(
      `The busiest third of hours carries ${fmt.pct(ctx.concentration, 0)} of the day's impressions; whether those hours also perform well decides how efficiently reach is bought.`,
    );
  }

  const sv = ctx.spendVsOutcome;
  if (sv) {
    out.push(
      `Spend against ${isVtr ? 'viewing quality' : 'conversion performance'} by hour is ${sv.direction} (rank correlation ${sv.coefficient}). ${sv.spendInBelowAverageHours} of the day's spend lands in hours that perform below the day's own average.`,
    );
    out.push(
      `Weighted by where the money actually went, the day achieved a ${sv.spendWeighted} ${isVtr ? 'VTR6s' : 'conversion rate'}; the same budget placed into the best-performing hours would have achieved ${sv.bestCase}. That difference is the size of the dayparting prize.`,
    );
  }

  if (t.frequency !== null) {
    out.push(
      isVtr
        ? `Frequency is ${fmt.mult(t.frequency)} — each reached person saw the ad about that many times, which trades new reach against repetition.`
        : `Frequency is ${fmt.mult(t.frequency)} — each reached person saw the ad about that many times before converting or not.`,
    );
  }

  return out;
}
