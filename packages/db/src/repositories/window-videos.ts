import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { Database } from '../client.js';
import { organicDailyMetrics, tiktokAccounts, videos } from '../schema.js';
import { readThumbnailDataUri } from '../ingest/thumbnails.js';
import type { ClientSummary } from './dashboard.js';

/**
 * Every video that carried organic activity in a window (Brief Deck PRD §4,
 * S5 and Lampiran B).
 *
 * Distinct from `dashboard.ts`'s `topVideos`, which is a fixed top-10 for the
 * dashboard's own range: the deck needs the *whole* window for Lampiran B
 * ("halaman depan bersih, halaman belakang lengkap") and the top N for the S5
 * grid, from the same query.
 *
 * **R7 — no revenue per video.** The PRD gates an "omzet per video" column on
 * the TikTok Shop DTO contract, which is explicitly undocumented (engine PRD
 * §3.3). Shop revenue is not joinable to a video in this schema at all, so the
 * column is not merely omitted here — there is nothing to omit. Lampiran B
 * shows organic metrics and says so.
 */

export interface WindowVideoRow {
  id: string;
  externalId: string;
  caption: string;
  /** The TikTok permalink. Null when the provider gave none. */
  shareUrl: string | null;
  /** Cached thumbnail as a `data:` URI, or null → branded placeholder. */
  thumbnailDataUri: string | null;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  reach: number;
  /** (likes + comments + shares) / views — from summed totals, never averaged. */
  engagementRate: number | null;
  /** Total watch time / views. */
  avgWatchTimeSec: number | null;
}

export interface WindowVideosOptions {
  /** Inclusive ISO dates. */
  startDate: string;
  endDate: string;
  /** How many rows to load thumbnails for; the rest are text-only (Lampiran B). */
  thumbnailLimit?: number;
}

const DEFAULT_THUMBNAIL_LIMIT = 6;

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

export async function listWindowVideos(
  db: Database,
  client: ClientSummary,
  { startDate, endDate, thumbnailLimit = DEFAULT_THUMBNAIL_LIMIT }: WindowVideosOptions,
): Promise<WindowVideoRow[]> {
  const rows = await db
    .select({
      id: videos.id,
      externalId: videos.externalId,
      caption: videos.caption,
      shareUrl: videos.shareUrl,
      thumbnailCachedPath: videos.thumbnailCachedPath,
      publishedAt: videos.publishedAt,
      date: organicDailyMetrics.date,
      views: organicDailyMetrics.views,
      likes: organicDailyMetrics.likes,
      comments: organicDailyMetrics.comments,
      shares: organicDailyMetrics.shares,
      reach: organicDailyMetrics.reach,
      watchTimeSec: organicDailyMetrics.watchTimeSec,
    })
    .from(organicDailyMetrics)
    .innerJoin(videos, eq(organicDailyMetrics.videoId, videos.id))
    .innerJoin(tiktokAccounts, eq(videos.accountId, tiktokAccounts.id))
    .where(
      and(
        eq(tiktokAccounts.clientId, client.id),
        gte(organicDailyMetrics.date, startDate),
        lte(organicDailyMetrics.date, endDate),
      ),
    )
    .orderBy(desc(videos.publishedAt));

  interface Acc {
    meta: { id: string; externalId: string; caption: string; shareUrl: string | null; thumbnailCachedPath: string | null; publishedAt: string };
    views: number;
    likes: number;
    comments: number;
    shares: number;
    reach: number;
    watchTimeSec: number;
  }

  const byVideo = new Map<string, Acc>();
  for (const row of rows) {
    let acc = byVideo.get(row.id);
    if (!acc) {
      acc = {
        meta: {
          id: row.id,
          externalId: row.externalId,
          caption: row.caption,
          shareUrl: row.shareUrl,
          thumbnailCachedPath: row.thumbnailCachedPath,
          publishedAt:
            row.publishedAt instanceof Date
              ? row.publishedAt.toISOString().slice(0, 10)
              : String(row.publishedAt).slice(0, 10),
        },
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        reach: 0,
        watchTimeSec: 0,
      };
      byVideo.set(row.id, acc);
    }
    // Summed across the window's days, then divided once — the same rule the
    // paid rollups follow, for the same reason: a rate averaged over days is
    // not the window's rate.
    acc.views += row.views;
    acc.likes += row.likes;
    acc.comments += row.comments;
    acc.shares += row.shares;
    acc.reach += row.reach;
    acc.watchTimeSec += row.watchTimeSec;
  }

  const ordered = [...byVideo.values()].sort((a, b) => b.views - a.views);

  // Thumbnails are read from disk only for the rows that will show one. A
  // hundred-video appendix must not read a hundred files to print a table.
  const withThumbnails = await Promise.all(
    ordered.map(async (acc, index) => ({
      ...acc.meta,
      thumbnailDataUri:
        index < thumbnailLimit ? await readThumbnailDataUri(acc.meta.thumbnailCachedPath) : null,
      views: acc.views,
      likes: acc.likes,
      comments: acc.comments,
      shares: acc.shares,
      reach: acc.reach,
      engagementRate: ratio(acc.likes + acc.comments + acc.shares, acc.views),
      avgWatchTimeSec: ratio(acc.watchTimeSec, acc.views),
    })),
  );

  return withThumbnails.map(({ thumbnailCachedPath: _drop, ...row }) => row);
}
