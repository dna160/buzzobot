import type { WindowVideoRow } from '@tempo/db';

/**
 * Videos with organic activity in the window, shaped exactly as
 * `listWindowVideos` returns them.
 *
 * One row deliberately has no cached thumbnail and one has no `shareUrl`: both
 * are states the real pipeline produces (a CDN fetch that failed, a provider
 * that gave no permalink), and both have to render as something honest rather
 * than as a broken image or a link to nowhere.
 */

/** A 1×1 PNG. Enough to prove the bytes are embedded, small enough to read. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

interface Seed {
  id: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  publishedAt: string;
  thumbnail?: boolean;
  shareUrl?: string | null;
}

const SEEDS: Seed[] = [
  { id: 'v1', caption: 'Unboxing serum baru — hasil 7 hari', views: 412_000, likes: 38_400, comments: 1_920, shares: 4_100, publishedAt: '2026-08-11' },
  { id: 'v2', caption: 'Live highlight: promo payday', views: 268_500, likes: 19_100, comments: 880, shares: 1_450, publishedAt: '2026-08-13' },
  { id: 'v3', caption: 'Tutorial pakai 3 langkah', views: 154_300, likes: 12_700, comments: 610, shares: 990, publishedAt: '2026-08-12' },
  { id: 'v4', caption: 'Testimoni pelanggan', views: 98_700, likes: 6_300, comments: 240, shares: 410, publishedAt: '2026-08-14', thumbnail: false },
  { id: 'v5', caption: 'Behind the scenes produksi', views: 61_200, likes: 3_900, comments: 150, shares: 220, publishedAt: '2026-08-10', shareUrl: null },
  { id: 'v6', caption: 'Q&A bahan aktif', views: 43_800, likes: 2_800, comments: 310, shares: 180, publishedAt: '2026-08-15' },
  { id: 'v7', caption: 'Klip pendek: sebelum & sesudah', views: 22_400, likes: 1_450, comments: 90, shares: 70, publishedAt: '2026-08-16' },
];

export function buildVideoFixture(): WindowVideoRow[] {
  return SEEDS.map((seed) => ({
    id: seed.id,
    externalId: `ext_${seed.id}`,
    caption: seed.caption,
    shareUrl: seed.shareUrl === null ? null : `https://www.tiktok.com/@sovella/video/${seed.id}`,
    thumbnailDataUri: seed.thumbnail === false ? null : PIXEL,
    publishedAt: seed.publishedAt,
    views: seed.views,
    likes: seed.likes,
    comments: seed.comments,
    shares: seed.shares,
    reach: Math.round(seed.views * 0.82),
    engagementRate: ratio(seed.likes + seed.comments + seed.shares, seed.views),
    avgWatchTimeSec: 6.4,
  }));
}
