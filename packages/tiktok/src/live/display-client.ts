import type { DataSurface, DateRange } from '@tempo/core';
import type { OrganicMetricDTO, VideoDTO } from '../types.js';
import { requestJson } from './http.js';

/**
 * Client for the TikTok Display / Content API (open.tiktokapis.com) — organic
 * surface. Docs: https://developers.tiktok.com/doc/
 *
 * Endpoints used:
 *   POST /v2/video/list/  — a creator's videos with lifetime insights
 *
 * Note: the public Display API exposes lifetime video insights rather than
 * per-day breakdowns. This client fetches the video list and lifetime stats;
 * per-day distribution is reconstructed by the ingestion layer for accounts
 * without Business-tier daily insight access. Requires a per-user OAuth token.
 */
export class TikTokDisplayClient {
  constructor(
    private readonly cfg: { baseUrl: string; userAccessToken?: string },
  ) {}

  readonly surface: DataSurface = 'organic';

  private headers() {
    if (!this.cfg.userAccessToken) {
      throw new Error('TikTok Display API requires a per-user OAuth access token');
    }
    return { Authorization: `Bearer ${this.cfg.userAccessToken}` };
  }

  async listVideos(_openId: string): Promise<VideoDTO[]> {
    interface Resp {
      data?: { videos?: RawVideo[] };
    }
    const res = await requestJson<Resp>(`${this.cfg.baseUrl}/v2/video/list/`, {
      method: 'POST',
      headers: this.headers(),
      query: {
        fields: [
          'id',
          'title',
          'video_description',
          'duration',
          'cover_image_url',
          'share_url',
          'create_time',
        ].join(','),
      },
      body: { max_count: 20 },
    });
    return (res.data?.videos ?? []).map(mapVideo);
  }

  /**
   * Fetch organic daily metrics. The Display API returns lifetime counters,
   * so the ingestion layer is responsible for turning these into daily deltas.
   * Returned rows here are keyed to the range's end date (snapshot semantics).
   */
  async getDailyMetrics(openId: string, range: DateRange): Promise<OrganicMetricDTO[]> {
    interface Resp {
      data?: { videos?: RawVideoStat[] };
    }
    const res = await requestJson<Resp>(`${this.cfg.baseUrl}/v2/video/query/`, {
      method: 'POST',
      headers: this.headers(),
      query: {
        fields: ['id', 'like_count', 'comment_count', 'share_count', 'view_count'].join(','),
      },
      body: { open_id: openId },
    });
    return (res.data?.videos ?? []).map((v) => mapVideoStat(v, range.end));
  }
}

interface RawVideo {
  id: string;
  title?: string;
  video_description?: string;
  duration?: number;
  cover_image_url?: string;
  share_url?: string;
  create_time?: number;
}

interface RawVideoStat {
  id: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
}

const mapVideo = (v: RawVideo): VideoDTO => ({
  externalId: v.id,
  caption: v.title || v.video_description || '',
  thumbnailUrl: v.cover_image_url ?? null,
  shareUrl: v.share_url ?? null,
  durationSec: v.duration ?? 0,
  publishedAt: v.create_time ? new Date(v.create_time * 1000) : new Date(0),
});

const mapVideoStat = (v: RawVideoStat, date: string): OrganicMetricDTO => {
  const views = v.view_count ?? 0;
  return {
    date: date.slice(0, 10),
    videoExternalId: v.id,
    views,
    likes: v.like_count ?? 0,
    comments: v.comment_count ?? 0,
    shares: v.share_count ?? 0,
    // Watch time / reach / follower attribution require Business-tier insights;
    // left at 0 here and enriched when that scope is granted.
    watchTimeSec: 0,
    reach: 0,
    newFollowers: 0,
  };
};
