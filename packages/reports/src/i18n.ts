import { formatDelta } from '@tempo/core';
import type { MetricKey } from '@tempo/core';
import type { Priority } from './insights.js';

/**
 * Report localization. All user-visible report copy — static labels *and*
 * the dynamically-composed narrative — lives here, keyed by locale, so adding
 * or adjusting a language is a data change, not a code change. Bahasa Indonesia
 * ('id') is the default; English ('en') is kept at parity.
 */
export type Locale = 'id' | 'en';

export const DEFAULT_LOCALE: Locale = 'id';

export const isLocale = (v: string | null | undefined): v is Locale => v === 'id' || v === 'en';

export interface RecCopy {
  title: string;
  detail: string;
}

export interface ReportCopy {
  locale: Locale;
  months: string[];
  /** Date order for a single day: day-first ("20 Jun 2026") vs month-first. */
  dayFirst: boolean;
  daysWord: string;
  generatedPrefix: string;
  reportSubtitle: string;
  cover: { period: string; preparedFor: string };
  sections: { summary: string; paid: string; organic: string; creative: string; risks: string; outlook: string };
  creativeSubtitle: string;
  chart: { paidTitle: string; organicTitle: string; spend: string; roas: string; views: string; engRate: string };
  table: {
    campaign: string; spend: string; ctr: string; conv: string; cpa: string; roas: string;
    content: string; views: string; eng: string; watch: string; shares: string;
  };
  objective: Record<string, string>;
  confidenceLabel: string;
  confidence: Record<'High' | 'Medium' | 'Low', string>;
  priority: Record<Priority, string>;
  metricLabel: Partial<Record<MetricKey, string>>;
  noRisks: string;
  basedOn: (days: number, surfaces: string) => string;
  surfacesJoin: (paid: boolean, organic: boolean) => string;

  // --- dynamic narrative ---
  trend: (delta: number | null) => string;
  efficiencyVerdict: (spendDelta: number | null, roasDelta: number | null) => string;
  headlinePaid: (a: { name: string; roas: string; spend: string; views: string }) => string;
  headlineOrganic: (a: { name: string; views: string; eng: string }) => string;
  execPaid: (a: { spend: string; trend: string; roas: string; conv: string }) => string;
  execOrganic: (a: { views: string; eng: string; followers?: string }) => string;
  execTopCampaign: (a: { name: string; roas: string; spend: string }) => string;
  paidEfficiency: (a: { spendTrend: string; roasTrend: string; cpaTrend: string; verdict: string }) => string;
  paidCampaignsCount: (a: { active: number; paused: number }) => string;
  organicViews: (a: { viewsTrend: string; engTrend: string }) => string;
  organicTopVideo: (a: { caption: string; views: string; eng: string }) => string;
  contentHighlight: (a: { caption: string; views: string; eng: string; watch: string }) => string;
  recScale: (a: { name: string; roas: string; spend: string }) => RecCopy;
  recReallocate: (a: { name: string; roas: string; spend: string }) => RecCopy;
  recRisingCpa: (a: { delta: string }) => RecCopy;
  recAmplify: (a: { caption: string; eng: string }) => RecCopy;
  recReviewPaused: (a: { name: string }) => RecCopy;
  outlook: { roasUp: string; roasDown: string; viewsUp: string; viewsDown: string; fallback: string };
}

const absDelta = (delta: number): string => formatDelta(delta).replace(/^[+-]/, '');

// --- Bahasa Indonesia (default) --------------------------------------------

const ID: ReportCopy = {
  locale: 'id',
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
  dayFirst: true,
  daysWord: 'hari',
  generatedPrefix: 'Dibuat',
  reportSubtitle: 'Laporan Kinerja TikTok',
  cover: { period: 'Periode laporan', preparedFor: 'Disiapkan untuk' },
  sections: {
    summary: 'Ringkasan Eksekutif',
    paid: 'Kinerja Berbayar',
    organic: 'Kinerja Organik',
    creative: 'Diagnosis Kreatif & Konten',
    risks: 'Risiko & Rencana Aksi Terprioritaskan',
    outlook: 'Outlook & Keyakinan',
  },
  creativeSubtitle: 'Konten organik berkinerja terbaik pada periode ini, berdasarkan jangkauan dan interaksi.',
  chart: {
    paidTitle: 'Belanja & ROAS Harian',
    organicTitle: 'Tayangan & Tingkat Interaksi Harian',
    spend: 'Belanja',
    roas: 'ROAS',
    views: 'Tayangan',
    engRate: 'Interaksi',
  },
  table: {
    campaign: 'Kampanye', spend: 'Belanja', ctr: 'CTR', conv: 'Konv.', cpa: 'CPA', roas: 'ROAS',
    content: 'Konten', views: 'Tayangan', eng: 'Interaksi', watch: 'Durasi', shares: 'Dibagikan',
  },
  objective: {
    web_conversions: 'Konversi', traffic: 'Trafik', video_views: 'Tayangan Video',
    lead_generation: 'Prospek', reach: 'Jangkauan', engagement: 'Interaksi',
    app_promotion: 'Aplikasi', product_sales: 'Penjualan',
  },
  confidenceLabel: 'Tingkat keyakinan analis',
  confidence: { High: 'Tinggi', Medium: 'Sedang', Low: 'Rendah' },
  priority: { high: 'Tinggi', medium: 'Sedang', low: 'Rendah' },
  metricLabel: {
    spend: 'Biaya', roas: 'ROAS', conversions: 'Konversi', cpa: 'CPA',
    views: 'Tayangan', engagementRate: 'Interaksi', newFollowers: 'Pengikut', avgWatchTimeSec: 'Durasi Tonton',
  },
  noRisks: 'Tidak ada risiko material yang teridentifikasi pada periode ini.',
  basedOn: (days, surfaces) => `Berdasarkan ${days} hari data pada permukaan ${surfaces}.`,
  surfacesJoin: (paid, organic) =>
    paid && organic ? 'berbayar + organik' : paid ? 'berbayar' : 'organik',

  trend: (delta) => {
    if (delta === null) return 'relatif stabil';
    if (Math.abs(delta) < 0.01) return 'relatif datar';
    return delta > 0 ? `naik ${absDelta(delta)}` : `turun ${absDelta(delta)}`;
  },
  efficiencyVerdict: (spendDelta, roasDelta) => {
    if (roasDelta !== null && roasDelta > 0.02) return 'efisiensi membaik';
    if (roasDelta !== null && roasDelta < -0.02) return 'efisiensi menurun dan perlu perhatian';
    if (spendDelta !== null && spendDelta > 0.1) return 'peningkatan skala menjaga efisiensi relatif stabil';
    return 'kinerja relatif stabil';
  },
  headlinePaid: (a) =>
    `${a.name} membukukan ROAS gabungan ${a.roas} atas belanja iklan ${a.spend}, dengan konten organik mencapai ${a.views} tayangan.`,
  headlineOrganic: (a) =>
    `Konten organik ${a.name} mencapai ${a.views} tayangan dengan tingkat interaksi ${a.eng}.`,
  execPaid: (a) =>
    `Kampanye berbayar menginvestasikan ${a.spend} (${a.trend} dibandingkan periode sebelumnya), menghasilkan ROAS ${a.roas} dan ${a.conv} konversi.`,
  execOrganic: (a) =>
    `Konten organik menghasilkan ${a.views} tayangan dengan tingkat interaksi ${a.eng}` +
    (a.followers ? `, menambah ${a.followers} pengikut baru.` : '.'),
  execTopCampaign: (a) =>
    `Kampanye berbayar terkuat adalah “${a.name}” dengan ROAS ${a.roas} atas belanja ${a.spend}.`,
  paidEfficiency: (a) =>
    `Belanja ${a.spendTrend} sementara ROAS ${a.roasTrend} dan CPA ${a.cpaTrend} dibandingkan periode sebelumnya — ${a.verdict}.`,
  paidCampaignsCount: (a) =>
    `${a.active} kampanye mendorong belanja pada periode ini` +
    (a.paused > 0 ? `; ${a.paused} lainnya dijeda atau tanpa belanja.` : '.'),
  organicViews: (a) =>
    `Tayangan ${a.viewsTrend} dan tingkat interaksi ${a.engTrend} dibandingkan periode sebelumnya.`,
  organicTopVideo: (a) =>
    `Konten teratas “${a.caption}” mencapai ${a.views} tayangan dengan interaksi ${a.eng}.`,
  contentHighlight: (a) =>
    `“${a.caption}” — ${a.views} tayangan, interaksi ${a.eng}, rata-rata durasi tonton ${a.watch}.`,
  recScale: (a) => ({
    title: `Tingkatkan “${a.name}”`,
    detail: `Dengan ROAS ${a.roas} atas ${a.spend}, kampanye ini punya ruang tumbuh. Naikkan anggaran 20–30% dan pantau pergerakan CPA.`,
  }),
  recReallocate: (a) => ({
    title: `Alihkan anggaran dari “${a.name}”`,
    detail: `ROAS ${a.roas} atas ${a.spend} berada di bawah target. Perbarui materi kreatif atau alihkan anggaran ke kampanye ber-ROAS lebih tinggi.`,
  }),
  recRisingCpa: (a) => ({
    title: 'Selidiki kenaikan biaya per akuisisi',
    detail: `CPA naik ${a.delta} dibandingkan periode sebelumnya. Perketat penargetan audiens dan rotasi materi kreatif yang mulai jenuh.`,
  }),
  recAmplify: (a) => ({
    title: 'Perkuat konten organik teratas dengan Spark Ads',
    detail: `“${a.caption}” memiliki tingkat interaksi tinggi (${a.eng}). Promosikan sebagai Spark Ad untuk memperluas jangkauan.`,
  }),
  recReviewPaused: (a) => ({
    title: 'Tinjau kampanye yang dijeda',
    detail: `“${a.name}” tidak membukukan belanja pada periode ini. Aktifkan kembali dengan materi baru atau arsipkan agar lebih rapi.`,
  }),
  outlook: {
    roasUp: 'Efisiensi berbayar bergerak positif; menjaga kecepatan produksi kreatif akan mempertahankan ROAS pada periode berikutnya.',
    roasDown: 'Efisiensi berbayar menurun pada periode ini; rencana aksi di atas menargetkan pemulihan ROAS pada siklus berikutnya.',
    viewsUp: 'Momentum organik positif — perkuat format yang mendorong konten berkinerja terbaik.',
    viewsDown: 'Jangkauan organik melemah; meningkatkan frekuensi unggahan pada format terbukti akan membangun kembali momentum.',
    fallback: 'Terus pantau kinerja dan tinjau kembali rencana ini pada siklus pelaporan berikutnya.',
  },
};

// --- English (parity) -------------------------------------------------------

const EN: ReportCopy = {
  locale: 'en',
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  dayFirst: false,
  daysWord: 'days',
  generatedPrefix: 'Generated',
  reportSubtitle: 'TikTok Performance Report',
  cover: { period: 'Reporting period', preparedFor: 'Prepared for' },
  sections: {
    summary: 'Executive Summary',
    paid: 'Paid Performance',
    organic: 'Organic Performance',
    creative: 'Creative & Content Diagnosis',
    risks: 'Risks & Prioritized Action Plan',
    outlook: 'Outlook & Confidence',
  },
  creativeSubtitle: 'Highest-performing organic content this period, by reach and engagement.',
  chart: {
    paidTitle: 'Daily spend & ROAS',
    organicTitle: 'Daily views & engagement rate',
    spend: 'Spend',
    roas: 'ROAS',
    views: 'Views',
    engRate: 'Eng. rate',
  },
  table: {
    campaign: 'Campaign', spend: 'Spend', ctr: 'CTR', conv: 'Conv.', cpa: 'CPA', roas: 'ROAS',
    content: 'Content', views: 'Views', eng: 'Eng.', watch: 'Watch', shares: 'Shares',
  },
  objective: {
    web_conversions: 'Conversions', traffic: 'Traffic', video_views: 'Video Views',
    lead_generation: 'Lead Gen', reach: 'Reach', engagement: 'Engagement',
    app_promotion: 'App', product_sales: 'Sales',
  },
  confidenceLabel: 'Analyst confidence',
  confidence: { High: 'High', Medium: 'Medium', Low: 'Low' },
  priority: { high: 'high', medium: 'medium', low: 'low' },
  metricLabel: {},
  noRisks: 'No material risks identified this period.',
  basedOn: (days, surfaces) => `Based on ${days} days of data across ${surfaces} surfaces.`,
  surfacesJoin: (paid, organic) =>
    [paid ? 'paid' : null, organic ? 'organic' : null].filter(Boolean).join(' + '),

  trend: (delta) => {
    if (delta === null) return 'held steady';
    if (Math.abs(delta) < 0.01) return 'held roughly flat';
    return delta > 0 ? `rose ${formatDelta(delta)}` : `fell ${formatDelta(delta)}`;
  },
  efficiencyVerdict: (spendDelta, roasDelta) => {
    if (roasDelta !== null && roasDelta > 0.02) return 'efficiency improved';
    if (roasDelta !== null && roasDelta < -0.02) return 'efficiency softened and warrants attention';
    if (spendDelta !== null && spendDelta > 0.1) return 'scaling held efficiency roughly stable';
    return 'performance was broadly stable';
  },
  headlinePaid: (a) =>
    `${a.name} delivered a ${a.roas} blended ROAS on ${a.spend} of paid spend, with organic reaching ${a.views} views.`,
  headlineOrganic: (a) =>
    `${a.name} organic content reached ${a.views} views at a ${a.eng} engagement rate.`,
  execPaid: (a) =>
    `Paid campaigns invested ${a.spend} (${a.trend} vs. the prior period), returning a ${a.roas} ROAS and ${a.conv} conversions.`,
  execOrganic: (a) =>
    `Organic content generated ${a.views} views at a ${a.eng} engagement rate` +
    (a.followers ? `, adding ${a.followers} net new followers.` : '.'),
  execTopCampaign: (a) =>
    `The strongest paid performer was “${a.name}” at a ${a.roas} ROAS on ${a.spend} spend.`,
  paidEfficiency: (a) =>
    `Spend ${a.spendTrend} while ROAS ${a.roasTrend} and CPA ${a.cpaTrend} period-over-period — ${a.verdict}.`,
  paidCampaignsCount: (a) =>
    `${a.active} campaign${a.active === 1 ? '' : 's'} drove spend this period` +
    (a.paused > 0 ? `; ${a.paused} remained paused or unspent.` : '.'),
  organicViews: (a) =>
    `Views ${a.viewsTrend} and engagement rate ${a.engTrend} versus the prior period.`,
  organicTopVideo: (a) =>
    `Top content “${a.caption}” reached ${a.views} views at ${a.eng} engagement.`,
  contentHighlight: (a) =>
    `“${a.caption}” — ${a.views} views, ${a.eng} engagement, ${a.watch} avg watch.`,
  recScale: (a) => ({
    title: `Scale “${a.name}”`,
    detail: `At a ${a.roas} ROAS on ${a.spend}, this campaign has headroom. Increase budget 20–30% and monitor for CPA drift.`,
  }),
  recReallocate: (a) => ({
    title: `Reallocate budget away from “${a.name}”`,
    detail: `A ${a.roas} ROAS on ${a.spend} is below target. Refresh creative or shift budget to higher-ROAS campaigns.`,
  }),
  recRisingCpa: (a) => ({
    title: 'Investigate rising cost per acquisition',
    detail: `CPA is up ${a.delta} period-over-period. Tighten audience targeting and rotate fatigued creatives.`,
  }),
  recAmplify: (a) => ({
    title: 'Amplify top organic content with Spark Ads',
    detail: `“${a.caption}” is over-indexing on engagement (${a.eng}). Promote it as a Spark Ad to extend reach.`,
  }),
  recReviewPaused: (a) => ({
    title: 'Review paused campaigns',
    detail: `“${a.name}” recorded no spend this period. Reactivate with fresh creative or archive to reduce clutter.`,
  }),
  outlook: {
    roasUp: 'Paid efficiency is trending favorably; maintaining creative velocity should sustain ROAS into next period.',
    roasDown: 'Paid efficiency dipped this period; the action plan above targets a recovery in ROAS next cycle.',
    viewsUp: 'Organic momentum is positive — lean into the formats driving the top-performing content.',
    viewsDown: 'Organic reach softened; increasing posting cadence around proven formats should rebuild momentum.',
    fallback: 'Continue monitoring performance and revisit the plan next reporting cycle.',
  },
};

const COPY: Record<Locale, ReportCopy> = { id: ID, en: EN };

export const getCopy = (locale: Locale = DEFAULT_LOCALE): ReportCopy => COPY[locale] ?? COPY[DEFAULT_LOCALE];
