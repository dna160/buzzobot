import { eachDay, parseIsoDate, type DateRange } from '@tempo/core';
import type {
  AccountDTO,
  CampaignDTO,
  OrganicMetricDTO,
  PaidMetricDTO,
  TikTokDataProvider,
  VideoDTO,
} from '../types.js';
import { SeededRandom, seedFrom } from './rng.js';

/**
 * Deterministic fixture provider. Generates realistic, trend-bearing TikTok
 * data (weekly seasonality, gentle growth, per-campaign character) entirely in
 * memory. It implements the same interface as the live provider, so the entire
 * app — ingestion, storage, dashboard — runs end-to-end with zero credentials.
 */

/** Stable synthetic account ids the fixtures always expose. */
export const FIXTURE_ADVERTISER_ID = 'adv_7xk29fixture';
export const FIXTURE_OPEN_ID = 'open_9m3zfixture';

const CAMPAIGN_BLUEPRINTS: ReadonlyArray<Omit<CampaignDTO, 'dailyBudget'> & { budget: number; scale: number }> =
  [
    { externalId: 'cmp_conv_prospecting', name: 'Q3 Prospecting — Conversions', objective: 'web_conversions', status: 'active', budget: 500, scale: 1.0 },
    { externalId: 'cmp_retargeting', name: 'Retargeting — Warm Audiences', objective: 'web_conversions', status: 'active', budget: 300, scale: 0.55 },
    { externalId: 'cmp_traffic_launch', name: 'Summer Launch — Traffic', objective: 'traffic', status: 'active', budget: 250, scale: 0.7 },
    { externalId: 'cmp_video_views', name: 'Brand Awareness — Video Views', objective: 'video_views', status: 'active', budget: 200, scale: 0.9 },
    { externalId: 'cmp_leadgen_paused', name: 'Lead Gen — Newsletter', objective: 'lead_generation', status: 'paused', budget: 150, scale: 0.3 },
  ];

const VIDEO_CAPTIONS: readonly string[] = [
  'POV: you finally found the one 🫶 #fyp',
  '3 things I wish I knew sooner ✨',
  'Behind the scenes of our biggest drop yet 🎬',
  'Replying to @user this is how we do it',
  'Wait for the end 😳 #viral',
  'The result speaks for itself 📈',
  'Day in the life running the brand',
  'Unboxing the summer collection ☀️',
  'You asked, we listened 🙌',
  'This trend but make it us 💅',
  'Honest review — no filter',
  'How it started vs how it’s going',
];

export class FixtureTikTokProvider implements TikTokDataProvider {
  readonly name = 'fixture';
  readonly surfaces = ['paid', 'organic'] as const;

  async listAccounts(): Promise<AccountDTO[]> {
    return [
      {
        surface: 'paid',
        externalId: FIXTURE_ADVERTISER_ID,
        displayName: 'Aurora Skincare — Ads',
        username: null,
        avatarUrl: null,
        status: 'active',
      },
      {
        surface: 'organic',
        externalId: FIXTURE_OPEN_ID,
        displayName: 'Aurora Skincare',
        username: '@auroraskin',
        avatarUrl: null,
        status: 'active',
      },
    ];
  }

  async listCampaigns(_advertiserId: string): Promise<CampaignDTO[]> {
    return CAMPAIGN_BLUEPRINTS.map((b) => ({
      externalId: b.externalId,
      name: b.name,
      objective: b.objective,
      status: b.status,
      dailyBudget: b.budget,
    }));
  }

  async getPaidDailyMetrics(_advertiserId: string, range: DateRange): Promise<PaidMetricDTO[]> {
    const out: PaidMetricDTO[] = [];
    for (const bp of CAMPAIGN_BLUEPRINTS) {
      for (const date of eachDay(range.start, range.end)) {
        const rng = new SeededRandom(seedFrom(`${bp.externalId}:${date}`));
        const season = weeklySeasonality(date);
        const growth = growthFactor(date, range.start);
        // Paused campaigns spend nothing after their pause point.
        const activeFactor = bp.status === 'paused' ? 0 : 1;

        const spend = round2(bp.budget * bp.scale * season * growth * rng.float(0.75, 1.05) * activeFactor);
        const cpm = rng.float(6.5, 12.5);
        const impressions = cpm > 0 ? Math.round((spend / cpm) * 1000) : 0;
        const ctr = rng.float(0.008, 0.021);
        const clicks = Math.round(impressions * ctr);
        const cvr = rng.float(0.012, 0.05) * conversionQuality(bp.objective);
        const conversions = Math.round(clicks * cvr);
        const aov = rng.float(38, 82);
        const conversionValue = round2(conversions * aov);
        const videoViews = Math.round(impressions * rng.float(0.35, 0.6));

        out.push({
          date,
          campaignExternalId: bp.externalId,
          spend,
          impressions,
          clicks,
          conversions,
          conversionValue,
          videoViews,
        });
      }
    }
    return out;
  }

  async listVideos(_openId: string): Promise<VideoDTO[]> {
    const rng = new SeededRandom(seedFrom('aurora-videos'));
    return VIDEO_CAPTIONS.map((caption, i) => {
      const publishedAt = new Date(parseIsoDate('2026-07-18').getTime() - i * 3 * 86_400_000);
      return {
        externalId: `vid_${1000 + i}`,
        caption,
        thumbnailUrl: null,
        shareUrl: `https://www.tiktok.com/@auroraskin/video/${7300000000000000000 + i}`,
        durationSec: rng.int(9, 58),
        publishedAt,
      };
    });
  }

  async getOrganicDailyMetrics(_openId: string, range: DateRange): Promise<OrganicMetricDTO[]> {
    const videos = await this.listVideos(_openId);
    const out: OrganicMetricDTO[] = [];
    for (const video of videos) {
      // A video only produces metrics on/after its publish date.
      const publishIso = video.publishedAt.toISOString().slice(0, 10);
      for (const date of eachDay(range.start, range.end)) {
        if (date < publishIso) continue;
        const rng = new SeededRandom(seedFrom(`${video.externalId}:${date}`));
        const ageDays = daysSince(publishIso, date);
        const decay = Math.exp(-ageDays / 6); // views decay after publish
        const virality = viralityFor(video.externalId);
        const baseViews = 8000 * virality;

        const views = Math.round(baseViews * decay * weeklySeasonality(date) * rng.float(0.7, 1.3));
        const engRate = rng.float(0.05, 0.14);
        const likes = Math.round(views * engRate * rng.float(0.7, 0.9));
        const comments = Math.round(views * engRate * rng.float(0.03, 0.08));
        const shares = Math.round(views * engRate * rng.float(0.05, 0.12));
        const avgWatch = video.durationSec * rng.float(0.35, 0.72);
        const watchTimeSec = round2(views * avgWatch);
        const reach = Math.round(views * rng.float(0.78, 0.94));
        const newFollowers = Math.round(views * rng.float(0.002, 0.01));

        out.push({
          date,
          videoExternalId: video.externalId,
          views,
          likes,
          comments,
          shares,
          watchTimeSec,
          reach,
          newFollowers,
        });
      }
    }
    return out;
  }
}

// --- Shaping helpers: turn noise into believable performance curves ---------

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Weekend uplift + midweek dip, ~±18%. */
const weeklySeasonality = (isoDate: string): number => {
  const dow = parseIsoDate(isoDate).getUTCDay(); // 0 Sun … 6 Sat
  const table = [1.12, 0.9, 0.92, 0.96, 1.02, 1.14, 1.18];
  return table[dow]!;
};

/** Gentle upward trend across the window (accounts maturing). */
const growthFactor = (isoDate: string, start: string): number => {
  const days = daysSince(start, isoDate);
  return 1 + Math.min(days, 90) * 0.004;
};

const conversionQuality = (objective: string): number =>
  objective === 'web_conversions' ? 1.4 : objective === 'lead_generation' ? 1.1 : 0.7;

const viralityFor = (externalId: string): number => {
  const r = new SeededRandom(seedFrom(externalId));
  // Most videos modest, a few break out (long tail).
  return r.next() > 0.82 ? r.float(3, 7) : r.float(0.5, 1.8);
};

const daysSince = (start: string, end: string): number =>
  Math.round((parseIsoDate(end).getTime() - parseIsoDate(start).getTime()) / 86_400_000);
