import { and, eq } from 'drizzle-orm';
import type { CampaignDTO, OrganicMetricDTO, PaidMetricDTO, VideoDTO } from '@tempo/tiktok';
import type { Database } from '../client.js';
import {
  campaigns,
  organicDailyMetrics,
  paidDailyMetrics,
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
