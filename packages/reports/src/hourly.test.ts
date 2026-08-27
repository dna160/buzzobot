import { describe, expect, it } from 'vitest';
import type { ClientSummary, HourlyDashboardData, HourPoint, Totals } from '@tempo/db';
import { renderHourlyHtml } from './hourly.js';

/**
 * The renderer's job is to not lie. Three ways it could:
 *   - print 0 where the read-model said "not derivable" (null),
 *   - lead with a metric the client's objective cannot support,
 *   - present a partial day as if it were a whole one.
 * One case each, plus the peak-hour marker, which is the only computation here.
 */

const hour = (h: number, over: Partial<HourPoint> = {}): HourPoint => ({
  hour: h,
  spend: 1000,
  impressions: 10_000,
  clicks: 100,
  reach: 8000,
  videoViews: 5000,
  videoWatched6s: 2000,
  engagedView15s: 900,
  engagements: 300,
  vtr6s: 0.2,
  vtr15s: 0.09,
  frequency: 1.25,
  ctr: 0.01,
  cpc: 10,
  cpm: 100,
  cpv: 0.2,
  conversions: 5,
  conversionValue: 20_000,
  cpa: 200,
  conversionRate: 0.05,
  roas: 20,
  ...over,
});

const totals = (over: Partial<Totals> = {}): Totals => ({
  spend: 3000,
  impressions: 30_000,
  clicks: 300,
  reach: 20_000,
  videoViews: 15_000,
  videoWatched6s: 6000,
  engagedView15s: 2700,
  engagements: 900,
  vtr6s: 0.2,
  vtr15s: 0.09,
  frequency: 1.5,
  ctr: 0.01,
  cpc: 10,
  cpm: 100,
  cpv: 0.2,
  conversions: 15,
  conversionValue: 60_000,
  cpa: 200,
  conversionRate: 0.05,
  roas: 20,
  ...over,
});

const client = (over: Partial<ClientSummary> = {}): ClientSummary =>
  ({
    id: 'c1',
    name: 'Acme',
    slug: 'acme',
    brandColor: '#1FD8C7',
    currency: 'IDR',
    timezone: 'Asia/Jakarta',
    northStar: 'shop',
    tier: 'premium',
    ...over,
  }) as ClientSummary;

const data = (over: Partial<HourlyDashboardData> = {}): HourlyDashboardData =>
  ({
    client: client(),
    availableDates: ['2026-07-19', '2026-07-20'],
    date: '2026-07-20',
    coverage: { firstHour: 9, lastHour: 11, aggregatedHours: [], isComplete: true },
    totals: totals(),
    comparison: null,
    hours: [hour(9), hour(10, { spend: 9999 }), hour(11)],
    pacing: [{ hour: 9, cumulative: 1000, share: 0.09, evenShare: 0.33 }],
    dayOverDay: [],
    campaigns: [],
    ...over,
  }) as HourlyDashboardData;

describe('renderHourlyHtml', () => {
  it('renders a self-contained document with the client and date named', () => {
    const html = renderHourlyHtml(data());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Acme');
    expect(html).toContain('2026-07-20');
    // Self-contained: nothing to fetch, so Chromium and the browser agree.
    expect(html).not.toMatch(/<(script|link)\b/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('prints an em dash, never 0, in the table for a metric it could not derive', () => {
    const html = renderHourlyHtml(
      data({
        totals: totals({ roas: null, cpa: null, ctr: null, cpm: null }),
        hours: [hour(9, { roas: null, ctr: null, cpm: null })],
      }),
    );

    // The assertion has to be about the table, not the whole document: the
    // chart's right axis legitimately prints a "0.00x" tick label, and matching
    // on the raw HTML would catch that instead of the cell under test.
    const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tfoot>'));
    const cells = body.match(/<td[^>]*>([^<]*)<\/td>/g) ?? [];
    const dashes = cells.filter((c) => c.includes('—'));

    // CTR, CPM and ROAS are null on both the hour row and the totals row.
    expect(dashes.length).toBe(6);
    expect(body).not.toContain('>0.00x<');
    expect(body).not.toContain('>0.00%<');
  });

  it('leads with the metrics the client objective supports', () => {
    const shop = renderHourlyHtml(data());
    expect(shop).toContain('ROAS');
    expect(shop).toContain('GMV');

    const vtr = renderHourlyHtml(data({ client: client({ northStar: 'vtr' }) }));
    expect(vtr).toContain('VTR 6s');
    expect(vtr).not.toContain('ROAS');

    const install = renderHourlyHtml(data({ client: client({ northStar: 'app_install' }) }));
    expect(install).toContain('CPI');
    expect(install).not.toContain('ROAS');
  });

  it('marks the peak spending hour and no other', () => {
    const html = renderHourlyHtml(data());
    expect((html.match(/class="peak"/g) ?? []).length).toBe(1);
    // The peak row is hour 10 — the one with the outlier spend.
    expect(html).toMatch(/<tr class="peak">\s*<td>10:00<\/td>/);
  });

  it('says so when the day is still running or a bucket absorbs earlier hours', () => {
    const partial = renderHourlyHtml(
      data({
        coverage: {
          firstHour: 9,
          lastHour: 11,
          aggregatedHours: [{ hour: 9, spanHours: 10 }],
          isComplete: false,
        },
      }),
    );
    expect(partial).toContain('sementara');
    expect(partial).toContain('memuat 10 jam');

    // A span of 2 absorbs only the empty hour before it — not worth a warning.
    const immaterial = renderHourlyHtml(
      data({
        coverage: {
          firstHour: 9,
          lastHour: 11,
          aggregatedHours: [{ hour: 1, spanHours: 2 }],
          isComplete: true,
        },
      }),
    );
    expect(immaterial).not.toContain('memuat');
  });

  it('reports the compared window as the shared hours, not a whole day', () => {
    const html = renderHourlyHtml(
      data({
        comparison: {
          date: '2026-07-19',
          hoursMatched: [9, 10],
          current: totals(),
          previous: totals({ spend: 1500 }),
          deltas: {
            impressions: 0.1,
            reach: null,
            vtr6s: null,
            vtr15s: null,
            spend: 1.0,
            clicks: null,
            ctr: null,
            cpc: null,
            cpm: null,
            conversions: null,
            cpa: null,
            roas: null,
          },
        },
      }),
    );
    expect(html).toContain('2 jam yang sama-sama tersedia');
    expect(html).toContain('vs prev');
  });

  it('escapes campaign names rather than emitting their markup', () => {
    const html = renderHourlyHtml(
      data({
        campaigns: [
          {
            id: 'c',
            name: '<img src=x onerror=alert(1)>',
            objective: 'TRAFFIC',
            totals: totals(),
            hours: [],
            adgroups: [],
          },
        ],
      }),
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('renders an empty day without throwing', () => {
    const html = renderHourlyHtml(
      data({
        hours: [],
        pacing: [],
        campaigns: [],
        totals: totals({ spend: 0, impressions: 0, clicks: 0, ctr: null, cpm: null, roas: null, cpa: null }),
        coverage: { firstHour: null, lastHour: null, aggregatedHours: [], isComplete: false },
      }),
    );
    expect(html).toContain('Belum ada jam dengan spend');
    expect(html).toContain('belum ada jam tercatat');
  });
});
