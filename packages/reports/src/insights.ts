import type { DashboardData, KpiCard } from '@tempo/db';
import {
  formatCurrencyCompact,
  formatDelta,
  formatNumberCompact,
  formatPercent,
  formatRatio,
  type Currency,
  type MetricKey,
} from '@tempo/core';

/**
 * Narrative + action-plan generation. These are deterministic heuristics over
 * the dashboard read-model — the same numbers the client sees, turned into the
 * kind of prose and prioritized recommendations an analyst would write. All
 * copy flows through here so it can be localized in one place later.
 */

export type Priority = 'high' | 'medium' | 'low';

export interface Recommendation {
  priority: Priority;
  title: string;
  detail: string;
}

export interface ReportInsights {
  headline: string;
  executiveSummary: string[];
  paidNarrative: string[];
  organicNarrative: string[];
  contentHighlights: string[];
  recommendations: Recommendation[];
  outlook: string[];
  confidence: 'High' | 'Medium' | 'Low';
}

const kpi = (cards: KpiCard[], key: MetricKey): KpiCard | undefined =>
  cards.find((c) => c.key === key);

const trend = (delta: number | null): string => {
  if (delta === null) return 'held steady';
  if (Math.abs(delta) < 0.01) return 'held roughly flat';
  return delta > 0 ? `rose ${formatDelta(delta)}` : `fell ${formatDelta(delta)}`;
};

export function buildInsights(d: DashboardData): ReportInsights {
  const cur = d.client.currency as Currency;
  const money = (v: number) => formatCurrencyCompact(v, cur);

  const spend = kpi(d.paidKpis, 'spend');
  const roas = kpi(d.paidKpis, 'roas');
  const conversions = kpi(d.paidKpis, 'conversions');
  const cpa = kpi(d.paidKpis, 'cpa');
  const views = kpi(d.organicKpis, 'views');
  const eng = kpi(d.organicKpis, 'engagementRate');
  const followers = kpi(d.organicKpis, 'newFollowers');

  const topCampaign = [...d.campaigns].filter((c) => c.spend > 0).sort((a, b) => b.roas - a.roas)[0];
  const topVideo = d.topVideos[0];

  // --- Headline ---
  const headline =
    d.hasPaid && roas
      ? `${d.client.name} delivered a ${formatRatio(roas.value)} blended ROAS on ${money(
          spend?.value ?? 0,
        )} of paid spend, with organic reaching ${formatNumberCompact(views?.value ?? 0)} views.`
      : `${d.client.name} organic content reached ${formatNumberCompact(
          views?.value ?? 0,
        )} views at a ${formatPercent(eng?.value ?? 0, 1)} engagement rate.`;

  // --- Executive summary ---
  const executiveSummary: string[] = [];
  if (d.hasPaid && spend && roas && conversions) {
    executiveSummary.push(
      `Paid campaigns invested ${money(spend.value)} (${trend(spend.delta)} vs. the prior period), ` +
        `returning a ${formatRatio(roas.value)} ROAS and ${formatNumberCompact(conversions.value)} conversions.`,
    );
  }
  if (d.hasOrganic && views && eng) {
    executiveSummary.push(
      `Organic content generated ${formatNumberCompact(views.value)} views at a ${formatPercent(
        eng.value,
        1,
      )} engagement rate` +
        (followers ? `, adding ${formatNumberCompact(followers.value)} net new followers.` : '.'),
    );
  }
  if (topCampaign) {
    executiveSummary.push(
      `The strongest paid performer was “${topCampaign.name}” at a ${formatRatio(topCampaign.roas)} ROAS ` +
        `on ${money(topCampaign.spend)} spend.`,
    );
  }

  // --- Paid narrative ---
  const paidNarrative: string[] = [];
  if (d.hasPaid && spend && roas && cpa) {
    paidNarrative.push(
      `Spend ${trend(spend.delta)} while ROAS ${trend(roas.delta)} and CPA ${trend(cpa.delta)} ` +
        `period-over-period — ${efficiencyVerdict(spend.delta, roas.delta)}.`,
    );
    const active = d.campaigns.filter((c) => c.spend > 0).length;
    const paused = d.campaigns.filter((c) => c.spend === 0).length;
    paidNarrative.push(
      `${active} campaign${active === 1 ? '' : 's'} drove spend this period` +
        (paused > 0 ? `; ${paused} remained paused or unspent.` : '.'),
    );
  }

  // --- Organic narrative ---
  const organicNarrative: string[] = [];
  if (d.hasOrganic && views && eng) {
    organicNarrative.push(
      `Views ${trend(views.delta)} and engagement rate ${trend(eng.delta)} versus the prior period.`,
    );
    if (topVideo) {
      organicNarrative.push(
        `Top content “${clip(topVideo.caption)}” reached ${formatNumberCompact(
          topVideo.views,
        )} views at ${formatPercent(topVideo.engagementRate, 1)} engagement.`,
      );
    }
  }

  // --- Content highlights ---
  const contentHighlights = d.topVideos
    .slice(0, 3)
    .map(
      (v) =>
        `“${clip(v.caption)}” — ${formatNumberCompact(v.views)} views, ${formatPercent(
          v.engagementRate,
          1,
        )} engagement, ${v.avgWatchTimeSec.toFixed(1)}s avg watch.`,
    );

  return {
    headline,
    executiveSummary,
    paidNarrative,
    organicNarrative,
    contentHighlights,
    recommendations: buildRecommendations(d),
    outlook: buildOutlook(d),
    confidence: assessConfidence(d),
  };
}

function efficiencyVerdict(spendDelta: number | null, roasDelta: number | null): string {
  if (roasDelta !== null && roasDelta > 0.02) return 'efficiency improved';
  if (roasDelta !== null && roasDelta < -0.02) return 'efficiency softened and warrants attention';
  if (spendDelta !== null && spendDelta > 0.1) return 'scaling held efficiency roughly stable';
  return 'performance was broadly stable';
}

function buildRecommendations(d: DashboardData): Recommendation[] {
  const cur = d.client.currency as Currency;
  const money = (v: number) => formatCurrencyCompact(v, cur);
  const recs: Recommendation[] = [];

  // Scale the winner.
  const winner = [...d.campaigns]
    .filter((c) => c.spend > 0 && c.roas >= 3)
    .sort((a, b) => b.roas - a.roas)[0];
  if (winner) {
    recs.push({
      priority: 'high',
      title: `Scale “${clip(winner.name, 42)}”`,
      detail: `At a ${formatRatio(winner.roas)} ROAS on ${money(
        winner.spend,
      )}, this campaign has headroom. Increase budget 20–30% and monitor for CPA drift.`,
    });
  }

  // Fix the laggards.
  const laggard = [...d.campaigns]
    .filter((c) => c.spend > 0 && c.roas < 2)
    .sort((a, b) => b.spend - a.spend)[0];
  if (laggard) {
    recs.push({
      priority: 'high',
      title: `Reallocate budget away from “${clip(laggard.name, 42)}”`,
      detail: `A ${formatRatio(laggard.roas)} ROAS on ${money(
        laggard.spend,
      )} is below target. Refresh creative or shift budget to higher-ROAS campaigns.`,
    });
  }

  // Rising CPA.
  const cpa = kpi(d.paidKpis, 'cpa');
  if (cpa && cpa.delta !== null && cpa.delta > 0.1) {
    recs.push({
      priority: 'medium',
      title: 'Investigate rising cost per acquisition',
      detail: `CPA is up ${formatDelta(cpa.delta)} period-over-period. Tighten audience targeting and rotate fatigued creatives.`,
    });
  }

  // Amplify top organic content with paid.
  const topVideo = d.topVideos[0];
  if (topVideo && topVideo.engagementRate > 0.06) {
    recs.push({
      priority: 'medium',
      title: 'Amplify top organic content with Spark Ads',
      detail: `“${clip(topVideo.caption, 42)}” is over-indexing on engagement (${formatPercent(
        topVideo.engagementRate,
        1,
      )}). Promote it as a Spark Ad to extend reach.`,
    });
  }

  // Reactivate paused campaigns.
  const paused = d.campaigns.find((c) => c.spend === 0);
  if (paused) {
    recs.push({
      priority: 'low',
      title: 'Review paused campaigns',
      detail: `“${clip(paused.name, 42)}” recorded no spend this period. Reactivate with fresh creative or archive to reduce clutter.`,
    });
  }

  return recs.slice(0, 6);
}

function buildOutlook(d: DashboardData): string[] {
  const roas = kpi(d.paidKpis, 'roas');
  const views = kpi(d.organicKpis, 'views');
  const out: string[] = [];
  if (roas && roas.delta !== null) {
    out.push(
      roas.delta >= 0
        ? 'Paid efficiency is trending favorably; maintaining creative velocity should sustain ROAS into next period.'
        : 'Paid efficiency dipped this period; the action plan above targets a recovery in ROAS next cycle.',
    );
  }
  if (views && views.delta !== null) {
    out.push(
      views.delta >= 0
        ? 'Organic momentum is positive — lean into the formats driving the top-performing content.'
        : 'Organic reach softened; increasing posting cadence around proven formats should rebuild momentum.',
    );
  }
  if (out.length === 0) out.push('Continue monitoring performance and revisit the plan next reporting cycle.');
  return out;
}

function assessConfidence(d: DashboardData): 'High' | 'Medium' | 'Low' {
  const points = d.timeseries.length;
  const hasBoth = d.hasPaid && d.hasOrganic;
  if (points >= 21 && hasBoth) return 'High';
  if (points >= 7) return 'Medium';
  return 'Low';
}

// --- utilities ---
const clip = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
