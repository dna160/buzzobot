import { describe, expect, it } from 'vitest';
import { NorthStar } from '@tempo/core';
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
  northStar: NorthStar.Vtr,
};

const hour = (h: number, over: Partial<HourPoint> = {}): HourPoint => ({
  hour: h,
  spend: 1_000_000,
  impressions: 200_000,
  clicks: 500,
  reach: 120_000,
  videoViews: 5_000,
  videoWatched6s: 50_000,
  engagedView15s: 20_000,
  engagements: 100,
  vtr6s: 50_000 / 200_000,
  vtr15s: 20_000 / 200_000,
  frequency: 200_000 / 120_000,
  ctr: 500 / 200_000,
  cpc: 2_000,
  cpm: 5_000,
  cpv: 200,
  conversions: 0,
  conversionValue: 0,
  cpa: null,
  conversionRate: null,
  roas: null,
  ...over,
});

const totals = (over: Partial<Totals> = {}): Totals => ({
  spend: 2_000_000,
  impressions: 400_000,
  clicks: 1_000,
  reach: 240_000,
  videoViews: 10_000,
  videoWatched6s: 100_000,
  engagedView15s: 40_000,
  engagements: 200,
  vtr6s: 100_000 / 400_000,
  vtr15s: 40_000 / 400_000,
  frequency: 400_000 / 240_000,
  ctr: 0.0025,
  cpc: 2_000,
  cpm: 5_000,
  cpv: 200,
  conversions: 0,
  conversionValue: 0,
  cpa: null,
  conversionRate: null,
  roas: null,
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
    focusCampaigns: [],
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
    // Silence would be worse than absence — the reader must be told why. For an
    // offline-purchase brand that reason is structural: TikTok never sees the
    // sale, so conversions/ROAS cannot exist (not merely a missing column).
    expect(html).toMatch(/can never carry conversions or ROAS/i);
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

  it('names reach bought in low-VTR hours as the risk, not cost per click', () => {
    // The busiest-impression hour (20:00) views far worse than the best hour
    // (08:00). For a view-goal brand that is the core risk — reach bought where
    // the ad is least watched — and it must lead on VTR, never cost per click.
    const hours = [
      hour(8, { impressions: 150_000, videoWatched6s: 90_000, engagedView15s: 45_000, vtr6s: 0.6, vtr15s: 0.3 }),
      hour(20, { impressions: 800_000, videoWatched6s: 160_000, engagedView15s: 64_000, vtr6s: 0.2, vtr15s: 0.08 }),
    ];
    const d = day('2026-07-19', hours);
    const html = renderHourlyReportHtml(model({ days: [d], focus: d, totalHours: hours.length }));

    // The risk register and the efficiency finding both name it in VTR terms.
    expect(html).toMatch(/least watched/i);
    expect(html).toMatch(/20:00/);
    // The recommendation must not be framed around cost per click.
    expect(html).not.toMatch(/cost per click|blended CPC/i);
  });

  it('renders every ingested day in the appendix', () => {
    const a = day('2026-07-18', [hour(10)]);
    const b = day('2026-07-19', [hour(11)]);
    const html = renderHourlyReportHtml(model({ days: [a, b], focus: b, totalHours: 2 }));
    expect(html.match(/class="appendix-day"/g)).toHaveLength(2);
  });
});

describe('risk register (Section 7)', () => {
  // A day whose money goes to the worst-viewing hours, with one campaign that
  // is both expensive and poorly watched and a clearly failing adgroup — the
  // shape the register is supposed to have something to say about.
  const spread = [
    hour(6, { spend: 200_000, impressions: 300_000, videoWatched6s: 180_000, engagedView15s: 90_000, vtr6s: 0.6, vtr15s: 0.3 }),
    hour(8, { spend: 250_000, impressions: 320_000, videoWatched6s: 185_000, engagedView15s: 92_000, vtr6s: 0.58, vtr15s: 0.29 }),
    hour(18, { spend: 2_500_000, impressions: 900_000, videoWatched6s: 200_000, engagedView15s: 70_000, vtr6s: 0.22, vtr15s: 0.078 }),
    hour(20, { spend: 3_000_000, impressions: 950_000, videoWatched6s: 210_000, engagedView15s: 72_000, vtr6s: 0.221, vtr15s: 0.076 }),
    hour(22, { spend: 2_800_000, impressions: 880_000, videoWatched6s: 195_000, engagedView15s: 68_000, vtr6s: 0.222, vtr15s: 0.077 }),
  ];

  const campaign = (
    id: string,
    name: string,
    t: Partial<Totals>,
    adgroups: Array<{ id: string; name: string; totals: Partial<Totals> }> = [],
  ) => ({
    id,
    name,
    objective: 'video_views',
    totals: totals(t),
    hours: [],
    adgroups: adgroups.map((a) => ({ ...a, totals: totals(a.totals), hours: [] })),
  });

  const rich = () => {
    const d = day('2026-07-19', spread);
    return model({
      days: [d],
      focus: d,
      totalHours: spread.length,
      windowTotals: totals({
        spend: 8_750_000,
        impressions: 3_350_000,
        reach: 1_400_000,
        videoWatched6s: 970_000,
        engagedView15s: 392_000,
        vtr6s: 970_000 / 3_350_000,
        vtr15s: 392_000 / 3_350_000,
        frequency: 3_350_000 / 1_400_000,
        cpm: 2_612,
      }),
      campaigns: [
        campaign('big', 'Heavy but weak', {
          impressions: 1_900_000,
          videoWatched6s: 456_000,
          vtr6s: 0.24,
          cpm: 3_400,
        }),
        campaign('good', 'Small but strong', {
          impressions: 1_000_000,
          videoWatched6s: 480_000,
          vtr6s: 0.48,
          cpm: 2_100,
        }),
        campaign('bad', 'Costly and unwatched', {
          impressions: 450_000,
          videoWatched6s: 45_000,
          vtr6s: 0.1,
          cpm: 6_900,
        }, [
          { id: 'ag1', name: 'Failing adgroup', totals: { impressions: 300_000, videoWatched6s: 21_000, vtr6s: 0.07 } },
          { id: 'ag2', name: 'Healthier adgroup', totals: { impressions: 150_000, videoWatched6s: 24_000, vtr6s: 0.16 } },
        ]),
      ],
    });
  };

  it('produces at least six actionable entries', () => {
    const risks = analyseHourly(rich()).risks;
    expect(risks.length).toBeGreaterThanOrEqual(6);
  });

  it('leads with the spend-versus-view misallocation', () => {
    // Money is concentrated in the evening hours that view worst, so the
    // allocation gap — not a generic caution — must open the register.
    const risks = analyseHourly(rich()).risks;
    expect(risks[0]!.risk).toMatch(/spend/i);
    expect(risks[0]!.severity).toBe('high');
  });

  it('never files the offline-purchase measurement gap as a risk', () => {
    // It is explained once as context in the data-quality section; as a risk it
    // is unactionable and displaces findings a team could act on this week.
    const analysis = analyseHourly(rich());
    for (const r of analysis.risks) {
      expect(`${r.risk} ${r.action}`).not.toMatch(/ROAS|conversion|konversi|brand-lift|sales-lift/i);
    }
    // …but the data-gap callout still carries the explanation.
    expect(analysis.dataGap.body).toMatch(/conversions|ROAS/i);
  });

  it('names the specific failing campaign and adgroup', () => {
    const text = analyseHourly(rich())
      .risks.map((r) => `${r.risk} ${r.action}`)
      .join(' ');
    expect(text).toMatch(/Costly and unwatched/);
    expect(text).toMatch(/Failing adgroup/);
  });

  it('assigns every entry a real owner and a distinct action', () => {
    for (const r of analyseHourly(rich()).risks) {
      expect(r.owner.length).toBeGreaterThan(2);
      expect(r.action).not.toBe(r.risk);
      expect(r.action).not.toBe(r.owner);
    }
  });
});
