import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BriefObjective } from '@tempo/core';
import { describe, expect, it } from 'vitest';
import { buildDeckModel, type BuildDeckInput } from './build.js';
import { parseEngineContent } from './engine-content.js';
import { buildDashboardFixture } from './fixtures/dashboard.js';
import { buildVideoFixture } from './fixtures/videos.js';
import type { Block, DeckModel } from './model.js';
import { renderDeckHtml } from './render.js';
import { defaultReportSpec } from './spec.js';

/**
 * M4's exit criteria (PRD §9): thumbnails click through to TikTok from inside
 * the PDF, and rendering makes no network request. Both are asserted as
 * properties of the model and the document, not by eyeballing a screenshot.
 */

const RAW = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/engine-content.gmv.instant.json', import.meta.url)),
    'utf8',
  ),
) as unknown;

const videos = buildVideoFixture();

function build(overrides: Partial<BuildDeckInput> = {}): DeckModel {
  const parsed = parseEngineContent(RAW);
  return buildDeckModel({
    content: parsed.content,
    contentVersion: parsed.version,
    dashboard: buildDashboardFixture(),
    spec: defaultReportSpec(BriefObjective.Gmv),
    objective: BriefObjective.Gmv,
    runId: 'run_videos',
    tier: 'instant',
    generatedAt: '2026-08-17T02:00:00.000Z',
    windowDays: 7,
    videos,
    ...overrides,
  });
}

const grid = (model: DeckModel) =>
  model.slides
    .flatMap((s) => s.blocks)
    .find((b): b is Extract<Block, { kind: 'videoGrid' }> => b.kind === 'videoGrid');

describe('S5 video slide', () => {
  it('adds the slide between S4 and S6', () => {
    expect(build().slides.map((s) => s.id)).toEqual([
      's0',
      's1',
      's2',
      's3',
      's4',
      's5',
      's6',
      'appendix-a',
      'appendix-b',
    ]);
  });

  it('is omitted entirely when the client has no organic videos', () => {
    const ids = build({ videos: [] }).slides.map((s) => s.id);
    expect(ids).not.toContain('s5');
    expect(ids).not.toContain('appendix-b');
  });

  it('shows the top videos by views, one row of three', () => {
    const cells = grid(build())!.videos;
    expect(cells).toHaveLength(3);
    const captions = cells.map((c) => c.caption);
    expect(captions[0]).toBe(videos[0]!.caption);
    // Ranked, not arbitrary: the lower-view videos are the ones left out, and
    // Lampiran B still carries all of them.
    expect(captions).not.toContain(videos[6]!.caption);
  });

  it('link integrity: every href is the row own shareUrl, never constructed', () => {
    const byId = new Map(videos.map((v) => [v.id, v]));
    for (const cell of grid(build())!.videos) {
      expect(cell.href).toBe(byId.get(cell.videoId)!.shareUrl ?? '');
    }
  });

  it('renders a video without a permalink as a plain cell, not a dead link', () => {
    const noLink = videos.find((v) => v.shareUrl === null)!;
    const html = renderDeckHtml(build());
    // Present as content...
    expect(html).toContain(noLink.caption);
    // ...but never wrapped in an anchor with an empty href.
    expect(html).not.toMatch(/<a class="video" href=""/);
  });

  it('embeds cached thumbnails as data URIs and never fetches at render time', () => {
    const html = renderDeckHtml(build());
    const sources = [...html.matchAll(/<img[^>]+src="([^"]*)"/g)].map((m) => m[1]!);

    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(src.startsWith('data:image/')).toBe(true);
    }
    // The only URLs in the document are the TikTok permalinks in hrefs.
    for (const url of [...html.matchAll(/https?:\/\/[^\s"']+/g)].map((m) => m[0])) {
      expect(url).toMatch(/^https:\/\/www\.tiktok\.com\/@/);
    }
  });

  it('draws a branded placeholder when a thumbnail was never cached', () => {
    // The uncached video ranks below the top three, so the grid is asked for it
    // explicitly — the placeholder must be a rendering state, not a lucky miss.
    const uncached = videos.find((v) => v.thumbnailDataUri === null)!;
    const html = renderDeckHtml(build({ videos: [uncached, ...videos] }));
    expect(html).toContain('video__placeholder');
    expect(html).toContain('Pratinjau tidak tersedia');
  });

  it('states that per-video metrics are organic only (R7)', () => {
    const html = renderDeckHtml(build());
    expect(html).toMatch(/Omzet per video belum tersedia/);
  });
});

describe('Lampiran B', () => {
  const table = () => {
    const slide = build().slides.find((s) => s.id === 'appendix-b')!;
    const block = slide.blocks.find((b): b is Extract<Block, { kind: 'table' }> => b.kind === 'table');
    return block!.spec;
  };

  it('lists every video in the window, not just the six that tiled', () => {
    expect(table().rows).toHaveLength(videos.length);
  });

  it('carries no revenue column — the Shop contract for video grain does not exist', () => {
    for (const header of table().headers) {
      expect(header.toLowerCase()).not.toContain('omzet');
      expect(header.toLowerCase()).not.toContain('gmv');
    }
  });

  it('is omitted when the spec turns the video appendix off', () => {
    const spec = defaultReportSpec(BriefObjective.Gmv);
    spec.appendix = { ...spec.appendix, allVideos: false };
    expect(build({ spec }).slides.map((s) => s.id)).not.toContain('appendix-b');
  });
});
