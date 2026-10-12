import type pg from 'pg';

/**
 * Source data for the Awareness (`vtr`) and App Install (`app_install`)
 * Template Report variants. Deliberately a separate file from
 * `template-report-data.ts`: the GMV report's queries are tuned to
 * TTAM-vs-GMV-Max and are left untouched. These read only the regular-ads
 * (TTAM) tables — reach/video-retention/engagement and install/registration
 * columns all live there (`tiktok_ads_campaign` and the quarter-partitioned
 * `tiktok_ads_ads_*`); GMV Max carries no impressions, reach or installs.
 */

export interface NorthStarTotals {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  videoPlays: number;
  video2s: number;
  video6s: number;
  videoP25: number;
  videoP50: number;
  videoP75: number;
  videoP100: number;
  /** SUM(average_video_play * video_play_actions) — divide by videoPlays for the true play-weighted average seconds. */
  avgPlayWeighted: number;
  engagements: number;
  follows: number;
  profileVisits: number;
  shares: number;
  installs: number;
  registrations: number;
}

export interface NorthStarCampaignRow {
  campaignId: string;
  campaignName: string;
  objectiveType: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  video6s: number;
  engagements: number;
  installs: number;
  registrations: number;
}

export interface NorthStarCreativeRow {
  adName: string;
  format: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  videoPlays: number;
  video6s: number;
  videoP100: number;
  engagements: number;
  installs: number;
  registrations: number;
}

export interface NorthStarRawData {
  windowStart: string;
  windowEnd: string;
  priorStart: string;
  priorEnd: string;
  current: NorthStarTotals;
  prior: NorthStarTotals;
  campaigns: NorthStarCampaignRow[];
  priorCampaigns: NorthStarCampaignRow[];
  creatives: NorthStarCreativeRow[];
  tiktokAdAccountIds: string[];
}

const num = (v: unknown): number => Number(v) || 0;

const EMPTY_TOTALS: NorthStarTotals = totalsFromRow({});

// `app_install` (attributed) is preferred; `real_time_app_install` fills in
// only when the attributed column is empty for the whole row set — summing
// both would double count the same installs.
const TOTALS_SELECT = `
  COALESCE(SUM(spend), 0) as spend,
  COALESCE(SUM(impressions), 0) as impressions,
  COALESCE(SUM(clicks), 0) as clicks,
  COALESCE(SUM(reach), 0) as reach,
  COALESCE(SUM(video_play_actions), 0) as video_plays,
  COALESCE(SUM(video_watched_2s), 0) as video_2s,
  COALESCE(SUM(video_watched_6s), 0) as video_6s,
  COALESCE(SUM(video_views_p25), 0) as video_p25,
  COALESCE(SUM(video_views_p50), 0) as video_p50,
  COALESCE(SUM(video_views_p75), 0) as video_p75,
  COALESCE(SUM(video_views_p100), 0) as video_p100,
  COALESCE(SUM(COALESCE(average_video_play, 0) * COALESCE(video_play_actions, 0)), 0) as avg_play_weighted,
  COALESCE(SUM(engagements), 0) as engagements,
  COALESCE(SUM(follows), 0) as follows,
  COALESCE(SUM(profile_visits), 0) as profile_visits,
  COALESCE(SUM(shares), 0) as shares,
  COALESCE(SUM(app_install), 0) as app_install,
  COALESCE(SUM(real_time_app_install), 0) as real_time_app_install,
  COALESCE(SUM(registration), 0) as registration,
  COALESCE(SUM(total_registration), 0) as total_registration`;

function totalsFromRow(r: Record<string, string>): NorthStarTotals {
  const attributed = num(r.app_install);
  const registration = num(r.registration);
  return {
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    reach: num(r.reach),
    videoPlays: num(r.video_plays),
    video2s: num(r.video_2s),
    video6s: num(r.video_6s),
    videoP25: num(r.video_p25),
    videoP50: num(r.video_p50),
    videoP75: num(r.video_p75),
    videoP100: num(r.video_p100),
    avgPlayWeighted: num(r.avg_play_weighted),
    engagements: num(r.engagements),
    follows: num(r.follows),
    profileVisits: num(r.profile_visits),
    shares: num(r.shares),
    installs: attributed > 0 ? attributed : num(r.real_time_app_install),
    registrations: registration > 0 ? registration : num(r.total_registration),
  };
}

async function fetchTotals(pool: pg.Pool, ids: string[], start: string, end: string): Promise<NorthStarTotals> {
  const { rows } = await pool.query<Record<string, string>>(
    `SELECT ${TOTALS_SELECT}
     FROM tiktok_ads_campaign
     WHERE ad_account_id = ANY($1) AND date >= $2 AND date < $3;`,
    [ids, start, end],
  );
  return totalsFromRow(rows[0] ?? {});
}

async function fetchCampaigns(pool: pg.Pool, ids: string[], start: string, end: string): Promise<NorthStarCampaignRow[]> {
  const { rows } = await pool.query<Record<string, string | null>>(
    `SELECT
       campaign_id,
       MAX(NULLIF(campaign_name, '')) as campaign_name,
       MAX(objective_type) as objective_type,
       SUM(COALESCE(spend, 0)) as spend,
       SUM(COALESCE(impressions, 0)) as impressions,
       SUM(COALESCE(clicks, 0)) as clicks,
       SUM(COALESCE(reach, 0)) as reach,
       SUM(COALESCE(video_watched_6s, 0)) as video_6s,
       SUM(COALESCE(engagements, 0)) as engagements,
       SUM(COALESCE(app_install, 0)) as app_install,
       SUM(COALESCE(real_time_app_install, 0)) as real_time_app_install,
       SUM(COALESCE(registration, 0)) as registration,
       SUM(COALESCE(total_registration, 0)) as total_registration
     FROM tiktok_ads_campaign
     WHERE ad_account_id = ANY($1) AND date >= $2 AND date < $3 AND spend > 0
     GROUP BY campaign_id
     ORDER BY spend DESC;`,
    [ids, start, end],
  );
  return rows.map((r) => ({
    campaignId: String(r.campaign_id),
    campaignName: r.campaign_name ?? String(r.campaign_id),
    objectiveType: r.objective_type ?? null,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    reach: num(r.reach),
    video6s: num(r.video_6s),
    engagements: num(r.engagements),
    installs: num(r.app_install) > 0 ? num(r.app_install) : num(r.real_time_app_install),
    registrations: num(r.registration) > 0 ? num(r.registration) : num(r.total_registration),
  }));
}

/** Quarterly partitions a [start, end) window spans, e.g. y2026q3. */
function quartersInRange(start: string, end: string): string[] {
  const out = new Set<string>();
  const cur = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  while (cur < endDate) {
    out.add(`y${cur.getUTCFullYear()}q${Math.floor(cur.getUTCMonth() / 3) + 1}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return [...out];
}

/** Ad-level rows across every quarter partition the window touches, merged by ad so a window straddling a quarter boundary doesn't list one ad twice. */
async function fetchCreatives(pool: pg.Pool, ids: string[], start: string, end: string): Promise<NorthStarCreativeRow[]> {
  const byAd = new Map<string, NorthStarCreativeRow>();
  for (const q of quartersInRange(start, end)) {
    try {
      const { rows } = await pool.query<Record<string, string | null>>(
        `SELECT
           ad_id,
           MAX(NULLIF(ad_name, '')) as ad_name,
           MAX(image_mode) as image_mode,
           SUM(COALESCE(spend, 0)) as spend,
           SUM(COALESCE(impressions, 0)) as impressions,
           SUM(COALESCE(clicks, 0)) as clicks,
           SUM(COALESCE(reach, 0)) as reach,
           SUM(COALESCE(video_play_actions, 0)) as video_plays,
           SUM(COALESCE(video_watched_6s, 0)) as video_6s,
           SUM(COALESCE(video_views_p100, 0)) as video_p100,
           SUM(COALESCE(engagements, 0)) as engagements,
           SUM(COALESCE(app_install, 0)) as app_install,
           SUM(COALESCE(real_time_app_install, 0)) as real_time_app_install,
           SUM(COALESCE(registration, 0)) as registration,
           SUM(COALESCE(total_registration, 0)) as total_registration
         FROM tiktok_ads_ads_${q}
         WHERE ad_account_id = ANY($1) AND date >= $2 AND date < $3 AND spend > 0
         GROUP BY ad_id;`,
        [ids, start, end],
      );
      for (const r of rows) {
        const key = String(r.ad_id);
        const prev = byAd.get(key);
        const next: NorthStarCreativeRow = {
          adName: r.ad_name ?? 'Unnamed creative',
          format: r.image_mode ?? '—',
          spend: num(r.spend),
          impressions: num(r.impressions),
          clicks: num(r.clicks),
          reach: num(r.reach),
          videoPlays: num(r.video_plays),
          video6s: num(r.video_6s),
          videoP100: num(r.video_p100),
          engagements: num(r.engagements),
          installs: num(r.app_install) > 0 ? num(r.app_install) : num(r.real_time_app_install),
          registrations: num(r.registration) > 0 ? num(r.registration) : num(r.total_registration),
        };
        byAd.set(
          key,
          prev
            ? {
                ...prev,
                spend: prev.spend + next.spend,
                impressions: prev.impressions + next.impressions,
                clicks: prev.clicks + next.clicks,
                reach: prev.reach + next.reach,
                videoPlays: prev.videoPlays + next.videoPlays,
                video6s: prev.video6s + next.video6s,
                videoP100: prev.videoP100 + next.videoP100,
                engagements: prev.engagements + next.engagements,
                installs: prev.installs + next.installs,
                registrations: prev.registrations + next.registrations,
              }
            : next,
        );
      }
    } catch (err) {
      // A quarter with no partition yet (future) or already dropped — skip rather than fail the report.
      console.warn(`[north-star-report] skipping tiktok_ads_ads_${q}:`, (err as Error).message);
    }
  }
  return [...byAd.values()].sort((a, b) => b.spend - a.spend);
}

function daysBefore(end: string, days: number): string {
  const d = new Date(`${end}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000);
}

/**
 * Same window convention as `fetchTemplateReportRawData`: [start, end)
 * exclusive-end, default trailing 30 days, and a prior period of exactly the
 * same length immediately before it. `includeCreatives: false` skips the
 * ad-level scan — the industry-peer average only needs totals + campaigns.
 */
export async function fetchNorthStarRawData(
  pool: pg.Pool,
  {
    tiktokAdAccountIds,
    windowStart: explicitStart,
    windowEnd,
    includeCreatives = true,
    includePrior = true,
  }: {
    tiktokAdAccountIds: string[];
    windowStart?: string;
    windowEnd?: string;
    includeCreatives?: boolean;
    /** false skips both prior-period queries (`prior`/`priorCampaigns` come back empty) — the industry-peer average only reads the current window. */
    includePrior?: boolean;
  },
): Promise<NorthStarRawData> {
  const end = windowEnd ?? new Date().toISOString().slice(0, 10);
  const windowStart = explicitStart ?? daysBefore(end, 30);
  const windowDays = daysBetween(windowStart, end);
  const priorEnd = windowStart;
  const priorStart = daysBefore(priorEnd, windowDays);

  const [current, prior, campaigns, priorCampaigns, creatives] = await Promise.all([
    fetchTotals(pool, tiktokAdAccountIds, windowStart, end),
    includePrior ? fetchTotals(pool, tiktokAdAccountIds, priorStart, priorEnd) : Promise.resolve(EMPTY_TOTALS),
    fetchCampaigns(pool, tiktokAdAccountIds, windowStart, end),
    includePrior ? fetchCampaigns(pool, tiktokAdAccountIds, priorStart, priorEnd) : Promise.resolve([]),
    includeCreatives ? fetchCreatives(pool, tiktokAdAccountIds, windowStart, end) : Promise.resolve([]),
  ]);

  return {
    windowStart,
    windowEnd: end,
    priorStart,
    priorEnd,
    current,
    prior,
    campaigns,
    priorCampaigns,
    creatives,
    tiktokAdAccountIds,
  };
}
