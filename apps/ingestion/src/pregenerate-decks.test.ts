import { describe, expect, it } from 'vitest';
import type { ClientSummary } from '@tempo/db';
import { objectivesFor, summarize, type PregenerateResult } from './pregenerate-decks.js';

const client = (northStar: ClientSummary['northStar']): ClientSummary => ({
  id: 'c1',
  name: 'Sovella',
  slug: 'sovella',
  brandColor: null,
  currency: 'IDR',
  timezone: 'Asia/Jakarta',
  northStar,
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
