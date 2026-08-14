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

/**
 * Copy for the intraday report. Kept as its own pack because that report has a
 * different shape from the daily one: no ROAS/conversions/organic (an Ads
 * export carries none of them), and an hour-of-day axis throughout.
 */
export interface HourlyCopy {
  subtitle: string;
  cover: { period: string; preparedFor: string };
  sections: {
    summary: string;
    pattern: string;
    efficiency: string;
    campaigns: string;
    adgroups: string;
    quality: string;
    risks: string;
    outlook: string;
    appendix: string;
  };
  stat: {
    spend: string;
    impressions: string;
    reach: string;
    frequency: string;
    vtr6s: string;
    vtr15s: string;
    clicks: string;
    ctr: string;
    cpc: string;
    cpm: string;
    hours: string;
  };
  chart: {
    pacingTitle: string;
    deliveryTitle: string;
    efficiencyTitle: string;
    vtrTitle: string;
    delivered: string;
    evenPace: string;
    impressions: string;
    vtr6s: string;
    vtr15s: string;
    clicks: string;
    cpm: string;
    ctr: string;
  };
  table: {
    hour: string;
    spend: string;
    impressions: string;
    clicks: string;
    ctr: string;
    cpc: string;
    cpm: string;
    vtr6s: string;
    vtr15s: string;
    campaign: string;
    total: string;
  };
  coverageTitle: string;
  coverage: {
    aggregated: (a: { hours: string }) => string;
    incomplete: (a: { last: string; date: string }) => string;
    noRevenue: string;
    paidOnly: string;
    hoursCounted: (a: { hours: number; days: number }) => string;
  };
  headline: (a: { name: string; spend: string; hours: number; days: number }) => string;
  peakTrough: (a: { peak: string; peakSpend: string; trough: string; troughSpend: string }) => string;
  pacingNarrative: (a: { half: string; share: string }) => string;
  ctrSwing: (a: { best: string; bestCtr: string; worst: string; worstCtr: string }) => string;
  cpcSwing: (a: { best: string; bestCpc: string; worst: string; worstCpc: string }) => string;
  topCampaign: (a: { name: string; spend: string; share: string }) => string;
  adgroupOutlier: (a: { name: string; cpc: string; peerCpc: string; multiple: string }) => string;
  dayCompare: (a: { date: string; prev: string; hours: number; spend: string }) => string;
  appendixNote: string;
  appendixDaySub: (a: { first: string; last: string; hours: number }) => string;
  notReported: string;

  // --- narrative report scaffolding ---
  ownerLabel: string;
  owners: { media: string; creative: string; data: string };
  severity: Record<'high' | 'medium' | 'low', string>;
  confidenceLabel: string;
  confidence: Record<'High' | 'Medium' | 'Low', string>;
  rankLabel: { cheapest: string; dearest: string };
  lowVolumeNote: (a: { min: number }) => string;
  provenance: {
    llm: (a: { model: string; provider: string }) => string;
    deterministic: string;
    fallback: (a: { reason: string }) => string;
  };
  calloutTitles: {
    daypart: string;
    efficiency: string;
    mix: string;
    adgroup: string;
    dataGap: string;
  };
  /**
   * The deterministic engine's conversion-goal path (Shop / App Install
   * clients). Shared by both, parameterized by an `outcome` word ("conversion"
   * or "install", kept in English even in the Indonesian report — the same
   * convention as VTR/CPM/CPC — so one set of templates serves both verticals.
   */
  conversion: {
    calloutTitles: { efficiency: string; adgroup: string };
    narrative: {
      summary: (a: { name: string; days: number; hours: number; clicks: string; conversions: string; conversionRate: string; outcome: string }) => string;
      efficiency: (a: { best: string; bestRate: string; weak: string; weakRate: string; outcome: string }) => string;
      adgroup: (a: { count: number; outcome: string }) => string;
    };
    findings: {
      byHour: (a: { best: string; bestRate: string; weak: string; weakRate: string; multiple: string; outcome: string }) => string;
      stable: (a: { best: string; weak: string; spread: string; outcome: string }) => string;
      adgroupGap: (a: { name: string; rate: string; peerRate: string; multiple: string; outcome: string }) => string;
      adgroupEven: (a: { outcome: string }) => string;
    };
    risks: {
      spendMisallocation: {
        risk: (a: { share: string; spendWeighted: string; bestCase: string; outcome: string }) => string;
        action: (a: { best: string; weak: string; outcome: string }) => string;
      };
      lowHours: {
        risk: (a: { peak: string; peakRate: string; best: string; bestRate: string; outcome: string }) => string;
        action: (a: { peak: string; best: string; outcome: string }) => string;
      };
      weakFunnel: {
        risk: (a: { ctr: string; rate: string; outcome: string }) => string;
        action: (a: { outcome: string }) => string;
      };
      lowCampaign: {
        risk: (a: { name: string; share: string; rate: string; outcome: string }) => string;
        action: (a: { name: string; outcome: string }) => string;
      };
      costly: {
        risk: (a: { name: string; cpa: string; avgCpa: string; outcome: string }) => string;
        action: (a: { name: string; outcome: string }) => string;
      };
      lowAdgroup: {
        risk: (a: { name: string; rate: string; peerRate: string; outcome: string }) => string;
        action: (a: { name: string; outcome: string }) => string;
      };
      lowAdgroupAccount: {
        risk: (a: { name: string; rate: string; avgRate: string; clicks: string; outcome: string }) => string;
        action: (a: { name: string; outcome: string }) => string;
      };
      decline: {
        risk: (a: { rate: string; basis: string; outcome: string }) => string;
        action: (a: { outcome: string }) => string;
      };
    };
  };
  /**
   * Section-level analyst prose. The efficiency and adgroup sections read on
   * view-through rate (this brand's KPI), never cost-per-click — matching the
   * fact sheet and the LLM narrative, so the deterministic fallback is on-brand.
   */
  narrative: {
    summary: (a: { name: string; days: number; hours: number; impressions: string; vtr6s: string; vtr15s: string }) => string;
    daypart: (a: { peak: string; trough: string; multiple: string; share: string }) => string;
    efficiency: (a: { best: string; bestVtr: string; weak: string; weakVtr: string; retention: string }) => string;
    mix: (a: { name: string; share: string; count: number }) => string;
    adgroup: (a: { count: number }) => string;
  };
  /** Callout bodies. */
  findings: {
    daypart: (a: { peak: string; peakSpend: string; trough: string; troughSpend: string; multiple: string }) => string;
    vtrByHour: (a: { best: string; bestVtr: string; weak: string; weakVtr: string; multiple: string }) => string;
    vtrStable: (a: { best: string; weak: string; spread: string }) => string;
    mix: (a: { name: string; share: string }) => string;
    adgroupVtr: (a: { name: string; vtr: string; peerVtr: string; multiple: string }) => string;
    adgroupEven: string;
    /** VTR client: why this export can never carry conversions or ROAS. */
    dataGap: string;
    /** Shop client: conversions are real; ROAS depends on the source reporting a value. */
    dataGapShop: string;
    /** App Install client: why this export can never carry ROAS or a revenue figure. */
    dataGapAppInstall: string;
  };
  risks: {
    /** Reach bought in hours that view poorly — the core FMCG media risk. */
    lowVtrHours: { risk: (a: { peak: string; peakVtr: string; best: string; bestVtr: string }) => string; action: (a: { peak: string; best: string }) => string };
    /** The creative hooks but does not hold (weak 6s→15s retention). */
    retention: { risk: (a: { retention: string }) => string; action: string };
    /** A campaign carrying real reach but viewing below the account average. */
    lowVtrCampaign: { risk: (a: { name: string; share: string; vtr: string }) => string; action: (a: { name: string }) => string };
    concentration: { risk: (a: { name: string; share: string }) => string; action: string };
    /** Budget placed with no regard to which hours actually get watched. */
    spendMisallocation: {
      risk: (a: { share: string; spendWeighted: string; bestCase: string }) => string;
      action: (a: { best: string; weak: string }) => string;
    };
    /** The same people re-hit instead of new reach widened. */
    overFrequency: { risk: (a: { frequency: string }) => string; action: string };
    /** An adgroup viewing far below its siblings on the same campaign. */
    lowVtrAdgroup: {
      risk: (a: { name: string; vtr: string; peerVtr: string }) => string;
      action: (a: { name: string }) => string;
    };
    /** An adgroup viewing far below the account as a whole. */
    lowVtrAdgroupAccount: {
      risk: (a: { name: string; vtr: string; avgVtr: string; impressions: string }) => string;
      action: (a: { name: string }) => string;
    };
    /** View quality falling against the like-for-like previous day. */
    vtrDecline: {
      risk: (a: { vtr6s: string; vtr15s: string; basis: string }) => string;
      action: string;
    };
    /** The best-viewing campaign starved while a weaker one takes the reach. */
    underweightedWinner: {
      risk: (a: {
        best: string;
        bestVtr: string;
        bestShare: string;
        heavy: string;
        heavyVtr: string;
        heavyShare: string;
      }) => string;
      action: (a: { best: string; heavy: string }) => string;
    };
    /** Reach that is both expensive (CPM) and poorly watched (VTR). */
    costlyReach: {
      risk: (a: { name: string; cpm: string; vtr: string; avgCpm: string }) => string;
      action: (a: { name: string }) => string;
    };
    coverage: { risk: (a: { date: string; last: string }) => string; action: string };
  };
  outlook: {
    intro: (a: { hours: number; days: number }) => string;
    daypartProjection: (a: { window: string; share: string }) => string;
    reallocation: (a: { best: string }) => string;
    caveat: string;
  };
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
  hourly: HourlyCopy;
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
  hourly: {
    subtitle: 'Laporan Kinerja TikTok Per Jam',
    cover: { period: 'Periode data', preparedFor: 'Disiapkan untuk' },
    sections: {
      summary: 'Ringkasan Eksekutif & Tren Harian',
      pattern: 'Pola Intraday & Laju Belanja',
      efficiency: 'Efisiensi Per Jam & Diagnosis Biaya',
      campaigns: 'Kinerja Kampanye & Konsentrasi Belanja',
      adgroups: 'Diagnosis Grup Iklan',
      quality: 'Cakupan & Kualitas Data',
      risks: 'Risiko Utama & Rencana Aksi Terprioritaskan',
      outlook: 'Outlook & Catatan Confidence',
      appendix: 'Lampiran: Rincian Per Jam',
    },
    // Metric, chart, and table labels are kept in English even in the Indonesian
    // report: these are standard ad-platform terms Indonesian marketers read in
    // English, and the client asked for them that way. The narrative prose,
    // section titles, and callouts below stay in Bahasa Indonesia.
    stat: {
      spend: 'Spend', impressions: 'Impressions', reach: 'Reach', frequency: 'Frequency',
      vtr6s: 'VTR 6s', vtr15s: 'VTR 15s', clicks: 'Clicks',
      ctr: 'CTR', cpc: 'CPC', cpm: 'CPM', hours: 'Hours Recorded',
    },
    chart: {
      pacingTitle: 'Cumulative Spending',
      deliveryTitle: 'Impressions & VTR by Hour',
      efficiencyTitle: 'Efficiency by Hour',
      vtrTitle: 'View-Through Rate by Hour',
      delivered: 'Delivered', evenPace: 'Even pace',
      impressions: 'Impressions', vtr6s: 'VTR 6s', vtr15s: 'VTR 15s',
      clicks: 'Clicks', cpm: 'CPM', ctr: 'CTR',
    },
    table: {
      hour: 'Hour', spend: 'Spend', impressions: 'Impressions', clicks: 'Clicks',
      ctr: 'CTR', cpc: 'CPC', cpm: 'CPM', vtr6s: 'VTR 6s', vtr15s: 'VTR 15s',
      campaign: 'Campaign', total: 'Total',
    },
    coverageTitle: 'Cakupan data',
    coverage: {
      aggregated: (a) =>
        `${a.hours} memuat seluruh akumulasi sejak tengah malam, bukan satu jam tersendiri. Jam tersebut dikecualikan dari seluruh grafik dan perbandingan per jam, tetapi tetap dihitung dalam total harian.`,
      incomplete: (a) =>
        `Data ${a.date} berhenti setelah ${a.last}; jam berikutnya belum tersinkronisasi dan ditampilkan sebagai kosong, bukan nol.`,
      noRevenue:
        'Ekspor ini tidak memuat kolom pendapatan atau nilai konversi, sehingga ROAS dan CPA tidak dapat dihitung dan tidak dilaporkan.',
      paidOnly:
        'Sumber data adalah ekspor TikTok Ads (berbayar). Kinerja konten organik tidak termasuk dalam laporan ini.',
      hoursCounted: (a) => `Laporan ini mencakup ${a.hours} jam penuh pada ${a.days} hari.`,
    },
    headline: (a) =>
      `${a.name} membelanjakan ${a.spend} pada ${a.hours} jam penuh selama ${a.days} hari, dengan pola intraday yang konsisten.`,
    peakTrough: (a) =>
      `Belanja memuncak pada ${a.peak} (${a.peakSpend}) dan terendah pada ${a.trough} (${a.troughSpend}).`,
    pacingNarrative: (a) =>
      `Paruh ${a.half} hari menyerap ${a.share} dari total belanja harian.`,
    ctrSwing: (a) =>
      `CTR tertinggi pada ${a.best} (${a.bestCtr}) dan terendah pada ${a.worst} (${a.worstCtr}).`,
    cpcSwing: (a) =>
      `Biaya per klik termurah pada ${a.best} (${a.bestCpc}) dan termahal pada ${a.worst} (${a.worstCpc}).`,
    topCampaign: (a) => `Kampanye terbesar adalah “${a.name}” dengan ${a.spend} (${a.share} dari total belanja).`,
    adgroupOutlier: (a) =>
      `Grup iklan “${a.name}” memiliki CPC ${a.cpc}, sekitar ${a.multiple} lebih mahal dibandingkan rata-rata grup lain (${a.peerCpc}).`,
    dayCompare: (a) =>
      `Pada ${a.date}, belanja ${a.spend} dibandingkan ${a.prev} pada jam yang sama (${a.hours} jam yang bersesuaian).`,
    appendixNote:
      'Setiap baris adalah satu jam penuh. Jam yang memuat akumulasi sejak tengah malam tidak disertakan. Rasio dihitung dari total, bukan rata-rata antar jam.',
    appendixDaySub: (a) => `${a.first} – ${a.last} · ${a.hours} jam penuh`,
    notReported: 'tidak tersedia',

    ownerLabel: 'Penanggung jawab',
    owners: { media: 'Media Buying', creative: 'Kreatif', data: 'Data / Operasional' },
    severity: { high: 'tinggi', medium: 'sedang', low: 'rendah' },
    confidenceLabel: 'Tingkat keyakinan analis',
    confidence: { High: 'Tinggi', Medium: 'Sedang', Low: 'Rendah' },
    rankLabel: { cheapest: 'termurah', dearest: 'termahal' },
    lowVolumeNote: (a) => `* VTR dari impresi di bawah ${a.min} tidak stabil dan tidak dijadikan dasar rekomendasi.`,
    provenance: {
      llm: (a) => `Analisis naratif disusun oleh model ${a.model} (${a.provider}) dari angka yang telah dihitung sistem. Seluruh angka diverifikasi terhadap data sumber.`,
      deterministic: 'Analisis naratif dihasilkan secara deterministik dari data, tanpa model bahasa.',
      fallback: (a) => `Analisis naratif dihasilkan secara deterministik karena pembuatan oleh model gagal (${a.reason}).`,
    },
    calloutTitles: {
      daypart: 'Pola Dayparting',
      efficiency: 'Efisiensi Per Jam',
      mix: 'Konsentrasi Belanja',
      adgroup: 'Diagnosis Grup Iklan',
      dataGap: 'Kesenjangan Data',
    },
    narrative: {
      summary: (a) =>
        `Laporan ini menganalisis performa tayangan iklan TikTok ${a.name} pada tingkat per jam selama ${a.days} hari (${a.hours} jam penuh). Sebagai merek FMCG, fokusnya adalah efisiensi menonton: ${a.impressions} tayangan menghasilkan view-through rate 6 detik ${a.vtr6s} dan 15 detik ${a.vtr15s}. Analisis per jam memperlihatkan pada jam mana tayangan ditonton paling efisien.`,
      daypart: (a) =>
        `Belanja terkonsentrasi pada ${a.peak} dan terendah pada ${a.trough}, dengan selisih ${a.multiple}. Paruh yang lebih padat menyerap ${a.share} dari total belanja harian, sehingga penyesuaian jadwal tayang berpotensi memindahkan impresi ke jam yang ditonton lebih baik.`,
      efficiency: (a) =>
        `VTR 6 detik tertinggi terjadi pada ${a.best} (${a.bestVtr}) dan terendah pada ${a.weak} (${a.weakVtr}) — impresi yang sama lebih bernilai pada sebagian jam. Dari penonton yang mencapai 6 detik, ${a.retention} berlanjut ke 15 detik, menunjukkan sejauh mana kreatif mampu menahan perhatian.`,
      mix: (a) =>
        `Impresi terkonsentrasi pada “${a.name}” yang menyerap ${a.share} dari total, dari ${a.count} kampanye aktif. Konsentrasi ini menyederhanakan pengelolaan namun meningkatkan ketergantungan pada satu kampanye.`,
      adgroup: (a) =>
        `Terdapat ${a.count} grup iklan aktif. Perbandingan VTR antar grup dalam satu kampanye memperlihatkan selisih efisiensi menonton yang dapat ditindaklanjuti.`,
    },
    findings: {
      daypart: (a) =>
        `Belanja memuncak pada ${a.peak} (${a.peakSpend}) dan terendah pada ${a.trough} (${a.troughSpend}) — selisih ${a.multiple}.`,
      vtrByHour: (a) =>
        `VTR 6 detik terkuat pada ${a.best} (${a.bestVtr}) dan terlemah pada ${a.weak} (${a.weakVtr}), selisih ${a.multiple}. Impresi yang jatuh pada jam ber-VTR rendah membeli jangkauan yang paling sedikit ditonton.`,
      vtrStable: (a) =>
        `VTR 6 detik relatif merata sepanjang hari (rentang ${a.spread}, dari ${a.weak} ke ${a.best}), sehingga tidak ada jam yang jelas lebih efisien untuk menonton.`,
      mix: (a) => `“${a.name}” menyerap ${a.share} dari seluruh impresi periode ini.`,
      adgroupVtr: (a) =>
        `Grup iklan “${a.name}” hanya mencapai VTR 6 detik ${a.vtr}, sekitar ${a.multiple} di bawah rata-rata grup sejenis (${a.peerVtr}).`,
      adgroupEven: 'VTR antar grup iklan relatif merata; tidak ada grup yang jelas gagal menahan perhatian.',
      dataGap:
        'Karena pembelian terjadi secara offline di minimarket, tidak ada jalur beli di platform sehingga ekspor ini tidak akan pernah memuat konversi atau ROAS. Ini bersifat struktural, bukan kolom data yang hilang. Seluruh penilaian berbasis efisiensi menonton (VTR) dan biaya jangkauan (CPM).',
      dataGapShop:
        'Akun ini berjualan melalui TikTok Shop, sehingga konversi di sini adalah pembelian nyata di platform, bukan estimasi. ROAS hanya ditampilkan pada periode yang juga melaporkan nilai pembelian; jika tidak, laporan ini menyatakan konversi terjadi tanpa mengarang angka pendapatan.',
      dataGapAppInstall:
        'Tujuan akun ini adalah instalasi aplikasi, bukan penjualan — TikTok tidak memiliki peristiwa pembelian atau pendapatan untuk diatribusikan di sini, sehingga ekspor ini tidak akan pernah memuat ROAS atau angka pendapatan. Seluruh penilaian berbasis jumlah instalasi dan biaya per instalasi (CPI).',
    },
    risks: {
      lowVtrHours: {
        risk: (a) =>
          `Impresi terbesar jatuh pada ${a.peak} yang hanya ber-VTR 6 detik ${a.peakVtr}, di bawah jam terbaik ${a.best} (${a.bestVtr}) — jangkauan dibeli di jam yang paling sedikit ditonton`,
        action: (a) =>
          `Geser sebagian impresi dari ${a.peak} ke jendela ber-VTR tinggi seperti ${a.best} melalui dayparting, lalu bandingkan VTR 6 detik gabungan pada minggu berikutnya.`,
      },
      retention: {
        risk: (a) =>
          `Hanya ${a.retention} penonton 6 detik yang bertahan hingga 15 detik — kreatif menarik perhatian namun gagal menahan pesan merek`,
        action:
          'Susun ulang kreatif utama agar poin merek dan produk muncul sebelum titik jatuh 6 detik, lalu bandingkan VTR 15 detik pada periode berikutnya.',
      },
      lowVtrCampaign: {
        risk: (a) =>
          `Kampanye “${a.name}” membawa ${a.share} dari impresi namun hanya ber-VTR 6 detik ${a.vtr}, di bawah rata-rata akun — jangkauan dibeli di tempat yang paling sedikit ditonton`,
        action: (a) =>
          `Perbarui kreatif “${a.name}” atau alihkan impresinya ke kampanye yang ditonton lebih baik, lalu bandingkan VTR-nya.`,
      },
      concentration: {
        risk: (a) => `Ketergantungan tinggi pada kampanye “${a.name}” (${a.share} dari total impresi)`,
        action:
          'Siapkan kampanye cadangan dengan materi berbeda agar penurunan performa satu kampanye tidak menjatuhkan efisiensi menonton keseluruhan akun.',
      },
      spendMisallocation: {
        risk: (a) =>
          `Sebanyak ${a.share} belanja jatuh pada jam yang ber-VTR di bawah rata-rata harinya sendiri — tertimbang belanja, hari ini hanya membeli VTR 6 detik ${a.spendWeighted}, padahal anggaran yang sama pada jam terbaik dapat mencapai ${a.bestCase}`,
        action: (a) =>
          `Kurangi porsi anggaran pada jam ${a.weak} dan alihkan ke jendela ${a.best} melalui dayparting, lalu bandingkan VTR 6 detik tertimbang belanja pada periode berikutnya.`,
      },
      overFrequency: {
        risk: (a) =>
          `Frequency ${a.frequency} berarti orang yang sama ditayangi berulang kali alih-alih memperluas jangkauan baru — pada merek FMCG hal ini membatasi pertumbuhan mental availability`,
        action:
          'Terapkan batas frekuensi (frequency cap) pada level grup iklan dan perluas audiens, lalu bandingkan pertumbuhan reach terhadap impresi pada periode berikutnya.',
      },
      lowVtrAdgroup: {
        risk: (a) =>
          `Grup iklan “${a.name}” hanya mencapai VTR 6 detik ${a.vtr}, jauh di bawah grup sejenis dalam kampanye yang sama (${a.peerVtr}) — materinya gagal menahan perhatian`,
        action: (a) =>
          `Hentikan atau ganti materi kreatif pada grup iklan “${a.name}”, lalu alihkan anggarannya ke grup dengan VTR tertinggi di kampanye yang sama dan bandingkan hasilnya.`,
      },
      costlyReach: {
        risk: (a) =>
          `Kampanye “${a.name}” membeli jangkauan dengan CPM ${a.cpm} (di atas rata-rata akun ${a.avgCpm}) namun hanya ber-VTR 6 detik ${a.vtr} — jangkauan yang mahal sekaligus paling sedikit ditonton`,
        action: (a) =>
          `Turunkan anggaran “${a.name}” dan uji ulang penargetan atau penempatannya dengan materi terbaik, lalu bandingkan CPM dan VTR 6 detik pada periode berikutnya.`,
      },
      lowVtrAdgroupAccount: {
        risk: (a) =>
          `Grup iklan “${a.name}” menyerap ${a.impressions} impresi namun hanya ber-VTR 6 detik ${a.vtr}, jauh di bawah rata-rata akun ${a.avgVtr} — impresi ini nyaris tidak ditonton`,
        action: (a) =>
          `Hentikan penayangan grup iklan “${a.name}” dan alihkan anggarannya ke grup ber-VTR tertinggi, lalu bandingkan VTR 6 detik gabungan akun pada periode berikutnya.`,
      },
      vtrDecline: {
        risk: (a) =>
          `Kualitas menonton menurun pada perbandingan jam yang sama (${a.basis}): VTR 6 detik ${a.vtr6s} dan VTR 15 detik ${a.vtr15s} — materi mulai kehilangan daya tarik atau frekuensi mulai menjenuhkan audiens`,
        action:
          'Rotasi materi kreatif utama dengan variasi hook baru pada kampanye berbelanja terbesar, lalu bandingkan VTR 6 detik pada jam yang sama minggu berikutnya.',
      },
      underweightedWinner: {
        risk: (a) =>
          `Kampanye ber-VTR terbaik “${a.best}” (${a.bestVtr}) hanya menerima ${a.bestShare} impresi, sementara “${a.heavy}” yang ber-VTR lebih rendah (${a.heavyVtr}) menyerap ${a.heavyShare} — anggaran mengalir ke materi yang kurang ditonton`,
        action: (a) =>
          `Alihkan sebagian anggaran harian dari “${a.heavy}” ke “${a.best}”, lalu bandingkan VTR 6 detik gabungan akun pada periode berikutnya.`,
      },
      coverage: {
        risk: (a) => `Data ${a.date} terhenti setelah ${a.last} sehingga hari tersebut belum utuh`,
        action:
          'Jadwalkan sinkronisasi setelah hari berakhir, atau tandai hari berjalan secara eksplisit agar tidak dibaca sebagai penurunan performa.',
      },
    },
    conversion: {
      calloutTitles: { efficiency: 'Efisiensi Konversi Per Jam', adgroup: 'Diagnosis Grup Iklan' },
      narrative: {
        summary: (a) =>
          `Laporan ini menganalisis performa iklan TikTok ${a.name} pada tingkat per jam selama ${a.days} hari (${a.hours} jam penuh). ${a.clicks} klik menghasilkan ${a.conversions} ${a.outcome} — tingkat ${a.outcome} ${a.conversionRate}. Analisis per jam memperlihatkan pada jam mana belanja paling efisien menghasilkan ${a.outcome}.`,
        efficiency: (a) =>
          `Tingkat ${a.outcome} tertinggi terjadi pada ${a.best} (${a.bestRate}) dan terendah pada ${a.weak} (${a.weakRate}) — klik yang sama lebih bernilai pada sebagian jam.`,
        adgroup: (a) =>
          `Terdapat ${a.count} grup iklan aktif. Perbandingan tingkat ${a.outcome} antar grup dalam satu kampanye memperlihatkan selisih efisiensi yang dapat ditindaklanjuti.`,
      },
      findings: {
        byHour: (a) =>
          `Tingkat ${a.outcome} tertinggi pada ${a.best} (${a.bestRate}) dan terendah pada ${a.weak} (${a.weakRate}), selisih ${a.multiple}. Klik yang jatuh pada jam ber-tingkat rendah membeli ${a.outcome} paling sedikit.`,
        stable: (a) =>
          `Tingkat ${a.outcome} relatif merata sepanjang hari (rentang ${a.spread}, dari ${a.weak} ke ${a.best}), sehingga tidak ada jam yang jelas lebih efisien untuk ${a.outcome}.`,
        adgroupGap: (a) =>
          `Grup iklan “${a.name}” hanya mencapai tingkat ${a.outcome} ${a.rate}, sekitar ${a.multiple} di bawah rata-rata grup sejenis (${a.peerRate}).`,
        adgroupEven: (a) => `Tingkat ${a.outcome} antar grup iklan relatif merata; tidak ada grup yang jelas tertinggal.`,
      },
      risks: {
        spendMisallocation: {
          risk: (a) =>
            `Sebanyak ${a.share} belanja jatuh pada jam dengan tingkat ${a.outcome} di bawah rata-rata harinya sendiri — tertimbang belanja, hari ini hanya membeli tingkat ${a.outcome} ${a.spendWeighted}, padahal anggaran yang sama pada jam terbaik dapat mencapai ${a.bestCase}`,
          action: (a) =>
            `Kurangi porsi anggaran pada jam ${a.weak} dan alihkan ke jendela ${a.best} melalui dayparting, lalu bandingkan tingkat ${a.outcome} tertimbang belanja pada periode berikutnya.`,
        },
        lowHours: {
          risk: (a) =>
            `Jam dengan belanja terbesar (${a.peak}) memiliki tingkat ${a.outcome} ${a.peakRate}, di bawah jam terbaik ${a.best} (${a.bestRate}) — anggaran dibeli di jam yang paling sedikit menghasilkan ${a.outcome}`,
          action: (a) =>
            `Geser sebagian anggaran dari ${a.peak} ke jendela ${a.best} melalui dayparting, lalu bandingkan tingkat ${a.outcome} gabungan pada periode berikutnya.`,
        },
        weakFunnel: {
          risk: (a) =>
            `CTR tercatat ${a.ctr} namun tingkat ${a.outcome} hanya ${a.rate} — klik cukup sehat tetapi tidak berlanjut menjadi ${a.outcome}, menandakan masalah pada penawaran atau pengalaman setelah klik, bukan pada media`,
          action: (a) =>
            `Tinjau halaman tujuan atau penawaran untuk hambatan, lalu bandingkan tingkat ${a.outcome} pada periode berikutnya.`,
        },
        lowCampaign: {
          risk: (a) =>
            `Kampanye “${a.name}” menyerap ${a.share} dari total belanja namun hanya mencapai tingkat ${a.outcome} ${a.rate}, di bawah rata-rata akun — anggaran dihabiskan di tempat yang paling sedikit menghasilkan ${a.outcome}`,
          action: (a) =>
            `Perbarui kreatif atau penargetan “${a.name}”, atau alihkan anggarannya ke kampanye dengan tingkat ${a.outcome} lebih tinggi, lalu bandingkan hasilnya.`,
        },
        costly: {
          risk: (a) =>
            `Kampanye “${a.name}” memiliki biaya per ${a.outcome} ${a.cpa}, jauh di atas rata-rata akun (${a.avgCpa}) — ${a.outcome} yang mahal membebani efisiensi anggaran secara keseluruhan`,
          action: (a) =>
            `Turunkan anggaran “${a.name}” dan uji ulang penargetan atau materi kreatifnya, lalu bandingkan biaya per ${a.outcome} pada periode berikutnya.`,
        },
        lowAdgroup: {
          risk: (a) =>
            `Grup iklan “${a.name}” hanya mencapai tingkat ${a.outcome} ${a.rate}, jauh di bawah grup sejenis dalam kampanye yang sama (${a.peerRate}) — materinya gagal menghasilkan ${a.outcome} sebaik yang lain`,
          action: (a) =>
            `Hentikan atau ganti materi kreatif pada grup iklan “${a.name}”, lalu alihkan anggarannya ke grup dengan tingkat ${a.outcome} tertinggi di kampanye yang sama.`,
        },
        lowAdgroupAccount: {
          risk: (a) =>
            `Grup iklan “${a.name}” menyerap ${a.clicks} klik namun hanya mencapai tingkat ${a.outcome} ${a.rate}, jauh di bawah rata-rata akun ${a.avgRate} — klik ini nyaris tidak menghasilkan ${a.outcome}`,
          action: (a) =>
            `Hentikan penayangan grup iklan “${a.name}” dan alihkan anggarannya ke grup dengan tingkat ${a.outcome} tertinggi, lalu bandingkan hasil gabungan akun.`,
        },
        decline: {
          risk: (a) =>
            `Tingkat ${a.outcome} menurun pada perbandingan jam yang sama (${a.basis}) menjadi ${a.rate} — performa funnel mulai melemah atau frekuensi mulai menjenuhkan audiens`,
          action: (a) =>
            `Rotasi materi kreatif atau penargetan pada kampanye berbelanja terbesar, lalu bandingkan tingkat ${a.outcome} pada jam yang sama minggu berikutnya.`,
        },
      },
    },
    outlook: {
      intro: (a) =>
        `Proyeksi berikut disusun dari ${a.hours} jam penuh pada ${a.days} hari — cukup untuk membaca pola harian, namun belum cukup untuk menyimpulkan tren mingguan.`,
      daypartProjection: (a) =>
        `Bila pola bertahan, jam ${a.window} akan terus menyerap sekitar ${a.share} dari belanja harian.`,
      reallocation: (a) =>
        `Bila pola menonton bertahan, memindahkan sebagian impresi ke jam ber-VTR tinggi seperti ${a.best} akan menaikkan efisiensi menonton gabungan tanpa menambah belanja.`,
      caveat:
        'Karena penjualan terjadi offline, dampak sesungguhnya sebaiknya dikonfirmasi melalui studi brand-lift atau sales-lift, bukan metrik konversi di platform.',
    },
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
  hourly: {
    subtitle: 'Hourly TikTok Performance Report',
    cover: { period: 'Data period', preparedFor: 'Prepared for' },
    sections: {
      summary: 'Executive Summary & Daily Trend',
      pattern: 'Intraday Pattern & Spend Pacing',
      efficiency: 'Hourly Efficiency & Cost Diagnosis',
      campaigns: 'Campaign Performance & Spend Concentration',
      adgroups: 'Adgroup Diagnosis',
      quality: 'Data Coverage & Quality',
      risks: 'Key Risks & Prioritized Action Plan',
      outlook: 'Outlook & Confidence Notes',
      appendix: 'Appendix: Hour-by-Hour Detail',
    },
    stat: {
      spend: 'Spend', impressions: 'Impressions', reach: 'Reach', frequency: 'Frequency',
      vtr6s: 'VTR 6s', vtr15s: 'VTR 15s', clicks: 'Clicks',
      ctr: 'CTR', cpc: 'CPC', cpm: 'CPM', hours: 'Hours Recorded',
    },
    chart: {
      pacingTitle: 'Cumulative Spend Pacing',
      deliveryTitle: 'Impressions & VTR by Hour',
      efficiencyTitle: 'Efficiency by Hour',
      vtrTitle: 'View-Through Rate by Hour',
      delivered: 'Delivered', evenPace: 'Even pace',
      impressions: 'Impressions', vtr6s: 'VTR 6s', vtr15s: 'VTR 15s',
      clicks: 'Clicks', cpm: 'CPM', ctr: 'CTR',
    },
    table: {
      hour: 'Hour', spend: 'Spend', impressions: 'Impressions', clicks: 'Clicks',
      ctr: 'CTR', cpc: 'CPC', cpm: 'CPM', vtr6s: 'VTR 6s', vtr15s: 'VTR 15s',
      campaign: 'Campaign', total: 'Total',
    },
    coverageTitle: 'Data coverage',
    coverage: {
      aggregated: (a) =>
        `${a.hours} carries everything accumulated since midnight rather than a single hour. It is excluded from every hourly chart and comparison, but still counted in the day's totals.`,
      incomplete: (a) =>
        `Data for ${a.date} stops after ${a.last}; later hours are not yet synced and are shown as gaps rather than zeros.`,
      noRevenue:
        'This export contains no revenue or conversion-value column, so ROAS and CPA cannot be calculated and are not reported.',
      paidOnly:
        'The source is a TikTok Ads (paid) export. Organic content performance is not included in this report.',
      hoursCounted: (a) => `This report covers ${a.hours} full hours across ${a.days} days.`,
    },
    headline: (a) =>
      `${a.name} spent ${a.spend} across ${a.hours} full hours over ${a.days} days, with a consistent intraday pattern.`,
    peakTrough: (a) =>
      `Spend peaks at ${a.peak} (${a.peakSpend}) and bottoms at ${a.trough} (${a.troughSpend}).`,
    pacingNarrative: (a) => `The ${a.half} half of the day absorbs ${a.share} of daily spend.`,
    ctrSwing: (a) =>
      `CTR is strongest at ${a.best} (${a.bestCtr}) and weakest at ${a.worst} (${a.worstCtr}).`,
    cpcSwing: (a) =>
      `Cost per click is cheapest at ${a.best} (${a.bestCpc}) and most expensive at ${a.worst} (${a.worstCpc}).`,
    topCampaign: (a) => `The largest campaign is “${a.name}” at ${a.spend} (${a.share} of total spend).`,
    adgroupOutlier: (a) =>
      `Adgroup “${a.name}” runs a ${a.cpc} CPC, roughly ${a.multiple} the average of its peers (${a.peerCpc}).`,
    dayCompare: (a) =>
      `On ${a.date}, spend was ${a.spend} against ${a.prev} over the same hours (${a.hours} matched hours).`,
    appendixNote:
      'Each row is one full hour. Buckets carrying accumulation since midnight are excluded. Ratios are derived from totals, never averaged across hours.',
    appendixDaySub: (a) => `${a.first} – ${a.last} · ${a.hours} full hours`,
    notReported: 'not available',

    ownerLabel: 'Owner',
    owners: { media: 'Media Buying', creative: 'Creative', data: 'Data / Ops' },
    severity: { high: 'high', medium: 'medium', low: 'low' },
    confidenceLabel: 'Analyst confidence',
    confidence: { High: 'High', Medium: 'Medium', Low: 'Low' },
    rankLabel: { cheapest: 'cheapest', dearest: 'most expensive' },
    lowVolumeNote: (a) => `* VTR on fewer than ${a.min} impressions is unstable and is not used to support any recommendation.`,
    provenance: {
      llm: (a) => `Narrative analysis written by ${a.model} (${a.provider}) from figures computed by the system. Every figure was verified against the source data.`,
      deterministic: 'Narrative analysis generated deterministically from the data, without a language model.',
      fallback: (a) => `Narrative analysis fell back to the deterministic writer because model generation failed (${a.reason}).`,
    },
    calloutTitles: {
      daypart: 'Dayparting Pattern',
      efficiency: 'Hourly Efficiency',
      mix: 'Spend Concentration',
      adgroup: 'Adgroup Diagnosis',
      dataGap: 'Data Gap',
    },
    narrative: {
      summary: (a) =>
        `This report analyses ${a.name}'s TikTok ad performance at hourly resolution across ${a.days} days (${a.hours} full hours). As an FMCG brand, the focus is viewing efficiency: ${a.impressions} impressions returned a ${a.vtr6s} 6-second and ${a.vtr15s} 15-second view-through rate. The hourly view exposes which hours earn efficient views and which do not.`,
      daypart: (a) =>
        `Spend concentrates around ${a.peak} and bottoms at ${a.trough}, a ${a.multiple} swing. The heavier half of the day absorbs ${a.share} of daily spend, so schedule changes can move impressions toward hours that view better.`,
      efficiency: (a) =>
        `The 6-second view-through rate is strongest at ${a.best} (${a.bestVtr}) and weakest at ${a.weak} (${a.weakVtr}) — the same impression is worth more in some hours. Of viewers who reach 6 seconds, ${a.retention} go on to 15, a read on how well the creative holds attention.`,
      mix: (a) =>
        `Impressions concentrate in “${a.name}”, which absorbs ${a.share} of the total across ${a.count} active campaigns. That concentration simplifies management but increases dependence on a single campaign.`,
      adgroup: (a) =>
        `There are ${a.count} active adgroups. Comparing view-through rate between adgroups inside the same campaign exposes an actionable viewing-efficiency gap.`,
    },
    findings: {
      daypart: (a) =>
        `Spend peaks at ${a.peak} (${a.peakSpend}) and bottoms at ${a.trough} (${a.troughSpend}) — a ${a.multiple} swing.`,
      vtrByHour: (a) =>
        `The 6-second VTR is strongest at ${a.best} (${a.bestVtr}) and weakest at ${a.weak} (${a.weakVtr}), a ${a.multiple} spread. Impressions landing in the low-VTR hours buy reach that is least watched.`,
      vtrStable: (a) =>
        `The 6-second VTR is broadly even through the day (${a.spread} range, from ${a.weak} to ${a.best}), so no hour is clearly more efficient to view in.`,
      mix: (a) => `“${a.name}” absorbs ${a.share} of all impressions this period.`,
      adgroupVtr: (a) =>
        `Adgroup “${a.name}” reaches only a ${a.vtr} 6-second VTR, roughly ${a.multiple} below its peers' average (${a.peerVtr}).`,
      adgroupEven: 'View-through rate is evenly distributed across adgroups; none is clearly failing to hold attention.',
      dataGap:
        'Because the purchase happens offline at a minimarket, there is no on-platform click-to-buy path, so this export can never carry conversions or ROAS. That is structural, not a missing data column. Every judgement here rests on viewing efficiency (VTR) and the cost of reach (CPM).',
      dataGapShop:
        'This account sells through TikTok Shop, so conversions here are real, on-platform purchases — not an estimate. ROAS is shown only for periods where the source also reports a purchase value; when it does not, this report states conversions occurred without inventing a revenue figure.',
      dataGapAppInstall:
        "This account's goal is the app install, not a sale — TikTok has no purchase or revenue event to attribute here, so this export can never carry ROAS or an in-app revenue figure. Every judgement rests on installs and cost per install (CPI).",
    },
    risks: {
      lowVtrHours: {
        risk: (a) =>
          `The heaviest-impression hour ${a.peak} views at only a ${a.peakVtr} 6-second VTR, below the best hour ${a.best} (${a.bestVtr}) — reach is bought where the ad is least watched`,
        action: (a) =>
          `Shift a portion of impressions from ${a.peak} into a high-VTR window like ${a.best} via dayparting, then compare blended 6-second VTR over the following week.`,
      },
      retention: {
        risk: (a) =>
          `Only ${a.retention} of 6-second viewers reach 15 seconds — the creative hooks attention but fails to hold the brand message`,
        action:
          'Re-cut the lead creative so the brand and product beat land before the 6-second drop-off, then compare 15-second VTR next period.',
      },
      lowVtrCampaign: {
        risk: (a) =>
          `Campaign “${a.name}” carries ${a.share} of impressions but views at only a ${a.vtr} 6-second VTR, below the account average — reach spent where it is least watched`,
        action: (a) =>
          `Refresh “${a.name}”'s creative or move its impressions to better-viewing campaigns, then compare its VTR.`,
      },
      concentration: {
        risk: (a) => `Heavy dependence on “${a.name}” (${a.share} of total impressions)`,
        action:
          'Stand up a secondary campaign on different creative so one campaign softening does not drag down the whole account’s viewing efficiency.',
      },
      spendMisallocation: {
        risk: (a) =>
          `${a.share} of spend lands in hours that view below the day's own average — weighted by where the money actually went, the day bought only a ${a.spendWeighted} 6-second VTR when the same budget in the best-viewing hours would have bought ${a.bestCase}`,
        action: (a) =>
          `Cut the budget share running at ${a.weak} and move it into the ${a.best} window via dayparting, then compare spend-weighted 6-second VTR next period.`,
      },
      overFrequency: {
        risk: (a) =>
          `A ${a.frequency} frequency means the same people are being re-served rather than new reach being opened up — on an FMCG brand that caps how far mental availability can grow`,
        action:
          'Set a frequency cap at adgroup level and widen the audience, then compare reach growth against impressions next period.',
      },
      lowVtrAdgroup: {
        risk: (a) =>
          `Adgroup “${a.name}” views at only a ${a.vtr} 6-second VTR against ${a.peerVtr} for its siblings in the same campaign — its creative is failing to hold attention`,
        action: (a) =>
          `Pause or replace the creative in “${a.name}” and move its budget to the highest-VTR adgroup in the same campaign, then compare the result.`,
      },
      costlyReach: {
        risk: (a) =>
          `Campaign “${a.name}” buys reach at a ${a.cpm} CPM (above the ${a.avgCpm} account average) yet views at only a ${a.vtr} 6-second VTR — reach that is both expensive and least watched`,
        action: (a) =>
          `Reduce “${a.name}”'s budget and re-test its targeting or placement with the best-performing creative, then compare CPM and 6-second VTR next period.`,
      },
      lowVtrAdgroupAccount: {
        risk: (a) =>
          `Adgroup “${a.name}” absorbs ${a.impressions} impressions but views at only a ${a.vtr} 6-second VTR against the ${a.avgVtr} account average — those impressions are barely being watched`,
        action: (a) =>
          `Stop delivery on “${a.name}” and move its budget to the highest-VTR adgroup, then compare the account's blended 6-second VTR next period.`,
      },
      vtrDecline: {
        risk: (a) =>
          `View quality is falling on a like-for-like basis (${a.basis}): 6-second VTR ${a.vtr6s} and 15-second VTR ${a.vtr15s} — the creative is losing pull or frequency is starting to fatigue the audience`,
        action:
          'Rotate the lead creative with a fresh hook variant on the heaviest-spending campaign, then compare 6-second VTR over the same hours next week.',
      },
      underweightedWinner: {
        risk: (a) =>
          `The best-viewing campaign “${a.best}” (${a.bestVtr}) takes only ${a.bestShare} of impressions while the lower-viewing “${a.heavy}” (${a.heavyVtr}) absorbs ${a.heavyShare} — budget is flowing to the less-watched creative`,
        action: (a) =>
          `Shift a portion of daily budget from “${a.heavy}” to “${a.best}”, then compare the account's blended 6-second VTR next period.`,
      },
      coverage: {
        risk: (a) => `${a.date} stops after ${a.last}, so that day is incomplete`,
        action:
          'Schedule the sync after the day closes, or flag in-progress days explicitly so they are not read as a performance drop.',
      },
    },
    conversion: {
      calloutTitles: { efficiency: 'Hourly Conversion Efficiency', adgroup: 'Adgroup Diagnosis' },
      narrative: {
        summary: (a) =>
          `This report analyses ${a.name}'s TikTok ad performance at hourly resolution across ${a.days} days (${a.hours} full hours). ${a.clicks} clicks returned ${a.conversions} ${a.outcome}s — a ${a.conversionRate} ${a.outcome} rate. The hourly view exposes which hours turn spend into ${a.outcome}s most efficiently.`,
        efficiency: (a) =>
          `The ${a.outcome} rate is strongest at ${a.best} (${a.bestRate}) and weakest at ${a.weak} (${a.weakRate}) — the same click is worth more in some hours.`,
        adgroup: (a) =>
          `There are ${a.count} active adgroups. Comparing the ${a.outcome} rate between adgroups inside the same campaign exposes an actionable efficiency gap.`,
      },
      findings: {
        byHour: (a) =>
          `The ${a.outcome} rate is strongest at ${a.best} (${a.bestRate}) and weakest at ${a.weak} (${a.weakRate}), a ${a.multiple} spread. Clicks landing in the low-rate hours buy the fewest ${a.outcome}s.`,
        stable: (a) =>
          `The ${a.outcome} rate is broadly even through the day (${a.spread} range, from ${a.weak} to ${a.best}), so no hour is clearly more efficient for ${a.outcome}s.`,
        adgroupGap: (a) =>
          `Adgroup “${a.name}” reaches only a ${a.rate} ${a.outcome} rate, roughly ${a.multiple} below its peers' average (${a.peerRate}).`,
        adgroupEven: (a) => `The ${a.outcome} rate is evenly distributed across adgroups; none is clearly falling behind.`,
      },
      risks: {
        spendMisallocation: {
          risk: (a) =>
            `${a.share} of spend lands in hours with a ${a.outcome} rate below the day's own average — weighted by where the money actually went, the day bought only a ${a.spendWeighted} ${a.outcome} rate when the same budget in the best-performing hours would have bought ${a.bestCase}`,
          action: (a) =>
            `Cut the budget share running at ${a.weak} and move it into the ${a.best} window via dayparting, then compare the spend-weighted ${a.outcome} rate next period.`,
        },
        lowHours: {
          risk: (a) =>
            `The heaviest-spend hour ${a.peak} runs at only a ${a.peakRate} ${a.outcome} rate, below the best hour ${a.best} (${a.bestRate}) — budget is bought where it is least likely to become a ${a.outcome}`,
          action: (a) =>
            `Shift a portion of budget from ${a.peak} into the ${a.best} window via dayparting, then compare the blended ${a.outcome} rate next period.`,
        },
        weakFunnel: {
          risk: (a) =>
            `CTR runs at ${a.ctr} but the ${a.outcome} rate is only ${a.rate} — clicks are healthy but rarely continue to a ${a.outcome}, pointing at the offer or post-click experience rather than the media`,
          action: (a) =>
            `Review the landing experience or offer for friction, then compare the ${a.outcome} rate next period.`,
        },
        lowCampaign: {
          risk: (a) =>
            `Campaign “${a.name}” absorbs ${a.share} of spend but reaches only a ${a.rate} ${a.outcome} rate, below the account average — budget is spent where it is least likely to convert`,
          action: (a) =>
            `Refresh “${a.name}”'s creative or targeting, or move its budget to a higher-${a.outcome}-rate campaign, then compare the result.`,
        },
        costly: {
          risk: (a) =>
            `Campaign “${a.name}” runs at a cost per ${a.outcome} of ${a.cpa}, well above the account average (${a.avgCpa}) — expensive ${a.outcome}s are dragging down overall budget efficiency`,
          action: (a) =>
            `Reduce “${a.name}”'s budget and re-test its targeting or creative, then compare cost per ${a.outcome} next period.`,
        },
        lowAdgroup: {
          risk: (a) =>
            `Adgroup “${a.name}” reaches only a ${a.rate} ${a.outcome} rate, far below its siblings in the same campaign (${a.peerRate}) — its creative is failing to convert as well as the others`,
          action: (a) =>
            `Pause or replace the creative in “${a.name}” and move its budget to the highest-${a.outcome}-rate adgroup in the same campaign.`,
        },
        lowAdgroupAccount: {
          risk: (a) =>
            `Adgroup “${a.name}” absorbs ${a.clicks} clicks but reaches only a ${a.rate} ${a.outcome} rate against the ${a.avgRate} account average — these clicks are barely converting`,
          action: (a) =>
            `Stop delivery on “${a.name}” and move its budget to the highest-${a.outcome}-rate adgroup, then compare the account's blended result.`,
        },
        decline: {
          risk: (a) =>
            `The ${a.outcome} rate is falling on a like-for-like basis (${a.basis}) to ${a.rate} — the funnel is weakening or frequency is starting to fatigue the audience`,
          action: (a) =>
            `Rotate the creative or targeting on the heaviest-spending campaign, then compare the ${a.outcome} rate over the same hours next week.`,
        },
      },
    },
    outlook: {
      intro: (a) =>
        `The following projections rest on ${a.hours} full hours across ${a.days} days — enough to read a within-day pattern, not enough to call a weekly trend.`,
      daypartProjection: (a) =>
        `If the pattern holds, the ${a.window} window will keep absorbing roughly ${a.share} of daily spend.`,
      reallocation: (a) =>
        `If the viewing pattern holds, moving a portion of impressions into high-VTR hours like ${a.best} would raise blended viewing efficiency without adding spend.`,
      caveat:
        'Because the sale is offline, real impact should be confirmed with a brand-lift or sales-lift study, not on-platform conversion metrics.',
    },
  },
};

const COPY: Record<Locale, ReportCopy> = { id: ID, en: EN };

export const getCopy = (locale: Locale = DEFAULT_LOCALE): ReportCopy => COPY[locale] ?? COPY[DEFAULT_LOCALE];
