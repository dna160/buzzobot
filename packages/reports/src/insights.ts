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
import type { ReportCopy } from './i18n.js';

/**
 * Narrative + action-plan generation. These are deterministic heuristics over
 * the dashboard read-model — the same numbers the client sees, turned into
 * prose and a prioritized action plan. All wording comes from the locale
 * `copy`; this module only decides *what* to say and with which numbers.
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

export function buildInsights(d: DashboardData, copy: ReportCopy): ReportInsights {
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
      ? copy.headlinePaid({
          name: d.client.name,
          roas: formatRatio(roas.value),
          spend: money(spend?.value ?? 0),
          views: formatNumberCompact(views?.value ?? 0),
        })
      : copy.headlineOrganic({
          name: d.client.name,
          views: formatNumberCompact(views?.value ?? 0),
          eng: formatPercent(eng?.value ?? 0, 1),
        });

  // --- Executive summary ---
  const executiveSummary: string[] = [];
  if (d.hasPaid && spend && roas && conversions) {
    executiveSummary.push(
      copy.execPaid({
        spend: money(spend.value),
        trend: copy.trend(spend.delta),
        roas: formatRatio(roas.value),
        conv: formatNumberCompact(conversions.value),
      }),
    );
  }
  if (d.hasOrganic && views && eng) {
    executiveSummary.push(
      copy.execOrganic({
        views: formatNumberCompact(views.value),
        eng: formatPercent(eng.value, 1),
        followers: followers ? formatNumberCompact(followers.value) : undefined,
      }),
    );
  }
  if (topCampaign) {
    executiveSummary.push(
      copy.execTopCampaign({
        name: topCampaign.name,
        roas: formatRatio(topCampaign.roas),
        spend: money(topCampaign.spend),
      }),
    );
  }

  // --- Paid narrative ---
  const paidNarrative: string[] = [];
  if (d.hasPaid && spend && roas && cpa) {
    paidNarrative.push(
      copy.paidEfficiency({
        spendTrend: copy.trend(spend.delta),
        roasTrend: copy.trend(roas.delta),
        cpaTrend: copy.trend(cpa.delta),
        verdict: copy.efficiencyVerdict(spend.delta, roas.delta),
      }),
    );
    paidNarrative.push(
      copy.paidCampaignsCount({
        active: d.campaigns.filter((c) => c.spend > 0).length,
        paused: d.campaigns.filter((c) => c.spend === 0).length,
      }),
    );
  }

  // --- Organic narrative ---
  const organicNarrative: string[] = [];
  if (d.hasOrganic && views && eng) {
    organicNarrative.push(
      copy.organicViews({ viewsTrend: copy.trend(views.delta), engTrend: copy.trend(eng.delta) }),
    );
    if (topVideo) {
      organicNarrative.push(
        copy.organicTopVideo({
          caption: clip(topVideo.caption),
          views: formatNumberCompact(topVideo.views),
          eng: formatPercent(topVideo.engagementRate, 1),
        }),
      );
    }
  }

  // --- Content highlights ---
  const contentHighlights = d.topVideos.slice(0, 3).map((v) =>
    copy.contentHighlight({
      caption: clip(v.caption),
      views: formatNumberCompact(v.views),
      eng: formatPercent(v.engagementRate, 1),
      watch: `${v.avgWatchTimeSec.toFixed(1)}s`,
    }),
  );

  return {
    headline,
    executiveSummary,
    paidNarrative,
    organicNarrative,
    contentHighlights,
    recommendations: buildRecommendations(d, copy),
    outlook: buildOutlook(d, copy),
    confidence: assessConfidence(d),
  };
}

function buildRecommendations(d: DashboardData, copy: ReportCopy): Recommendation[] {
  const cur = d.client.currency as Currency;
  const money = (v: number) => formatCurrencyCompact(v, cur);
  const recs: Recommendation[] = [];

  const winner = [...d.campaigns]
    .filter((c) => c.spend > 0 && c.roas >= 3)
    .sort((a, b) => b.roas - a.roas)[0];
  if (winner) {
    recs.push({
      priority: 'high',
      ...copy.recScale({ name: clip(winner.name, 42), roas: formatRatio(winner.roas), spend: money(winner.spend) }),
    });
  }

  const laggard = [...d.campaigns]
    .filter((c) => c.spend > 0 && c.roas < 2)
    .sort((a, b) => b.spend - a.spend)[0];
  if (laggard) {
    recs.push({
      priority: 'high',
      ...copy.recReallocate({ name: clip(laggard.name, 42), roas: formatRatio(laggard.roas), spend: money(laggard.spend) }),
    });
  }

  const cpa = kpi(d.paidKpis, 'cpa');
  if (cpa && cpa.delta !== null && cpa.delta > 0.1) {
    recs.push({ priority: 'medium', ...copy.recRisingCpa({ delta: formatDelta(cpa.delta) }) });
  }

  const topVideo = d.topVideos[0];
  if (topVideo && topVideo.engagementRate > 0.06) {
    recs.push({
      priority: 'medium',
      ...copy.recAmplify({ caption: clip(topVideo.caption, 42), eng: formatPercent(topVideo.engagementRate, 1) }),
    });
  }

  const paused = d.campaigns.find((c) => c.spend === 0);
  if (paused) {
    recs.push({ priority: 'low', ...copy.recReviewPaused({ name: clip(paused.name, 42) }) });
  }

  return recs.slice(0, 6);
}

function buildOutlook(d: DashboardData, copy: ReportCopy): string[] {
  const roas = kpi(d.paidKpis, 'roas');
  const views = kpi(d.organicKpis, 'views');
  const out: string[] = [];
  if (roas && roas.delta !== null) {
    out.push(roas.delta >= 0 ? copy.outlook.roasUp : copy.outlook.roasDown);
  }
  if (views && views.delta !== null) {
    out.push(views.delta >= 0 ? copy.outlook.viewsUp : copy.outlook.viewsDown);
  }
  if (out.length === 0) out.push(copy.outlook.fallback);
  return out;
}

function assessConfidence(d: DashboardData): 'High' | 'Medium' | 'Low' {
  const points = d.timeseries.length;
  const hasBoth = d.hasPaid && d.hasOrganic;
  if (points >= 21 && hasBoth) return 'High';
  if (points >= 7) return 'Medium';
  return 'Low';
}

const clip = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
