import { formatCurrencyCompact, formatNumberCompact, formatPercent, type Currency } from '@tempo/core';
import type { CampaignBreakdown, HourPoint } from '@tempo/db';
import type { HourlyReportBase } from './hourly-model.js';
import { hourLabel, type CalloutTone, type Severity } from './layout.js';

/**
 * The analytical layer: named findings, a prioritized risk register and an
 * outlook — the things that make a report an argument rather than a data dump.
 *
 * Every statement is derived from a figure present in the model. Where the
 * data cannot support a claim (no revenue, too few clicks to price a channel),
 * the finding is withheld rather than softened, and the gap itself is reported.
 */

export interface Finding {
  title: string;
  body: string;
  tone: CalloutTone;
}

export interface RiskItem {
  risk: string;
  severity: Severity;
  action: string;
  owner: string;
}

export interface HourlyAnalysis {
  summaryProse: string;
  daypart: { finding: Finding; prose: string } | null;
  efficiency: { finding: Finding; prose: string } | null;
  mix: { finding: Finding; prose: string; rows: CampaignBreakdown[] } | null;
  adgroup: { finding: Finding; prose: string } | null;
  dataGap: Finding;
  risks: RiskItem[];
  outlook: string[];
  confidence: 'High' | 'Medium' | 'Low';
}

/** Clicks below this make a cost-per-click rate too noisy to act on. */
const MIN_CLICKS_FOR_CPC = 100;

/**
 * Pick the extreme hour for a derived metric, ignoring hours too thin to be
 * meaningful. A single-click hour can post a spectacular rate that says nothing.
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
    if (h.impressions < floor || h.clicks < 20) continue;
    const v = pick(h);
    if (v === null) continue;
    if (dir === 'max' ? v > bestVal : v < bestVal) {
      bestVal = v;
      best = h;
    }
  }
  return best;
}

/** Contiguous window label for the busiest third of the day, e.g. "13:00–22:00". */
function busyWindow(hours: readonly HourPoint[]): { label: string; share: number } | null {
  if (hours.length < 4) return null;
  const total = hours.reduce((s, h) => s + h.spend, 0);
  if (total <= 0) return null;
  const sorted = [...hours].sort((a, b) => b.spend - a.spend);
  const topN = Math.max(2, Math.round(hours.length / 3));
  const top = sorted.slice(0, topN);
  const share = top.reduce((s, h) => s + h.spend, 0) / total;
  const lo = Math.min(...top.map((h) => h.hour));
  const hi = Math.max(...top.map((h) => h.hour));
  return { label: `${hourLabel(lo)}–${hourLabel(hi)}`, share };
}

export function analyseHourly(model: HourlyReportBase): HourlyAnalysis {
  const { copy, client, focus, days, windowTotals, totalHours, campaigns } = model;
  const h = copy.hourly;
  const cur = client.currency as Currency;
  const money = (v: number) => formatCurrencyCompact(Math.round(v), cur);
  const hours = focus.hours;

  const summaryProse = h.narrative.summary({
    name: client.name,
    days: days.length,
    hours: totalHours,
    impressions: formatNumberCompact(windowTotals.impressions),
    vtr6s: windowTotals.vtr6s === null ? h.notReported : formatPercent(windowTotals.vtr6s),
    vtr15s: windowTotals.vtr15s === null ? h.notReported : formatPercent(windowTotals.vtr15s),
  });

  const risks: RiskItem[] = [];

  // --- Dayparting ------------------------------------------------------------
  let daypart: HourlyAnalysis['daypart'] = null;
  if (hours.length >= 4) {
    const peak = hours.reduce((a, b) => (b.spend > a.spend ? b : a));
    const trough = hours.reduce((a, b) => (b.spend < a.spend ? b : a));
    const multiple = trough.spend > 0 ? peak.spend / trough.spend : null;
    const mid = Math.floor(hours.length / 2);
    const firstHalf = hours.slice(0, mid).reduce((s, x) => s + x.spend, 0);
    const secondHalf = hours.slice(mid).reduce((s, x) => s + x.spend, 0);
    const total = firstHalf + secondHalf;
    const heavier = Math.max(firstHalf, secondHalf);
    const shareStr = total > 0 ? formatPercent(heavier / total, 0) : h.notReported;
    const multipleStr = multiple ? `${multiple.toFixed(1)}×` : h.notReported;

    daypart = {
      finding: {
        title: h.calloutTitles.daypart,
        body: h.findings.daypart({
          peak: hourLabel(peak.hour),
          peakSpend: money(peak.spend),
          trough: hourLabel(trough.hour),
          troughSpend: money(trough.spend),
          multiple: multipleStr,
        }),
        tone: 'insight',
      },
      prose: h.narrative.daypart({
        peak: hourLabel(peak.hour),
        trough: hourLabel(trough.hour),
        multiple: multipleStr,
        share: shareStr,
      }),
    };
  }

  // --- Hourly efficiency, and whether spend sits in the expensive hours -----
  let efficiency: HourlyAnalysis['efficiency'] = null;
  const cheap = extremeHour(hours, (x) => x.cpc, 'min');
  const dear = extremeHour(hours, (x) => x.cpc, 'max');
  const bestCtr = extremeHour(hours, (x) => x.ctr, 'max');
  const worstCtr = extremeHour(hours, (x) => x.ctr, 'min');

  if (cheap && dear && cheap.hour !== dear.hour && cheap.cpc && dear.cpc) {
    const spread = dear.cpc / cheap.cpc;
    const spreadStr = `${spread.toFixed(1)}×`;

    /**
     * "Inversion" means the hours taking the most budget are also the ones
     * paying most per click — the condition that makes dayparting worth doing.
     *
     * Measured by pooling the top-spend third of hours against the bottom-spend
     * third, rather than testing a single extreme hour against the median: one
     * hour sitting a hair either side of the median flipped the verdict and
     * produced a "broadly stable" claim over a 20× spread.
     */
    const priced = hours.filter((x) => x.cpc !== null && x.clicks >= 20);
    const bySpend = [...priced].sort((a, b) => b.spend - a.spend);
    const third = Math.max(1, Math.round(bySpend.length / 3));
    const pooledCpc = (hs: HourPoint[]): number | null => {
      const c = hs.reduce((s, x) => s + x.clicks, 0);
      return c > 0 ? hs.reduce((s, x) => s + x.spend, 0) / c : null;
    };
    const topCpc = pooledCpc(bySpend.slice(0, third));
    const botCpc = pooledCpc(bySpend.slice(-third));
    const concentration = topCpc && botCpc && botCpc > 0 ? topCpc / botCpc : null;
    const inverted = concentration !== null && concentration >= 1.5;

    efficiency = {
      finding: {
        title: h.calloutTitles.efficiency,
        body: inverted
          ? h.findings.efficiencyInversion({
              cheap: hourLabel(cheap.hour),
              cheapCpc: money(cheap.cpc),
              dear: hourLabel(dear.hour),
              dearCpc: money(dear.cpc),
              multiple: spreadStr,
            })
          : spread >= 1.5
            ? // A real spread exists, but budget is not sitting in the costly
              // hours — report the spread rather than calling it stable.
              h.findings.efficiencySpreadOnly({
                cheap: hourLabel(cheap.hour),
                dear: hourLabel(dear.hour),
                multiple: spreadStr,
              })
            : h.findings.efficiencyStable({ spread: `${money(cheap.cpc)} – ${money(dear.cpc)}` }),
        tone: inverted ? 'warning' : 'insight',
      },
      prose: h.narrative.efficiency({
        cheap: hourLabel(cheap.hour),
        dear: hourLabel(dear.hour),
        multiple: spreadStr,
        ctrBest: bestCtr?.ctr != null ? formatPercent(bestCtr.ctr) : h.notReported,
        ctrWorst: worstCtr?.ctr != null ? formatPercent(worstCtr.ctr) : h.notReported,
      }),
    };

    if (inverted) {
      risks.push({
        risk: h.risks.inversion.risk({
          dear: hourLabel(dear.hour),
          multiple: `${concentration!.toFixed(1)}×`,
        }),
        severity: concentration! >= 3 ? 'high' : 'medium',
        action: h.risks.inversion.action({
          cheap: hourLabel(cheap.hour),
          dear: hourLabel(dear.hour),
        }),
        owner: h.owners.media,
      });
    }
  }

  // --- Campaign mix ----------------------------------------------------------
  let mix: HourlyAnalysis['mix'] = null;
  const top = campaigns[0];
  if (top && windowTotals.spend > 0) {
    const share = top.totals.spend / windowTotals.spend;
    const shareStr = formatPercent(share, 0);
    mix = {
      finding: {
        title: h.calloutTitles.mix,
        body: h.findings.mix({ name: top.name, share: shareStr }),
        tone: share >= 0.5 ? 'warning' : 'insight',
      },
      prose: h.narrative.mix({ name: top.name, share: shareStr, count: campaigns.length }),
      rows: campaigns,
    };
    if (share >= 0.5) {
      risks.push({
        risk: h.risks.concentration.risk({ name: top.name, share: shareStr }),
        severity: share >= 0.7 ? 'high' : 'medium',
        action: h.risks.concentration.action,
        owner: h.owners.media,
      });
    }
  }

  // A campaign burning budget with essentially no clicks is worth naming, but
  // only where a click was ever a plausible outcome.
  for (const c of campaigns) {
    if (c.totals.spend < windowTotals.spend * 0.1) continue;
    if (c.totals.impressions < 100_000) continue;
    const ctr = c.totals.ctr ?? 0;
    if (ctr >= 0.0005) continue;
    risks.push({
      risk: h.risks.zeroClick.risk({ name: c.name }),
      severity: 'low',
      action: h.risks.zeroClick.action,
      owner: h.owners.creative,
    });
  }

  // --- Adgroup efficiency ----------------------------------------------------
  let adgroup: HourlyAnalysis['adgroup'] = null;
  const adgroupCount = campaigns.reduce((n, c) => n + c.adgroups.length, 0);
  let worstOutlier: { name: string; cpc: number; peerCpc: number; multiple: number } | null = null;

  for (const c of campaigns) {
    const priced = c.adgroups.filter(
      (a) => a.totals.cpc !== null && a.totals.clicks >= MIN_CLICKS_FOR_CPC,
    );
    if (priced.length < 2) continue;
    const sorted = [...priced].sort((a, b) => (a.totals.cpc ?? 0) - (b.totals.cpc ?? 0));
    const worst = sorted[sorted.length - 1]!;
    const peers = sorted.slice(0, -1);
    const peerClicks = peers.reduce((s, a) => s + a.totals.clicks, 0);
    if (peerClicks < MIN_CLICKS_FOR_CPC) continue;
    const peerCpc = peers.reduce((s, a) => s + a.totals.spend, 0) / peerClicks;
    const cpc = worst.totals.cpc ?? 0;
    if (peerCpc <= 0 || cpc / peerCpc < 1.5) continue;
    const cand = { name: worst.name, cpc, peerCpc, multiple: cpc / peerCpc };
    if (!worstOutlier || cand.multiple > worstOutlier.multiple) worstOutlier = cand;
  }

  if (adgroupCount > 0) {
    adgroup = {
      finding: {
        title: h.calloutTitles.adgroup,
        body: worstOutlier
          ? h.findings.adgroupOutlier({
              name: worstOutlier.name,
              cpc: money(worstOutlier.cpc),
              peerCpc: money(worstOutlier.peerCpc),
              multiple: `${worstOutlier.multiple.toFixed(1)}×`,
            })
          : h.findings.adgroupEven,
        tone: worstOutlier ? 'warning' : 'insight',
      },
      prose: h.narrative.adgroup({ count: adgroupCount }),
    };
    if (worstOutlier) {
      risks.push({
        risk: h.risks.adgroup.risk({
          name: worstOutlier.name,
          multiple: `${worstOutlier.multiple.toFixed(1)}×`,
        }),
        severity: worstOutlier.multiple >= 2.5 ? 'high' : 'medium',
        action: h.risks.adgroup.action({ name: worstOutlier.name }),
        owner: h.owners.creative,
      });
    }
  }

  // --- Data gaps -------------------------------------------------------------
  const dataGap: Finding = {
    title: h.calloutTitles.dataGap,
    body: h.findings.dataGap,
    tone: 'risk',
  };
  risks.push({
    risk: h.risks.noRevenue.risk,
    severity: 'high',
    action: h.risks.noRevenue.action,
    owner: h.owners.data,
  });

  const incomplete = days.filter((d) => !d.coverage.isComplete && d.coverage.lastHour !== null);
  const worstDay = incomplete[incomplete.length - 1];
  if (worstDay && worstDay.coverage.lastHour !== null) {
    risks.push({
      risk: h.risks.coverage.risk({
        date: shortIso(worstDay.date, copy.months, copy.dayFirst),
        last: hourLabel(worstDay.coverage.lastHour),
      }),
      severity: 'medium',
      action: h.risks.coverage.action,
      owner: h.owners.data,
    });
  }

  // --- Outlook ---------------------------------------------------------------
  const outlook: string[] = [h.outlook.intro({ hours: totalHours, days: days.length })];
  const window = busyWindow(hours);
  if (window) {
    outlook.push(
      h.outlook.daypartProjection({
        window: window.label,
        share: formatPercent(window.share, 0),
      }),
    );
  }
  // Size the dayparting opportunity: what the dear hours would cost at the
  // cheap hour's rate. Deliberately framed as an upper bound, not a forecast.
  if (cheap?.cpc && dear?.cpc && dear.clicks > 0 && dear.cpc > cheap.cpc) {
    const perDay = (dear.cpc - cheap.cpc) * dear.clicks;
    if (perDay > 0) {
      outlook.push(
        h.outlook.savings({ amount: money(perDay), dear: hourLabel(dear.hour) }),
      );
    }
  }
  outlook.push(h.outlook.caveat);

  // Confidence tracks how much true-hour data backs the analysis.
  const completeDays = days.filter((d) => d.coverage.isComplete).length;
  const confidence: HourlyAnalysis['confidence'] =
    totalHours >= 24 * 7 && completeDays >= 5 ? 'High' : totalHours >= 40 ? 'Medium' : 'Low';

  return {
    summaryProse,
    daypart,
    efficiency,
    mix,
    adgroup,
    dataGap,
    risks: risks.sort((a, b) => rank(b.severity) - rank(a.severity)),
    outlook,
    confidence,
  };
}

const rank = (s: Severity): number => (s === 'high' ? 3 : s === 'medium' ? 2 : 1);

function shortIso(iso: string, months: string[], dayFirst: boolean): string {
  const [, m, d] = iso.split('-').map(Number);
  const mon = months[(m ?? 1) - 1];
  return dayFirst ? `${d} ${mon}` : `${mon} ${d}`;
}
