import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  AdgroupDTO,
  CampaignDTO,
  OrganicMetricDTO,
  PaidHourlyMetricDTO,
  PaidMetricDTO,
  VideoDTO,
} from '@tempo/tiktok';
import type { Database } from '../client.js';
import {
  adgroups,
  campaigns,
  organicDailyMetrics,
  paidDailyMetrics,
  paidHourlyMetrics,
  tiktokAccounts,
  videos,
} from '../schema.js';

/**
 * Idempotent write helpers used by the ingestion pipeline. Each upsert is keyed
 * on the natural/external identity so re-running a sync never duplicates rows —
 * it refreshes them. Callers pass already-normalized DTOs.
 */

/** Upsert campaigns for an account; returns externalId → internal id. */
export async function upsertCampaigns(
  db: Database,
  accountId: string,
  rows: readonly CampaignDTO[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const c of rows) {
    const [row] = await db
      .insert(campaigns)
      .values({
        accountId,
        externalId: c.externalId,
        name: c.name,
        objective: c.objective,
        status: c.status,
        dailyBudget: c.dailyBudget,
      })
      .onConflictDoUpdate({
        target: [campaigns.accountId, campaigns.externalId],
        set: { name: c.name, objective: c.objective, status: c.status, dailyBudget: c.dailyBudget },
      })
      .returning({ id: campaigns.id });
    if (row) map.set(c.externalId, row.id);
  }
  return map;
}

/** Upsert adgroups; returns externalId → internal id. */
export async function upsertAdgroups(
  db: Database,
  campaignIdByExternal: Map<string, string>,
  rows: readonly AdgroupDTO[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const a of rows) {
    const campaignId = campaignIdByExternal.get(a.campaignExternalId);
    if (!campaignId) continue;
    const [row] = await db
      .insert(adgroups)
      .values({ campaignId, externalId: a.externalId, name: a.name, status: a.status })
      .onConflictDoUpdate({
        target: [adgroups.campaignId, adgroups.externalId],
        set: { name: a.name, status: a.status },
      })
      .returning({ id: adgroups.id });
    if (row) map.set(a.externalId, row.id);
  }
  return map;
}

/**
 * Upsert intraday facts. Campaign-rollup rows (adgroupId NULL) and adgroup rows
 * are keyed by separate partial unique indexes, so each needs its own conflict
 * target — Postgres can't infer one from a NULL-bearing column set.
 */
export async function upsertPaidHourlyMetrics(
  db: Database,
  campaignIdByExternal: Map<string, string>,
  adgroupIdByExternal: Map<string, string>,
  rows: readonly PaidHourlyMetricDTO[],
): Promise<number> {
  let written = 0;
  for (const m of rows) {
    const campaignId = campaignIdByExternal.get(m.campaignExternalId);
    if (!campaignId) continue;
    const adgroupId = m.adgroupExternalId
      ? (adgroupIdByExternal.get(m.adgroupExternalId) ?? null)
      : null;
    // An adgroup row whose parent we couldn't resolve would silently collapse
    // into the campaign rollup and double-count it — skip it instead.
    if (m.adgroupExternalId && !adgroupId) continue;

    const values = {
      date: m.date,
      hour: m.hour,
      campaignId,
      adgroupId,
      spend: m.spend,
      impressions: m.impressions,
      clicks: m.clicks,
      reach: m.reach,
      videoViews: m.videoViews,
      videoWatched6s: m.videoWatched6s,
      engagedView15s: m.engagedView15s,
      engagements: m.engagements,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      follows: m.follows,
      profileVisits: m.profileVisits,
      conversions: m.conversions,
      conversionValue: m.conversionValue,
      spanHours: m.spanHours,
    };
    const { date: _d, hour: _h, campaignId: _c, adgroupId: _a, ...updatable } = values;

    await db
      .insert(paidHourlyMetrics)
      .values(values)
      .onConflictDoUpdate({
        target: adgroupId
          ? [
              paidHourlyMetrics.date,
              paidHourlyMetrics.hour,
              paidHourlyMetrics.campaignId,
              paidHourlyMetrics.adgroupId,
            ]
          : [paidHourlyMetrics.date, paidHourlyMetrics.hour, paidHourlyMetrics.campaignId],
        targetWhere: adgroupId
          ? sql`${paidHourlyMetrics.adgroupId} IS NOT NULL`
          : isNull(paidHourlyMetrics.adgroupId),
        set: updatable,
      });
    written += 1;
  }
  return written;
}

/** Upsert videos for an account; returns externalId → internal id. */
export async function upsertVideos(
  db: Database,
  accountId: string,
  rows: readonly VideoDTO[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const v of rows) {
    const [row] = await db
      .insert(videos)
      .values({
        accountId,
        externalId: v.externalId,
        caption: v.caption,
        thumbnailUrl: v.thumbnailUrl,
        shareUrl: v.shareUrl,
        durationSec: v.durationSec,
        publishedAt: v.publishedAt,
      })
      .onConflictDoUpdate({
        target: [videos.accountId, videos.externalId],
        set: { caption: v.caption, thumbnailUrl: v.thumbnailUrl, shareUrl: v.shareUrl },
      })
      .returning({ id: videos.id });
    if (row) map.set(v.externalId, row.id);
  }
  return map;
}

/** Upsert paid daily metrics, resolving campaign external ids to internal ids. */
export async function upsertPaidMetrics(
  db: Database,
  campaignIdByExternal: Map<string, string>,
  rows: readonly PaidMetricDTO[],
): Promise<number> {
  let written = 0;
  for (const m of rows) {
    const campaignId = campaignIdByExternal.get(m.campaignExternalId);
    if (!campaignId) continue;
    await db
      .insert(paidDailyMetrics)
      .values({
        date: m.date,
        campaignId,
        spend: m.spend,
        impressions: m.impressions,
        clicks: m.clicks,
        conversions: m.conversions,
        conversionValue: m.conversionValue,
        videoViews: m.videoViews,
      })
      .onConflictDoUpdate({
        target: [paidDailyMetrics.date, paidDailyMetrics.campaignId],
        set: {
          spend: m.spend,
          impressions: m.impressions,
          clicks: m.clicks,
          conversions: m.conversions,
          conversionValue: m.conversionValue,
          videoViews: m.videoViews,
        },
      });
    written += 1;
  }
  return written;
}

/** Upsert organic daily metrics, resolving video external ids to internal ids. */
export async function upsertOrganicMetrics(
  db: Database,
  videoIdByExternal: Map<string, string>,
  rows: readonly OrganicMetricDTO[],
): Promise<number> {
  let written = 0;
  for (const m of rows) {
    const videoId = videoIdByExternal.get(m.videoExternalId);
    if (!videoId) continue;
    await db
      .insert(organicDailyMetrics)
      .values({
        date: m.date,
        videoId,
        views: m.views,
        likes: m.likes,
        comments: m.comments,
        shares: m.shares,
        watchTimeSec: m.watchTimeSec,
        reach: m.reach,
        newFollowers: m.newFollowers,
      })
      .onConflictDoUpdate({
        target: [organicDailyMetrics.date, organicDailyMetrics.videoId],
        set: {
          views: m.views,
          likes: m.likes,
          comments: m.comments,
          shares: m.shares,
          watchTimeSec: m.watchTimeSec,
          reach: m.reach,
          newFollowers: m.newFollowers,
        },
      });
    written += 1;
  }
  return written;
}

/** Look up an account row id by (surface, externalId). */
export async function findAccountId(
  db: Database,
  surface: string,
  externalId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: tiktokAccounts.id })
    .from(tiktokAccounts)
    .where(and(eq(tiktokAccounts.surface, surface), eq(tiktokAccounts.externalId, externalId)))
    .limit(1);
  return row?.id ?? null;
}
