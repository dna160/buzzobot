import { describe, expect, it } from 'vitest';
import type { ClientSummary, HourPoint, Totals } from '@tempo/db';
import { getCopy } from './i18n.js';
import { renderHourlyReportHtml } from './hourly-render.js';
import type { HourlyReportBase, HourlyReportDay, HourlyReportModel } from './hourly-model.js';
import { analyseHourly } from './hourly-analysis.js';
import { toNarrative } from './narrative/generate.js';

const client: ClientSummary = {
  id: 'c1',
  name: 'Cimory',
  slug: 'cimory',
  brandColor: '#E4002B',
  currency: 'IDR',
  timezone: 'Asia/Jakarta',
};

const hour = (h: number, over: Partial<HourPoint> = {}): HourPoint => ({
  hour: h,
  spend: 1_000_000,
  impressions: 200_000,
  clicks: 500,
  reach: 0,
  videoViews: 5_000,
  engagements: 100,
  ctr: 500 / 200_000,
  cpc: 2_000,
  cpm: 5_000,
  cpv: 200,
  ...over,
});

const totals = (over: Partial<Totals> = {}): Totals => ({
  spend: 2_000_000,
  impressions: 400_000,
  clicks: 1_000,
  reach: 0,
  videoViews: 10_000,
  engagements: 200,
  ctr: 0.0025,
  cpc: 2_000,
  cpm: 5_000,
  cpv: 200,
  ...over,
});

const day = (date: string, hours: HourPoint[]): HourlyReportDay => ({
  date,
  coverage: {
    firstHour: hours[0]?.hour ?? null,
    lastHour: hours[hours.length - 1]?.hour ?? null,
    aggregatedHours: [],
    isComplete: false,
  },
  totals: totals(),
  hours,
  pacing: hours.map((h, i) => ({
    hour: h.hour,
    cumulative: (i + 1) * h.spend,
    share: (i + 1) / hours.length,
    evenShare: (i + 1) / hours.length,
  })),
});

function model(over: Partial<HourlyReportModel> = {}): HourlyReportModel {
  const d = day('2026-07-19', [hour(10), hour(11)]);
  const base: HourlyReportBase = {
    locale: 'en',
    copy: getCopy('en'),
    client,
    days: [d],
    focus: d,
    campaigns: [],
    windowTotals: totals(),
    totalHours: 2,
    comparison: null,
    periodLabel: 'Jul 19, 2026',
    generatedLabel: 'Generated Jul 21, 2026 · 00:00 UTC',
    ...over,
  };
  return {
    ...base,
    insights: { headline: 'Headline.', summary: [], coverage: [], campaigns: [] },
    // These tests exercise the renderer, so use the deterministic narrative
    // directly — no network, and the same shape the LLM path produces.
    narrative: {
      narrative: toNarrative(analyseHourly(base)),
      source: 'deterministic',
      provider: null,
      model: null,
      attempts: 0,
    },
    ...over,
  };
}

describe('renderHourlyReportHtml', () => {
  it('never presents a value for a metric the export cannot supply', () => {
    const html = renderHourlyReportHtml(model());

    // The original defect: the daily report rendered ROAS/CPA as real zeros
    // ("0.00x blended ROAS", "CPA IDR 0") and built a summary around them.
    // Naming these metrics to say they are *unavailable* is correct and
    // expected; presenting a figure for one is not.
    expect(html).not.toMatch(/\d\s*(?:x|×)\s*(?:blended\s*)?ROAS/i);
    expect(html).not.toMatch(/ROAS[^.<]{0,20}\d/i);
    expect(html).not.toMatch(/\bCPA\b[^.<]{0,20}\d/i);

    // No KPI card or table column may be headed by an unsupported metric.
    const labels = [...html.matchAll(/class="klabel">([^<]+)</g)].map((m) => m[1]!);
    const headers = [...html.matchAll(/<th[^>]*>([^<]+)</g)].map((m) => m[1]!);
    for (const text of [...labels, ...headers]) {
      expect(text).not.toMatch(/ROAS|CPA|conversion/i);
    }
  });

  it('states plainly that revenue-based metrics are unavailable', () => {
    const html = renderHourlyReportHtml(model());
    // Silence would be worse than absence — the reader must be told why.
    expect(html).toMatch(/no revenue or conversion-value column/i);
  });

  it('renders an unavailable ratio as text, never as zero', () => {
    const d = day('2026-07-19', [hour(10, { clicks: 0, ctr: 0, cpc: null })]);
    const html = renderHourlyReportHtml(
      model({ days: [d], focus: d, windowTotals: totals({ cpc: null }) }),
    );
    expect(html).toContain('not available');
  });

  it('pools appendix footer ratios from column sums rather than averaging hours', () => {
    // 1 click/10k impressions then 99 clicks/990k impressions.
    // Mean of hourly CTRs ≈ 5.0%; the pooled figure is 100/1,000,000 = 0.01%.
    const d = day('2026-07-19', [
      hour(1, { impressions: 10_000, clicks: 1, ctr: 1 / 10_000, spend: 1000 }),
      hour(2, { impressions: 990_000, clicks: 99, ctr: 99 / 990_000, spend: 99_000 }),
    ]);
    const html = renderHourlyReportHtml(model({ days: [d], focus: d }));
    const foot = html.slice(html.indexOf('<tfoot>'));
    expect(foot).toContain('0.01%');
    expect(foot).not.toContain('5.00%');
  });

  it('escapes campaign names into the document', () => {
    const html = renderHourlyReportHtml(
      model({
        campaigns: [
          {
            id: 'x',
            name: 'Cimory <script>alert(1)</script>',
            objective: 'video_views',
            totals: totals(),
            hours: [],
            adgroups: [],
          },
        ],
      }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('never calls cost per click "stable" when a large spread exists', () => {
    // Cheap early hours, very expensive late hours where the budget actually
    // goes. An earlier version compared one extreme hour to the median and
    // reported "broadly stable" across a 20x spread.
    const hours = [
      hour(2, { spend: 600_000, clicks: 1500, cpc: 400, ctr: 0.009, impressions: 160_000 }),
      hour(3, { spend: 500_000, clicks: 1200, cpc: 417, ctr: 0.008, impressions: 150_000 }),
      hour(20, { spend: 3_000_000, clicks: 360, cpc: 8_333, ctr: 0.0005, impressions: 780_000 }),
      hour(21, { spend: 2_800_000, clicks: 340, cpc: 8_235, ctr: 0.0005, impressions: 700_000 }),
      hour(22, { spend: 2_400_000, clicks: 280, cpc: 8_571, ctr: 0.0005, impressions: 610_000 }),
    ];
    const d = day('2026-07-19', hours);
    const html = renderHourlyReportHtml(model({ days: [d], focus: d, totalHours: hours.length }));

    expect(html).not.toMatch(/broadly stable/i);
    // And it should name the inversion, since spend sits in the costly hours.
    expect(html).toMatch(/expensive hours/i);
  });

  it('renders every ingested day in the appendix', () => {
    const a = day('2026-07-18', [hour(10)]);
    const b = day('2026-07-19', [hour(11)]);
    const html = renderHourlyReportHtml(model({ days: [a, b], focus: b, totalHours: 2 }));
    expect(html.match(/class="appendix-day"/g)).toHaveLength(2);
  });
});
