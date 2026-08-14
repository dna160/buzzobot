import {
  formatCurrencyCompact,
  formatDelta,
  formatNumberCompact,
  formatPercent,
  NorthStar,
  type Currency,
} from '@tempo/core';
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
 *
 * The metric-specific reasoning branches by the client's north star (see
 * `@tempo/core`'s `NorthStar`): a 'vtr' client reads on view-through rate, a
 * 'shop'/'app_install' client reads on conversions and CPA. Structural risks
 * that do not depend on which outcome matters — dayparting, spend
 * concentration, over-frequency, data coverage — are computed once and shared.
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

/** Below this, an hour/campaign/adgroup has too few impressions to trust a VTR. */
const MIN_IMPRESSIONS_FOR_VTR = 5_000;
/** Below this, an hour/campaign/adgroup has too few clicks to trust a conversion rate. */
const MIN_CLICKS_FOR_RATE = 100;

const rank = (s: Severity): number => (s === 'high' ? 3 : s === 'medium' ? 2 : 1);

function shortIso(iso: string, months: string[], dayFirst: boolean): string {
  const [, m, d] = iso.split('-').map(Number);
  const mon = months[(m ?? 1) - 1];
  return dayFirst ? `${d} ${mon}` : `${mon} ${d}`;
}

/** The hour with the most impressions. */
function peakImpressionHour(hours: readonly HourPoint[]): HourPoint | null {
  return hours.length ? hours.reduce((a, b) => (b.impressions > a.impressions ? b : a)) : null;
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
  const risks: RiskItem[] = [];

  // --- Dayparting (shared — spend-only, no outcome metric involved) ----------
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

  // --- Campaign mix / spend concentration (shared) ----------------------------
  let mix: HourlyAnalysis['mix'] = null;
  const top = campaigns[0];
  if (top && windowTotals.impressions > 0) {
    const share = top.totals.impressions / windowTotals.impressions;
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

  // --- Over-frequency (shared) -------------------------------------------------
  if (windowTotals.frequency !== null && windowTotals.frequency >= 2) {
    risks.push({
      risk: h.risks.overFrequency.risk({ frequency: `${windowTotals.frequency.toFixed(1)}×` }),
      severity: windowTotals.frequency >= 3.5 ? 'high' : 'medium',
      action: h.risks.overFrequency.action,
      owner: h.owners.media,
    });
  }

  // --- Metric-specific reasoning: VTR vs. conversions/installs ----------------
  const { summaryProse, efficiency, adgroup, bestHourForOutlook } =
    model.client.northStar === NorthStar.Vtr
      ? analyseVtr(model, risks)
      : analyseConversion(model, risks);

  // --- Data gaps (shared) ------------------------------------------------------
  // The data-quality context (offline sale, install-only export, etc.) is
  // explained once, as context in Section 6. It is deliberately NOT a risk: it
  // is a permanent property of how this brand's outcome is measured, not
  // something a team can action, and repeating it in the register crowds out
  // findings that can actually be acted on.
  const dataGap: Finding = {
    title: h.calloutTitles.dataGap,
    body:
      model.client.northStar === NorthStar.Vtr
        ? h.findings.dataGap
        : model.client.northStar === NorthStar.AppInstall
          ? h.findings.dataGapAppInstall
          : h.findings.dataGapShop,
    tone: 'risk',
  };

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

  // --- Outlook (shared) --------------------------------------------------------
  const outlook: string[] = [h.outlook.intro({ hours: totalHours, days: days.length })];
  const window = busyWindow(hours);
  if (window) {
    outlook.push(h.outlook.daypartProjection({ window: window.label, share: formatPercent(window.share, 0) }));
  }
  if (bestHourForOutlook) {
    outlook.push(h.outlook.reallocation({ best: hourLabel(bestHourForOutlook) }));
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

interface MetricAnalysisResult {
  summaryProse: string;
  efficiency: HourlyAnalysis['efficiency'];
  adgroup: HourlyAnalysis['adgroup'];
  /** The hour the outlook's reallocation line should point to, if any. */
  bestHourForOutlook: number | null;
}

// =============================================================================
// VTR path — a client with no on-platform outcome (e.g. offline FMCG retail).
// Unchanged from the original single-path implementation.
// =============================================================================
function analyseVtr(model: HourlyReportBase, risks: RiskItem[]): MetricAnalysisResult {
  const { copy, client, days, windowTotals, totalHours, campaigns } = model;
  const h = copy.hourly;
  const cur = client.currency as Currency;
  const money = (v: number) => formatCurrencyCompact(Math.round(v), cur);
  const hours = model.focus.hours;

  const summaryProse = h.narrative.summary({
    name: client.name,
    days: days.length,
    hours: totalHours,
    impressions: formatNumberCompact(windowTotals.impressions),
    vtr6s: windowTotals.vtr6s === null ? h.notReported : formatPercent(windowTotals.vtr6s),
    vtr15s: windowTotals.vtr15s === null ? h.notReported : formatPercent(windowTotals.vtr15s),
  });

  // Retention (6s → 15s): once the ad hooks, does the creative hold? Computed
  // once here because both the efficiency prose and a risk read from it.
  const retention =
    windowTotals.videoWatched6s > 0 ? windowTotals.engagedView15s / windowTotals.videoWatched6s : null;

  // --- Hourly viewing efficiency (VTR by hour) ------------------------------
  let efficiency: HourlyAnalysis['efficiency'] = null;
  const solid = hours.filter((x) => x.impressions >= MIN_IMPRESSIONS_FOR_VTR && x.vtr6s !== null);
  const bestVtr = solid.length ? solid.reduce((a, b) => ((b.vtr6s ?? 0) > (a.vtr6s ?? 0) ? b : a)) : null;
  const weakVtr = solid.length ? solid.reduce((a, b) => ((b.vtr6s ?? 0) < (a.vtr6s ?? 0) ? b : a)) : null;
  const peakImpr = peakImpressionHour(hours);

  // --- Does the money follow the views? --------------------------------------
  // Raised first, because it is the register's most consequential entry: an
  // impression in a poorly-viewing hour is a missed view, but a *rupiah* in one
  // is a decision someone made and can unmake tomorrow.
  if (solid.length >= 4) {
    const totalSpend = solid.reduce((s, x) => s + x.spend, 0);
    const dayImpr = solid.reduce((s, x) => s + x.impressions, 0);
    const day6s = solid.reduce((s, x) => s + x.videoWatched6s, 0);
    const avg = dayImpr > 0 ? day6s / dayImpr : 0;

    if (totalSpend > 0 && avg > 0) {
      const belowShare = solid.filter((x) => (x.vtr6s ?? 0) < avg).reduce((s, x) => s + x.spend, 0) / totalSpend;
      const spendWeighted = solid.reduce((s, x) => s + x.spend * (x.vtr6s ?? 0), 0) / totalSpend;

      const byVtrDesc = [...solid].sort((a, b) => (b.vtr6s ?? 0) - (a.vtr6s ?? 0));
      const slots = Math.max(1, Math.round(solid.length / 3));
      const bestCase = byVtrDesc.slice(0, slots).reduce((s, x) => s + (x.vtr6s ?? 0), 0) / slots;

      if (belowShare >= 0.25 && bestCase > spendWeighted * 1.05) {
        risks.push({
          risk: h.risks.spendMisallocation.risk({
            share: formatPercent(belowShare, 0),
            spendWeighted: formatPercent(spendWeighted),
            bestCase: formatPercent(bestCase),
          }),
          severity: belowShare >= 0.5 || bestCase > spendWeighted * 1.25 ? 'high' : 'medium',
          action: h.risks.spendMisallocation.action({
            best: hourLabel(byVtrDesc[0]!.hour),
            weak: hourLabel(byVtrDesc[byVtrDesc.length - 1]!.hour),
          }),
          owner: h.owners.media,
        });
      }
    }
  }

  if (bestVtr && weakVtr && bestVtr.hour !== weakVtr.hour && bestVtr.vtr6s && weakVtr.vtr6s) {
    const spread = weakVtr.vtr6s > 0 ? bestVtr.vtr6s / weakVtr.vtr6s : 1;
    const spreadStr = `${spread.toFixed(1)}×`;
    const material = spread >= 1.15;

    efficiency = {
      finding: {
        title: h.calloutTitles.efficiency,
        body: material
          ? h.findings.vtrByHour({
              best: hourLabel(bestVtr.hour),
              bestVtr: formatPercent(bestVtr.vtr6s),
              weak: hourLabel(weakVtr.hour),
              weakVtr: formatPercent(weakVtr.vtr6s),
              multiple: spreadStr,
            })
          : h.findings.vtrStable({
              best: hourLabel(bestVtr.hour),
              weak: hourLabel(weakVtr.hour),
              spread: `${formatPercent(weakVtr.vtr6s)} – ${formatPercent(bestVtr.vtr6s)}`,
            }),
        tone: material ? 'warning' : 'insight',
      },
      prose: h.narrative.efficiency({
        best: hourLabel(bestVtr.hour),
        bestVtr: formatPercent(bestVtr.vtr6s),
        weak: hourLabel(weakVtr.hour),
        weakVtr: formatPercent(weakVtr.vtr6s),
        retention: retention === null ? h.notReported : formatPercent(retention, 0),
      }),
    };

    // The busiest-impression hour viewing materially worse than the best hour is
    // reach bought where the ad is least watched — the top media risk.
    if (peakImpr && peakImpr.vtr6s != null && peakImpr.hour !== bestVtr.hour && peakImpr.vtr6s < bestVtr.vtr6s * 0.9) {
      const gap = peakImpr.vtr6s > 0 ? bestVtr.vtr6s / peakImpr.vtr6s : Infinity;
      risks.push({
        risk: h.risks.lowVtrHours.risk({
          peak: hourLabel(peakImpr.hour),
          peakVtr: formatPercent(peakImpr.vtr6s),
          best: hourLabel(bestVtr.hour),
          bestVtr: formatPercent(bestVtr.vtr6s),
        }),
        severity: gap >= 1.3 ? 'high' : 'medium',
        action: h.risks.lowVtrHours.action({ peak: hourLabel(peakImpr.hour), best: hourLabel(bestVtr.hour) }),
        owner: h.owners.media,
      });
    }
  }

  // Weak 6s→15s retention: the creative hooks but does not hold the message.
  if (retention !== null && retention < 0.75) {
    risks.push({
      risk: h.risks.retention.risk({ retention: formatPercent(retention, 0) }),
      severity: retention < 0.4 ? 'high' : retention < 0.6 ? 'medium' : 'low',
      action: h.risks.retention.action,
      owner: h.owners.creative,
    });
  }

  // View quality slipping against the same hours yesterday.
  const cmp = model.comparison;
  if (cmp) {
    const d6 = cmp.deltas.vtr6s;
    const d15 = cmp.deltas.vtr15s;
    if (d6 !== null && d15 !== null && d6 < -0.05) {
      risks.push({
        risk: h.risks.vtrDecline.risk({ vtr6s: formatDelta(d6), vtr15s: formatDelta(d15), basis: cmp.label }),
        severity: d6 < -0.15 ? 'high' : 'medium',
        action: h.risks.vtrDecline.action,
        owner: h.owners.creative,
      });
    }
  }

  // A campaign carrying real reach but viewing well below the account average.
  const avgVtr = windowTotals.vtr6s;
  if (avgVtr && windowTotals.impressions > 0) {
    let worst: { name: string; share: number; vtr: number } | null = null;
    for (const c of campaigns) {
      const share = c.totals.impressions / windowTotals.impressions;
      if (share < 0.1 || c.totals.vtr6s === null || c.totals.vtr6s >= avgVtr * 0.7) continue;
      if (!worst || c.totals.vtr6s < worst.vtr) worst = { name: c.name, share, vtr: c.totals.vtr6s };
    }
    if (worst) {
      risks.push({
        risk: h.risks.lowVtrCampaign.risk({ name: worst.name, share: formatPercent(worst.share, 0), vtr: formatPercent(worst.vtr) }),
        severity: worst.vtr < avgVtr * 0.5 ? 'high' : 'medium',
        action: h.risks.lowVtrCampaign.action({ name: worst.name }),
        owner: h.owners.creative,
      });
    }

    // Expensive reach that is also poorly watched.
    const avgCpm = windowTotals.cpm;
    if (avgCpm !== null && avgCpm > 0) {
      const costly = campaigns
        .filter(
          (c) =>
            c.totals.cpm !== null &&
            c.totals.vtr6s !== null &&
            c.totals.impressions >= MIN_IMPRESSIONS_FOR_VTR &&
            c.totals.cpm > avgCpm * 1.1 &&
            c.totals.vtr6s < avgVtr &&
            c.name !== worst?.name,
        )
        .sort((a, b) => (b.totals.cpm ?? 0) - (a.totals.cpm ?? 0))[0];

      if (costly) {
        risks.push({
          risk: h.risks.costlyReach.risk({
            name: costly.name,
            cpm: money(costly.totals.cpm ?? 0),
            vtr: formatPercent(costly.totals.vtr6s ?? 0),
            avgCpm: money(avgCpm),
          }),
          severity: (costly.totals.cpm ?? 0) > avgCpm * 1.5 ? 'high' : 'medium',
          action: h.risks.costlyReach.action({ name: costly.name }),
          owner: h.owners.media,
        });
      }
    }

    // The reallocation opportunity: the best-viewing campaign starved of reach.
    const sizeable = campaigns.filter((c) => c.totals.vtr6s !== null && c.totals.impressions / windowTotals.impressions >= 0.15);
    if (sizeable.length >= 2) {
      const bestC = sizeable.reduce((a, b) => ((b.totals.vtr6s ?? 0) > (a.totals.vtr6s ?? 0) ? b : a));
      const heaviest = sizeable.reduce((a, b) => (b.totals.impressions > a.totals.impressions ? b : a));
      const bestShare = bestC.totals.impressions / windowTotals.impressions;
      const heavyShare = heaviest.totals.impressions / windowTotals.impressions;

      if (bestC.id !== heaviest.id && bestShare < heavyShare && (bestC.totals.vtr6s ?? 0) > (heaviest.totals.vtr6s ?? 0) * 1.05) {
        risks.push({
          risk: h.risks.underweightedWinner.risk({
            best: bestC.name,
            bestVtr: formatPercent(bestC.totals.vtr6s ?? 0),
            bestShare: formatPercent(bestShare, 0),
            heavy: heaviest.name,
            heavyVtr: formatPercent(heaviest.totals.vtr6s ?? 0),
            heavyShare: formatPercent(heavyShare, 0),
          }),
          severity: 'medium',
          action: h.risks.underweightedWinner.action({ best: bestC.name, heavy: heaviest.name }),
          owner: h.owners.media,
        });
      }
    }
  }

  // --- Adgroup viewing efficiency -------------------------------------------
  let adgroup: HourlyAnalysis['adgroup'] = null;
  const adgroupCount = campaigns.reduce((n, c) => n + c.adgroups.length, 0);
  let worstAg: { name: string; vtr: number; peerVtr: number; below: number } | null = null;

  for (const c of campaigns) {
    const viewed = c.adgroups.filter((a) => a.totals.vtr6s !== null && a.totals.impressions >= MIN_IMPRESSIONS_FOR_VTR);
    if (viewed.length < 2) continue;
    const sorted = [...viewed].sort((a, b) => (a.totals.vtr6s ?? 0) - (b.totals.vtr6s ?? 0));
    const worstOne = sorted[0]!;
    const peers = sorted.slice(1);
    const peerImpr = peers.reduce((s, a) => s + a.totals.impressions, 0);
    const peer6s = peers.reduce((s, a) => s + a.totals.videoWatched6s, 0);
    const peerVtr = peerImpr > 0 ? peer6s / peerImpr : null;
    const vtr = worstOne.totals.vtr6s ?? 0;
    if (peerVtr === null || peerVtr <= 0 || vtr >= peerVtr * 0.7) continue;
    const cand = { name: worstOne.name, vtr, peerVtr, below: (peerVtr - vtr) / peerVtr };
    if (!worstAg || cand.vtr < worstAg.vtr) worstAg = cand;
  }

  if (adgroupCount > 0) {
    adgroup = {
      finding: {
        title: h.calloutTitles.adgroup,
        body: worstAg
          ? h.findings.adgroupVtr({ name: worstAg.name, vtr: formatPercent(worstAg.vtr), peerVtr: formatPercent(worstAg.peerVtr), multiple: formatPercent(worstAg.below, 0) })
          : h.findings.adgroupEven,
        tone: worstAg ? 'warning' : 'insight',
      },
      prose: h.narrative.adgroup({ count: adgroupCount }),
    };
  }

  if (worstAg) {
    risks.push({
      risk: h.risks.lowVtrAdgroup.risk({ name: worstAg.name, vtr: formatPercent(worstAg.vtr), peerVtr: formatPercent(worstAg.peerVtr) }),
      severity: worstAg.below >= 0.5 ? 'high' : 'medium',
      action: h.risks.lowVtrAdgroup.action({ name: worstAg.name }),
      owner: h.owners.creative,
    });
  } else if (avgVtr) {
    // No sibling gap — but a whole campaign's adgroups can be uniformly weak.
    const allAg = campaigns
      .flatMap((c) => c.adgroups)
      .filter((a) => a.totals.vtr6s !== null && a.totals.impressions >= MIN_IMPRESSIONS_FOR_VTR && a.totals.vtr6s < avgVtr * 0.6)
      .sort((a, b) => (a.totals.vtr6s ?? 0) - (b.totals.vtr6s ?? 0));

    const weakest = allAg[0];
    if (weakest) {
      risks.push({
        risk: h.risks.lowVtrAdgroupAccount.risk({
          name: weakest.name,
          vtr: formatPercent(weakest.totals.vtr6s ?? 0),
          avgVtr: formatPercent(avgVtr),
          impressions: formatNumberCompact(weakest.totals.impressions),
        }),
        severity: (weakest.totals.vtr6s ?? 0) < avgVtr * 0.4 ? 'high' : 'medium',
        action: h.risks.lowVtrAdgroupAccount.action({ name: weakest.name }),
        owner: h.owners.creative,
      });
    }
  }

  return { summaryProse, efficiency, adgroup, bestHourForOutlook: bestVtr?.hour ?? null };
}

// =============================================================================
// Conversion path — a Shop or App Install client. Shares the exact same
// analytical shape as the VTR path (dayparting already handled by the caller;
// here: spend-vs-outcome misallocation, low-performing hours, weak funnel,
// campaign/adgroup gaps, day-over-day decline) but keyed on the click-to-
// conversion rate and CPA instead of VTR. `outcome` is "conversion" for Shop,
// "install" for App Install — the same copy templates serve both.
// =============================================================================
function analyseConversion(model: HourlyReportBase, risks: RiskItem[]): MetricAnalysisResult {
  const { copy, client, days, windowTotals, totalHours, campaigns } = model;
  const h = copy.hourly;
  const cur = client.currency as Currency;
  const money = (v: number) => formatCurrencyCompact(Math.round(v), cur);
  const hours = model.focus.hours;
  const outcome = client.northStar === NorthStar.AppInstall ? 'install' : 'conversion';

  const summaryProse = h.conversion.narrative.summary({
    name: client.name,
    days: days.length,
    hours: totalHours,
    clicks: formatNumberCompact(windowTotals.clicks),
    conversions: formatNumberCompact(windowTotals.conversions),
    conversionRate: windowTotals.conversionRate === null ? h.notReported : formatPercent(windowTotals.conversionRate),
    outcome,
  });

  // --- Hourly conversion efficiency (conversion rate by hour) -----------------
  let efficiency: HourlyAnalysis['efficiency'] = null;
  const solid = hours.filter((x) => x.clicks >= MIN_CLICKS_FOR_RATE && x.conversionRate !== null);
  const bestRate = solid.length ? solid.reduce((a, b) => ((b.conversionRate ?? 0) > (a.conversionRate ?? 0) ? b : a)) : null;
  const weakRate = solid.length ? solid.reduce((a, b) => ((b.conversionRate ?? 0) < (a.conversionRate ?? 0) ? b : a)) : null;
  const peakSpendHour = hours.length ? hours.reduce((a, b) => (b.spend > a.spend ? b : a)) : null;

  // --- Does the money follow the conversions? ---------------------------------
  if (solid.length >= 4) {
    const totalSpend = solid.reduce((s, x) => s + x.spend, 0);
    const dayClicks = solid.reduce((s, x) => s + x.clicks, 0);
    const dayConv = solid.reduce((s, x) => s + x.conversions, 0);
    const avg = dayClicks > 0 ? dayConv / dayClicks : 0;

    if (totalSpend > 0 && avg > 0) {
      const belowShare = solid.filter((x) => (x.conversionRate ?? 0) < avg).reduce((s, x) => s + x.spend, 0) / totalSpend;
      const spendWeighted = solid.reduce((s, x) => s + x.spend * (x.conversionRate ?? 0), 0) / totalSpend;

      const byRateDesc = [...solid].sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0));
      const slots = Math.max(1, Math.round(solid.length / 3));
      const bestCase = byRateDesc.slice(0, slots).reduce((s, x) => s + (x.conversionRate ?? 0), 0) / slots;

      if (belowShare >= 0.25 && bestCase > spendWeighted * 1.05) {
        risks.push({
          risk: h.conversion.risks.spendMisallocation.risk({
            share: formatPercent(belowShare, 0),
            spendWeighted: formatPercent(spendWeighted),
            bestCase: formatPercent(bestCase),
            outcome,
          }),
          severity: belowShare >= 0.5 || bestCase > spendWeighted * 1.25 ? 'high' : 'medium',
          action: h.conversion.risks.spendMisallocation.action({
            best: hourLabel(byRateDesc[0]!.hour),
            weak: hourLabel(byRateDesc[byRateDesc.length - 1]!.hour),
            outcome,
          }),
          owner: h.owners.media,
        });
      }
    }
  }

  if (bestRate && weakRate && bestRate.hour !== weakRate.hour && bestRate.conversionRate && weakRate.conversionRate) {
    const spread = weakRate.conversionRate > 0 ? bestRate.conversionRate / weakRate.conversionRate : 1;
    const spreadStr = `${spread.toFixed(1)}×`;
    const material = spread >= 1.15;

    efficiency = {
      finding: {
        title: h.conversion.calloutTitles.efficiency,
        body: material
          ? h.conversion.findings.byHour({
              best: hourLabel(bestRate.hour),
              bestRate: formatPercent(bestRate.conversionRate),
              weak: hourLabel(weakRate.hour),
              weakRate: formatPercent(weakRate.conversionRate),
              multiple: spreadStr,
              outcome,
            })
          : h.conversion.findings.stable({
              best: hourLabel(bestRate.hour),
              weak: hourLabel(weakRate.hour),
              spread: `${formatPercent(weakRate.conversionRate)} – ${formatPercent(bestRate.conversionRate)}`,
              outcome,
            }),
        tone: material ? 'warning' : 'insight',
      },
      prose: h.conversion.narrative.efficiency({
        best: hourLabel(bestRate.hour),
        bestRate: formatPercent(bestRate.conversionRate),
        weak: hourLabel(weakRate.hour),
        weakRate: formatPercent(weakRate.conversionRate),
        outcome,
      }),
    };

    // The busiest-spend hour converting materially worse than the best hour.
    if (peakSpendHour && peakSpendHour.conversionRate != null && peakSpendHour.hour !== bestRate.hour && peakSpendHour.conversionRate < bestRate.conversionRate * 0.9) {
      const gap = peakSpendHour.conversionRate > 0 ? bestRate.conversionRate / peakSpendHour.conversionRate : Infinity;
      risks.push({
        risk: h.conversion.risks.lowHours.risk({
          peak: hourLabel(peakSpendHour.hour),
          peakRate: formatPercent(peakSpendHour.conversionRate),
          best: hourLabel(bestRate.hour),
          bestRate: formatPercent(bestRate.conversionRate),
          outcome,
        }),
        severity: gap >= 1.3 ? 'high' : 'medium',
        action: h.conversion.risks.lowHours.action({ peak: hourLabel(peakSpendHour.hour), best: hourLabel(bestRate.hour), outcome }),
        owner: h.owners.media,
      });
    }
  }

  // Weak funnel: CTR is healthy but the conversion rate lags — the problem is
  // below the click (offer, landing, store listing), not the media buy.
  if (windowTotals.ctr !== null && windowTotals.conversionRate !== null && windowTotals.clicks >= MIN_CLICKS_FOR_RATE) {
    // "Healthy" CTR is brand-relative, so this compares the funnel step-down
    // (CTR → conversion rate) rather than an absolute CTR threshold: a sharp
    // drop from clicks to conversions is the signal, regardless of CTR's
    // absolute level.
    if (windowTotals.ctr > 0 && windowTotals.conversionRate / windowTotals.ctr < 0.15) {
      risks.push({
        risk: h.conversion.risks.weakFunnel.risk({
          ctr: formatPercent(windowTotals.ctr),
          rate: formatPercent(windowTotals.conversionRate),
          outcome,
        }),
        severity: windowTotals.conversionRate / windowTotals.ctr < 0.08 ? 'high' : 'medium',
        action: h.conversion.risks.weakFunnel.action({ outcome }),
        owner: h.owners.creative,
      });
    }
  }

  // Conversion count slipping against the same hours yesterday (a raw count
  // decline, not just a rate wobble, is the signal worth a risk entry).
  const cmp = model.comparison;
  if (cmp) {
    const dConvCount = cmp.deltas.conversions;
    if (dConvCount !== null && dConvCount < -0.15) {
      risks.push({
        risk: h.conversion.risks.decline.risk({
          rate: windowTotals.conversionRate === null ? h.notReported : formatPercent(windowTotals.conversionRate),
          basis: cmp.label,
          outcome,
        }),
        severity: dConvCount < -0.3 ? 'high' : 'medium',
        action: h.conversion.risks.decline.action({ outcome }),
        owner: h.owners.creative,
      });
    }
  }

  // A campaign carrying real spend but converting well below the account average.
  const avgRate = windowTotals.conversionRate;
  if (avgRate && windowTotals.spend > 0) {
    let worst: { name: string; share: number; rate: number } | null = null;
    for (const c of campaigns) {
      const share = c.totals.spend / windowTotals.spend;
      if (share < 0.1 || c.totals.conversionRate === null || c.totals.conversionRate >= avgRate * 0.7) continue;
      if (!worst || c.totals.conversionRate < worst.rate) worst = { name: c.name, share, rate: c.totals.conversionRate };
    }
    if (worst) {
      risks.push({
        risk: h.conversion.risks.lowCampaign.risk({ name: worst.name, share: formatPercent(worst.share, 0), rate: formatPercent(worst.rate), outcome }),
        severity: worst.rate < avgRate * 0.5 ? 'high' : 'medium',
        action: h.conversion.risks.lowCampaign.action({ name: worst.name, outcome }),
        owner: h.owners.creative,
      });
    }

    // Expensive conversions: CPA well above the account average.
    const avgCpa = windowTotals.cpa;
    if (avgCpa !== null && avgCpa > 0) {
      const costly = campaigns
        .filter((c) => c.totals.cpa !== null && c.totals.clicks >= MIN_CLICKS_FOR_RATE && c.totals.cpa > avgCpa * 1.3 && c.name !== worst?.name)
        .sort((a, b) => (b.totals.cpa ?? 0) - (a.totals.cpa ?? 0))[0];

      if (costly) {
        risks.push({
          risk: h.conversion.risks.costly.risk({ name: costly.name, cpa: money(costly.totals.cpa ?? 0), avgCpa: money(avgCpa), outcome }),
          severity: (costly.totals.cpa ?? 0) > avgCpa * 2 ? 'high' : 'medium',
          action: h.conversion.risks.costly.action({ name: costly.name, outcome }),
          owner: h.owners.media,
        });
      }
    }
  }

  // --- Adgroup conversion efficiency ------------------------------------------
  let adgroup: HourlyAnalysis['adgroup'] = null;
  const adgroupCount = campaigns.reduce((n, c) => n + c.adgroups.length, 0);
  let worstAg: { name: string; rate: number; peerRate: number; below: number } | null = null;

  for (const c of campaigns) {
    const rated = c.adgroups.filter((a) => a.totals.conversionRate !== null && a.totals.clicks >= MIN_CLICKS_FOR_RATE);
    if (rated.length < 2) continue;
    const sorted = [...rated].sort((a, b) => (a.totals.conversionRate ?? 0) - (b.totals.conversionRate ?? 0));
    const worstOne = sorted[0]!;
    const peers = sorted.slice(1);
    const peerClicks = peers.reduce((s, a) => s + a.totals.clicks, 0);
    const peerConv = peers.reduce((s, a) => s + a.totals.conversions, 0);
    const peerRate = peerClicks > 0 ? peerConv / peerClicks : null;
    const rate = worstOne.totals.conversionRate ?? 0;
    if (peerRate === null || peerRate <= 0 || rate >= peerRate * 0.7) continue;
    const cand = { name: worstOne.name, rate, peerRate, below: (peerRate - rate) / peerRate };
    if (!worstAg || cand.rate < worstAg.rate) worstAg = cand;
  }

  if (adgroupCount > 0) {
    adgroup = {
      finding: {
        title: h.conversion.calloutTitles.adgroup,
        body: worstAg
          ? h.conversion.findings.adgroupGap({ name: worstAg.name, rate: formatPercent(worstAg.rate), peerRate: formatPercent(worstAg.peerRate), multiple: formatPercent(worstAg.below, 0), outcome })
          : h.conversion.findings.adgroupEven({ outcome }),
        tone: worstAg ? 'warning' : 'insight',
      },
      prose: h.conversion.narrative.adgroup({ count: adgroupCount, outcome }),
    };
  }

  if (worstAg) {
    risks.push({
      risk: h.conversion.risks.lowAdgroup.risk({ name: worstAg.name, rate: formatPercent(worstAg.rate), peerRate: formatPercent(worstAg.peerRate), outcome }),
      severity: worstAg.below >= 0.5 ? 'high' : 'medium',
      action: h.conversion.risks.lowAdgroup.action({ name: worstAg.name, outcome }),
      owner: h.owners.creative,
    });
  } else if (avgRate) {
    const allAg = campaigns
      .flatMap((c) => c.adgroups)
      .filter((a) => a.totals.conversionRate !== null && a.totals.clicks >= MIN_CLICKS_FOR_RATE && a.totals.conversionRate < avgRate * 0.6)
      .sort((a, b) => (a.totals.conversionRate ?? 0) - (b.totals.conversionRate ?? 0));

    const weakest = allAg[0];
    if (weakest) {
      risks.push({
        risk: h.conversion.risks.lowAdgroupAccount.risk({
          name: weakest.name,
          rate: formatPercent(weakest.totals.conversionRate ?? 0),
          avgRate: formatPercent(avgRate),
          clicks: formatNumberCompact(weakest.totals.clicks),
          outcome,
        }),
        severity: (weakest.totals.conversionRate ?? 0) < avgRate * 0.4 ? 'high' : 'medium',
        action: h.conversion.risks.lowAdgroupAccount.action({ name: weakest.name, outcome }),
        owner: h.owners.creative,
      });
    }
  }

  return { summaryProse, efficiency, adgroup, bestHourForOutlook: bestRate?.hour ?? null };
}
