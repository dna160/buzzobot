import { describe, expect, it } from 'vitest';
import type { ClientSummary } from '@tempo/db';
import {
  objectivesFor,
  orderByTimezone,
  reportUrl,
  summarize,
  utcOffsetMinutes,
  type PregenerateResult,
} from './pregenerate-decks.js';

const client = (northStar: ClientSummary['northStar']): ClientSummary => ({
  id: 'c1',
  name: 'Sovella',
  slug: 'sovella',
  brandColor: null,
  currency: 'IDR',
  timezone: 'Asia/Jakarta',
  northStar,
  tier: 'standard',
});

describe('objectivesFor', () => {
  it('gives a Shop client awareness and GMV', () => {
    expect(objectivesFor(client('shop'))).toEqual(['awareness', 'gmv']);
  });

  it('gives an app-install client awareness and install', () => {
    expect(objectivesFor(client('app_install'))).toEqual(['awareness', 'install']);
  });

  it('gives a VTR client awareness only — there is no second honest deck', () => {
    expect(objectivesFor(client('vtr'))).toEqual(['awareness']);
  });

  it('never pre-generates a deck the route would refuse with a 409', () => {
    // The route gates every non-awareness objective on the client's north star.
    const gate: Record<string, string> = { gmv: 'shop', install: 'app_install' };
    for (const northStar of ['vtr', 'shop', 'app_install'] as const) {
      for (const objective of objectivesFor(client(northStar))) {
        if (objective === 'awareness') continue;
        expect(gate[objective]).toBe(northStar);
      }
    }
  });
});

describe('Strategy Report in the weekly job (Strategy Report PRD §9.5)', () => {
  it('adds strategy for any north star once the client has a Market Scope account', () => {
    expect(objectivesFor(client('vtr'), { marketScope: true })).toEqual(['awareness', 'strategy']);
    expect(objectivesFor(client('shop'), { marketScope: true })).toEqual(['awareness', 'gmv', 'strategy']);
    expect(objectivesFor(client('shop'))).toEqual(['awareness', 'gmv']);
  });

  it('asks the strategy route for a fresh full-tier 28-day PDF', () => {
    expect(reportUrl('http://x', 'bardi-tiktok', 'strategy', 7)).toBe(
      'http://x/api/reports/bardi-tiktok/strategy-report?tier=full&format=pdf&days=28&fresh=1',
    );
    expect(reportUrl('http://x', 'sovella', 'gmv', 7)).toBe('http://x/api/reports/sovella/brief/gmv?tier=full&days=7&fresh=1');
  });

  it('orders clients east to west so the earliest 06:00 is served first', () => {
    const at = new Date('2026-10-19T00:00:00Z');
    expect(utcOffsetMinutes('Asia/Jakarta', at)).toBe(420);
    expect(utcOffsetMinutes('Asia/Jayapura', at)).toBe(540);
    expect(utcOffsetMinutes('Not/AZone', at)).toBe(420);
    const tz = (slug: string, timezone: string) => ({ ...client('shop'), slug, timezone });
    const ordered = orderByTimezone(
      [tz('jkt-1', 'Asia/Jakarta'), tz('mks', 'Asia/Makassar'), tz('jpr', 'Asia/Jayapura'), tz('jkt-2', 'Asia/Jakarta')],
      at,
    );
    expect(ordered.map((c) => c.slug)).toEqual(['jpr', 'mks', 'jkt-1', 'jkt-2']);
  });
});

describe('summarize', () => {
  const result = (over: Partial<PregenerateResult>): PregenerateResult => ({
    slug: 'sovella',
    objective: 'gmv',
    ok: true,
    durationMs: 60_000,
    ...over,
  });

  it('counts what worked and names what did not', () => {
    const text = summarize([
      result({}),
      result({ slug: 'acme', ok: false, status: 502, error: 'engine unreachable' }),
    ]);

    expect(text).toContain('1/2 decks pre-generated');
    // A silent failure in an overnight job is a Monday morning surprise.
    expect(text).toContain('acme/gmv');
    expect(text).toContain('engine unreachable');
  });

  it('reports an empty run without dividing by zero', () => {
    expect(summarize([])).toContain('0/0');
  });
});
