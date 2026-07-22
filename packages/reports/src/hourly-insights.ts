import { formatCurrencyCompact, formatPercent, type Currency } from '@tempo/core';
import type { HourPoint, HourlyDashboardData } from '@tempo/db';
import type { HourlyReportBase } from './hourly-model.js';
import { hourLabel } from './layout.js';

/**
 * Narrative for the intraday report, derived strictly from what the export
 * contains. Every statement here is backed by a value in the model — there is
 * no ROAS, conversion or organic commentary because the source has no such
 * data.
 */
export interface HourlyInsights {
  headline: string;
  /** Findings about the shape of the day. */
  summary: string[];
  /** Statements about what the source does and does not cover. */
  coverage: string[];
  /** Campaign / adgroup observations. */
  campaigns: string[];
}

/**
 * Pick the extreme hour for a derived metric, ignoring hours too small to be
 * meaningful — a single-click hour can post a spectacular CTR that says
 * nothing. The floor is relative to the day, not an absolute guess.
 */
function extremeHour(
  hours: readonly HourPoint[],
  pick: (h: HourPoint) => number | null,
  dir: 'max' | 'min',
): HourPoint | null {
  const totalImpr = hours.reduce((s, h) => s + h.impressions, 0);
  if (totalImpr === 0) return null;
  const floor = (totalImpr / Math.max(1, hours.length)) * 0.2;

  let best: HourPoint | null = null;
  let bestVal = dir === 'max' ? -Infinity : Infinity;
  for (const h of hours) {
    if (h.impressions < floor) continue;
    const v = pick(h);
    if (v === null) continue;
    if (dir === 'max' ? v > bestVal : v < bestVal) {
      bestVal = v;
      best = h;
    }
  }
  return best;
}

export function buildHourlyInsights(
  model: HourlyReportBase,
  perDay: readonly HourlyDashboardData[],
): HourlyInsights {
  const { copy, client, focus, days, windowTotals, totalHours, campaigns } = model;
  const h = copy.hourly;
  const cur = client.currency as Currency;
  const money = (v: number) => formatCurrencyCompact(Math.round(v), cur);

  const headline = h.headline({
    name: client.name,
    spend: money(windowTotals.spend),
    hours: totalHours,
    days: days.length,
  });

  // Shape of the day. `focus` is already the most complete day, and the charts
  // render that same day — narrative and visuals must not describe different
  // days.
  const hours = focus.hours;

  const summary: string[] = [];

  if (hours.length >= 2) {
    const peak = hours.reduce((a, b) => (b.spend > a.spend ? b : a));
    const trough = hours.reduce((a, b) => (b.spend < a.spend ? b : a));
    summary.push(
      h.peakTrough({
        peak: hourLabel(peak.hour),
        peakSpend: money(peak.spend),
        trough: hourLabel(trough.hour),
        troughSpend: money(trough.spend),
      }),
    );

    // Which half of the observed day carries the spend.
    const mid = Math.floor(hours.length / 2);
    const firstHalf = hours.slice(0, mid).reduce((s, x) => s + x.spend, 0);
    const secondHalf = hours.slice(mid).reduce((s, x) => s + x.spend, 0);
    const total = firstHalf + secondHalf;
    if (total > 0) {
      const secondBigger = secondHalf >= firstHalf;
      summary.push(
        h.pacingNarrative({
          half: secondBigger
            ? copy.locale === 'id'
              ? 'kedua'
              : 'second'
            : copy.locale === 'id'
              ? 'pertama'
              : 'first',
          share: formatPercent((secondBigger ? secondHalf : firstHalf) / total, 0),
        }),
      );
    }

    const bestCtr = extremeHour(hours, (x) => x.ctr, 'max');
    const worstCtr = extremeHour(hours, (x) => x.ctr, 'min');
    if (bestCtr && worstCtr && bestCtr.hour !== worstCtr.hour) {
      summary.push(
        h.ctrSwing({
          best: hourLabel(bestCtr.hour),
          bestCtr: formatPercent(bestCtr.ctr ?? 0),
          worst: hourLabel(worstCtr.hour),
          worstCtr: formatPercent(worstCtr.ctr ?? 0),
        }),
      );
    }

    const cheapCpc = extremeHour(hours, (x) => x.cpc, 'min');
    const dearCpc = extremeHour(hours, (x) => x.cpc, 'max');
    if (cheapCpc && dearCpc && cheapCpc.hour !== dearCpc.hour) {
      summary.push(
        h.cpcSwing({
          best: hourLabel(cheapCpc.hour),
          bestCpc: money(cheapCpc.cpc ?? 0),
          worst: hourLabel(dearCpc.hour),
          worstCpc: money(dearCpc.cpc ?? 0),
        }),
      );
    }
  }

  // Like-for-like day comparison, taken straight from the read-model so the
  // matched-hours basis is identical to the dashboard's.
  const latest = perDay[perDay.length - 1];
  if (latest?.comparison) {
    const c = latest.comparison;
    summary.push(
      h.dayCompare({
        date: shortIso(latest.date, copy.months, copy.dayFirst),
        prev: money(c.previous.spend),
        spend: money(c.current.spend),
        hours: c.hoursMatched.length,
      }),
    );
  }

  // --- What the source does and does not cover ------------------------------
  const coverage: string[] = [h.coverage.hoursCounted({ hours: totalHours, days: days.length })];

  const material = days.flatMap((d) =>
    d.coverage.aggregatedHours
      .filter((a) => a.spanHours >= 3)
      .map((a) => `${shortIso(d.date, copy.months, copy.dayFirst)} ${hourLabel(a.hour)}`),
  );
  if (material.length > 0) coverage.push(h.coverage.aggregated({ hours: material.join(', ') }));

  for (const d of days) {
    if (!d.coverage.isComplete && d.coverage.lastHour !== null) {
      coverage.push(
        h.coverage.incomplete({
          date: shortIso(d.date, copy.months, copy.dayFirst),
          last: hourLabel(d.coverage.lastHour),
        }),
      );
    }
  }
  coverage.push(h.coverage.noRevenue, h.coverage.paidOnly);

  // --- Campaign / adgroup observations --------------------------------------
  const campaignNotes: string[] = [];
  const top = campaigns[0];
  if (top && windowTotals.spend > 0) {
    campaignNotes.push(
      h.topCampaign({
        name: top.name,
        spend: money(top.totals.spend),
        share: formatPercent(top.totals.spend / windowTotals.spend, 0),
      }),
    );
  }

  // An adgroup paying markedly more per click than its siblings is the single
  // most actionable thing in this dataset, so surface it explicitly.
  //
  // Only where click volume makes a cost-per-click rate stable. A video-views
  // adgroup that took 43 clicks on 10M impressions has a nominally enormous
  // CPC, but that number is sampling noise, not overspending — commenting on
  // it would bury the one comparison that is real.
  const MIN_CLICKS_FOR_CPC = 100;
  for (const c of campaigns) {
    const priced = c.adgroups.filter(
      (a) => a.totals.cpc !== null && a.totals.clicks >= MIN_CLICKS_FOR_CPC,
    );
    if (priced.length < 2) continue;
    const sorted = [...priced].sort((a, b) => (a.totals.cpc ?? 0) - (b.totals.cpc ?? 0));
    const worst = sorted[sorted.length - 1]!;
    const peers = sorted.slice(0, -1);
    const peerSpend = peers.reduce((s, a) => s + a.totals.spend, 0);
    const peerClicks = peers.reduce((s, a) => s + a.totals.clicks, 0);
    if (peerClicks < MIN_CLICKS_FOR_CPC) continue;
    const peerCpc = peerSpend / peerClicks;
    const worstCpc = worst.totals.cpc ?? 0;
    if (peerCpc <= 0 || worstCpc / peerCpc < 1.5) continue;
    campaignNotes.push(
      h.adgroupOutlier({
        name: worst.name,
        cpc: money(worstCpc),
        peerCpc: money(peerCpc),
        multiple: `${(worstCpc / peerCpc).toFixed(1)}×`,
      }),
    );
  }

  return { headline, summary, coverage, campaigns: campaignNotes };
}

function shortIso(iso: string, months: string[], dayFirst: boolean): string {
  const [, m, d] = iso.split('-').map(Number);
  const mon = months[(m ?? 1) - 1];
  return dayFirst ? `${d} ${mon}` : `${mon} ${d}`;
}
