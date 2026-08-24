import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_THUMBNAIL_BYTES, cacheThumbnail, readThumbnailDataUri } from './thumbnails.js';

/**
 * The cache exists because TikTok CDN URLs expire and the deck renders with no
 * network. Both halves of that promise are asserted here: bytes land on disk at
 * ingest, and they come back as an embeddable data URI later.
 *
 * Every failure path returns rather than throws — a slow image host must never
 * fail a client's metrics ingest.
 */

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const dir = () => mkdtemp(join(tmpdir(), 'tempo-thumbs-'));

const okFetch = (body: Buffer, type = 'image/png') =>
  (async () =>
    new Response(new Uint8Array(body), {
      status: 200,
      headers: { 'content-type': type },
    })) as unknown as typeof fetch;

describe('cacheThumbnail', () => {
  it('writes the bytes and returns the path', async () => {
    const target = await dir();
    const result = await cacheThumbnail('vid1', 'https://cdn.example/a.png', {
      dir: target,
      fetchImpl: okFetch(PNG),
    });

    expect(result.outcome).toBe('fetched');
    expect(result.path).toMatch(/\.png$/);
    expect(await readFile(result.path!)).toEqual(PNG);
  });

  it('does not re-fetch bytes it already has', async () => {
    const target = await dir();
    let calls = 0;
    const counting = (async (...args: Parameters<typeof fetch>) => {
      calls += 1;
      return okFetch(PNG)(...args);
    }) as unknown as typeof fetch;

    await cacheThumbnail('vid1', 'https://cdn.example/a.png', { dir: target, fetchImpl: counting });
    const second = await cacheThumbnail('vid1', 'https://cdn.example/a.png', {
      dir: target,
      fetchImpl: counting,
    });

    expect(second.outcome).toBe('hit');
    expect(calls).toBe(1);
  });

  it('skips a video with no thumbnail url', async () => {
    const result = await cacheThumbnail('vid1', null, { dir: await dir() });
    expect(result).toMatchObject({ path: null, outcome: 'skipped' });
  });

  it.each([
    ['a non-OK response', async () => new Response('nope', { status: 404 })],
    [
      'a type that is not an image',
      async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ],
    [
      'an oversized body',
      async () =>
        new Response(new Uint8Array(Buffer.alloc(MAX_THUMBNAIL_BYTES + 1)), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
    ],
    [
      'a network error',
      async () => {
        throw new Error('ECONNRESET');
      },
    ],
  ])('reports %s without throwing', async (_label, impl) => {
    const result = await cacheThumbnail('vid1', 'https://cdn.example/a.png', {
      dir: await dir(),
      fetchImpl: impl as unknown as typeof fetch,
    });
    expect(result.outcome).toBe('failed');
    expect(result.path).toBeNull();
    expect(result.reason).toBeTruthy();
  });

  it('keys the cache per video and url, so two videos never collide', async () => {
    const target = await dir();
    const a = await cacheThumbnail('vid1', 'https://cdn.example/a.png', {
      dir: target,
      fetchImpl: okFetch(PNG),
    });
    const b = await cacheThumbnail('vid2', 'https://cdn.example/a.png', {
      dir: target,
      fetchImpl: okFetch(PNG),
    });
    expect(a.path).not.toBe(b.path);
  });
});

describe('readThumbnailDataUri', () => {
  it('returns an embeddable data URI', async () => {
    const target = await dir();
    const { path } = await cacheThumbnail('vid1', 'https://cdn.example/a.png', {
      dir: target,
      fetchImpl: okFetch(PNG),
    });

    const uri = await readThumbnailDataUri(path);
    expect(uri).toMatch(/^data:image\/png;base64,/);
    expect(uri).toContain(PNG.toString('base64'));
  });

  it('returns null rather than throwing for a missing or empty file', async () => {
    const target = await dir();
    const empty = join(target, 'empty.png');
    await writeFile(empty, Buffer.alloc(0));

    expect(await readThumbnailDataUri(null)).toBeNull();
    expect(await readThumbnailDataUri(join(target, 'gone.png'))).toBeNull();
    expect(await readThumbnailDataUri(empty)).toBeNull();
  });
});
