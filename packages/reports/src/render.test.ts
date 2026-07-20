import { describe, expect, it } from 'vitest';
import type { DashboardData, KpiCard } from '@tempo/db';
import { buildInsights } from './insights.js';
import { renderReportHtml } from './render.js';
import { getCopy } from './i18n.js';
import type { ReportModel } from './model.js';

const idCopy = getCopy('id');
const enCopy = getCopy('en');

const kpi = (over: Partial<KpiCard> & Pick<KpiCard, 'key'>): KpiCard => ({
  key: over.key,
  label: over.label ?? over.key,
  value: over.value ?? 0,
  delta: over.delta ?? 0,
  goodDirection: over.goodDirection ?? 'up',
  sparkline: over.sparkline ?? [1, 2, 3],
});

const dashboard: DashboardData = {
  client: {
    id: 'c1',
    name: 'Aurora Skincare',
    slug: 'aurora-skincare',
    brandColor: '#1FD8C7',
    currency: 'USD',
    timezone: 'UTC',
  },
  range: { start: '2026-06-20', end: '2026-07-19' },
  paidKpis: [
    kpi({ key: 'spend', value: 34400, delta: 0.044, goodDirection: 'neutral' }),
    kpi({ key: 'roas', value: 3.43, delta: -0.005 }),
    kpi({ key: 'conversions', value: 2000, delta: 0.05 }),
    kpi({ key: 'cpa', value: 17.47, delta: 0.15, goodDirection: 'down' }),
  ],
  organicKpis: [
    kpi({ key: 'views', value: 1_100_000, delta: 0.3 }),
    kpi({ key: 'engagementRate', value: 0.096, delta: 0.14 }),
    kpi({ key: 'newFollowers', value: 6800, delta: 0.2 }),
    kpi({ key: 'avgWatchTimeSec', value: 20.9, delta: 0.4 }),
  ],
  timeseries: [
    { date: '2026-07-18', spend: 1000, roas: 3.4, conversions: 60, clicks: 1800, views: 40000, engagementRate: 0.09, newFollowers: 70 },
    { date: '2026-07-19', spend: 1050, roas: 3.5, conversions: 62, clicks: 1850, views: 42000, engagementRate: 0.1, newFollowers: 72 },
  ],
  campaigns: [
    { id: 'k1', name: 'Q3 Prospecting — Conversions', objective: 'web_conversions', status: 'active', spend: 17100, impressions: 1_000_000, clicks: 20000, ctr: 0.02, conversions: 900, cpa: 19, roas: 4.33 },
    { id: 'k2', name: 'Brand Awareness — Video Views', objective: 'video_views', status: 'active', spend: 6064, impressions: 800_000, clicks: 9000, ctr: 0.011, conversions: 120, cpa: 50, roas: 1.91 },
    { id: 'k3', name: 'Lead Gen — Newsletter', objective: 'lead_generation', status: 'paused', spend: 0, impressions: 0, clicks: 0, ctr: 0, conversions: 0, cpa: 0, roas: 0 },
  ],
  topVideos: [
    { id: 'v1', caption: 'Replying to @user this is how we do it', shareUrl: null, publishedAt: '2026-07-10', views: 247000, likes: 20000, engagementRate: 0.09, avgWatchTimeSec: 28.9, shares: 1800 },
  ],
  hasPaid: true,
  hasOrganic: true,
};

describe('buildInsights (English)', () => {
  it('produces a headline, summary and prioritized recommendations', () => {
    const insights = buildInsights(dashboard, enCopy);
    expect(insights.headline).toContain('Aurora Skincare');
    expect(insights.executiveSummary.length).toBeGreaterThan(0);
    // Scales the 4.33x winner and flags the 1.91x laggard.
    const titles = insights.recommendations.map((r) => r.title);
    expect(titles.some((t) => t.includes('Scale'))).toBe(true);
    expect(titles.some((t) => t.includes('Reallocate'))).toBe(true);
    // Rising CPA (+15%) triggers a medium-priority recommendation.
    expect(titles.some((t) => t.toLowerCase().includes('cost per acquisition'))).toBe(true);
  });
});

describe('buildInsights (Bahasa Indonesia, default)', () => {
  it('produces Indonesian narrative and recommendations', () => {
    const insights = buildInsights(dashboard, idCopy);
    expect(insights.headline).toContain('Aurora Skincare');
    expect(insights.headline).toContain('ROAS gabungan');
    const titles = insights.recommendations.map((r) => r.title);
    expect(titles.some((t) => t.startsWith('Tingkatkan'))).toBe(true);
    expect(titles.some((t) => t.startsWith('Alihkan anggaran'))).toBe(true);
  });
});

const modelWith = (copy: typeof idCopy): ReportModel => ({
  locale: copy.locale,
  copy,
  client: dashboard.client,
  range: dashboard.range,
  previousRange: { start: '2026-05-21', end: '2026-06-19' },
  periodLabel: '20 Jun – 19 Jul 2026 (30 hari)',
  generatedLabel: 'Dibuat 20 Jul 2026 · 10:00 UTC',
  dashboard,
  insights: buildInsights(dashboard, copy),
});

describe('renderReportHtml', () => {
  it('renders a self-contained Indonesian document with the key sections', () => {
    const html = renderReportHtml(modelWith(idCopy));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="id">');
    expect(html).toContain('Ringkasan Eksekutif');
    expect(html).toContain('Risiko &amp; Rencana Aksi Terprioritaskan');
    expect(html).toContain('Laporan Kinerja TikTok');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('http://');
    expect(html).toContain('<svg');
  });

  it('renders an English document when that locale is used', () => {
    const html = renderReportHtml(modelWith(enCopy));
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Executive Summary');
  });
});
