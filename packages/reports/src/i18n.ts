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
  /** Section-level analyst prose. */
  narrative: {
    summary: (a: { name: string; days: number; hours: number; impressions: string; vtr6s: string; vtr15s: string }) => string;
    daypart: (a: { peak: string; trough: string; multiple: string; share: string }) => string;
    efficiency: (a: { cheap: string; dear: string; multiple: string; ctrBest: string; ctrWorst: string }) => string;
    mix: (a: { name: string; share: string; count: number }) => string;
    adgroup: (a: { count: number }) => string;
  };
  /** Callout bodies. */
  findings: {
    daypart: (a: { peak: string; peakSpend: string; trough: string; troughSpend: string; multiple: string }) => string;
    efficiencyInversion: (a: { cheap: string; cheapCpc: string; dear: string; dearCpc: string; multiple: string }) => string;
    efficiencySpreadOnly: (a: { cheap: string; dear: string; multiple: string }) => string;
    efficiencyStable: (a: { spread: string }) => string;
    mix: (a: { name: string; share: string }) => string;
    adgroupOutlier: (a: { name: string; cpc: string; peerCpc: string; multiple: string }) => string;
    adgroupEven: string;
    dataGap: string;
  };
  risks: {
    inversion: { risk: (a: { dear: string; multiple: string }) => string; action: (a: { cheap: string; dear: string }) => string };
    concentration: { risk: (a: { name: string; share: string }) => string; action: string };
    adgroup: { risk: (a: { name: string; multiple: string }) => string; action: (a: { name: string }) => string };
    noRevenue: { risk: string; action: string };
    coverage: { risk: (a: { date: string; last: string }) => string; action: string };
    zeroClick: { risk: (a: { name: string }) => string; action: string };
  };
  outlook: {
    intro: (a: { hours: number; days: number }) => string;
    daypartProjection: (a: { window: string; share: string }) => string;
    savings: (a: { amount: string; dear: string }) => string;
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
    stat: {
      spend: 'Biaya', impressions: 'Impresi', reach: 'Jangkauan', frequency: 'Frekuensi',
      vtr6s: 'VTR 6 dtk', vtr15s: 'VTR 15 dtk', clicks: 'Klik',
      ctr: 'CTR', cpc: 'CPC', cpm: 'CPM', hours: 'Jam Tercatat',
    },
    chart: {
      pacingTitle: 'Laju Belanja Kumulatif',
      deliveryTitle: 'Impresi & VTR Per Jam',
      efficiencyTitle: 'Efisiensi Per Jam',
      vtrTitle: 'View-Through Rate Per Jam',
      delivered: 'Terpakai', evenPace: 'Laju merata',
      impressions: 'Impresi', vtr6s: 'VTR 6 dtk', vtr15s: 'VTR 15 dtk',
      clicks: 'Klik', cpm: 'CPM', ctr: 'CTR',
    },
    table: {
      hour: 'Jam', spend: 'Biaya', impressions: 'Impresi', clicks: 'Klik',
      ctr: 'CTR', cpc: 'CPC', cpm: 'CPM', campaign: 'Kampanye', total: 'Total',
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
    lowVolumeNote: (a) => `* Biaya per klik dari volume klik di bawah ${a.min} tidak stabil dan tidak dijadikan dasar rekomendasi.`,
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
        `Belanja terkonsentrasi pada ${a.peak} dan terendah pada ${a.trough}, dengan selisih ${a.multiple}. Paruh yang lebih padat menyerap ${a.share} dari total belanja harian, sehingga penyesuaian jadwal tayang berpotensi memberi dampak langsung pada efisiensi.`,
      efficiency: (a) =>
        `Biaya per klik termurah terjadi pada ${a.cheap} dan termahal pada ${a.dear} — selisih ${a.multiple}. CTR bergerak searah, dari ${a.ctrBest} menjadi ${a.ctrWorst}. Artinya jam dengan belanja terbesar justru bukan jam dengan respons audiens terbaik.`,
      mix: (a) =>
        `Belanja terkonsentrasi pada “${a.name}” yang menyerap ${a.share} dari total, dari ${a.count} kampanye aktif. Konsentrasi ini menyederhanakan pengelolaan namun meningkatkan ketergantungan pada satu kampanye.`,
      adgroup: (a) =>
        `Terdapat ${a.count} grup iklan aktif. Perbandingan biaya per klik antar grup dalam satu kampanye memperlihatkan selisih efisiensi yang dapat ditindaklanjuti.`,
    },
    findings: {
      daypart: (a) =>
        `Belanja memuncak pada ${a.peak} (${a.peakSpend}) dan terendah pada ${a.trough} (${a.troughSpend}) — selisih ${a.multiple}.`,
      efficiencyInversion: (a) =>
        `Klik termurah pada ${a.cheap} (${a.cheapCpc}) sementara termahal pada ${a.dear} (${a.dearCpc}), selisih ${a.multiple}. Belanja terbesar justru jatuh pada jam-jam termahal.`,
      efficiencySpreadOnly: (a) =>
        `Biaya per klik bervariasi ${a.multiple} antara ${a.cheap} dan ${a.dear}, namun belanja tidak terkonsentrasi pada jam-jam termahal.`,
      efficiencyStable: (a) =>
        `Biaya per klik relatif stabil sepanjang hari (rentang ${a.spread}), sehingga tidak ada jam yang jelas lebih efisien.`,
      mix: (a) => `“${a.name}” menyerap ${a.share} dari total belanja periode ini.`,
      adgroupOutlier: (a) =>
        `Grup iklan “${a.name}” membayar ${a.cpc} per klik, sekitar ${a.multiple} dibandingkan rata-rata grup sejenis (${a.peerCpc}).`,
      adgroupEven: 'Biaya per klik antar grup iklan relatif merata; tidak ada pemborosan yang menonjol.',
      dataGap:
        'Ekspor ini tidak memuat kolom pendapatan maupun nilai konversi, sehingga ROAS dan CPA tidak dapat dihitung. Seluruh penilaian efisiensi pada laporan ini berbasis biaya (CPM/CPC), bukan hasil penjualan.',
    },
    risks: {
      inversion: {
        risk: (a) => `Belanja terkonsentrasi pada ${a.dear}, jam dengan biaya klik ${a.multiple} lebih mahal`,
        action: (a) =>
          `Uji pengalihan sebagian anggaran dari ${a.dear} ke ${a.cheap} menggunakan dayparting, lalu ukur perubahan CPC gabungan selama tujuh hari.`,
      },
      concentration: {
        risk: (a) => `Ketergantungan tinggi pada kampanye “${a.name}” (${a.share} dari total belanja)`,
        action:
          'Siapkan kampanye cadangan dengan materi berbeda agar penurunan performa satu kampanye tidak menjatuhkan keseluruhan akun.',
      },
      adgroup: {
        risk: (a) => `Grup iklan “${a.name}” membayar ${a.multiple} lipat biaya klik dibanding grup sejenis`,
        action: (a) =>
          `Jeda atau perbarui materi pada “${a.name}”, dan alihkan anggarannya ke grup sejenis yang lebih efisien.`,
      },
      noRevenue: {
        risk: 'Tidak ada data pendapatan sehingga efisiensi tidak dapat dinilai hingga tingkat ROAS',
        action:
          'Aktifkan pelaporan nilai konversi pada ekspor TikTok Ads agar laporan berikutnya dapat menilai hasil, bukan hanya biaya.',
      },
      coverage: {
        risk: (a) => `Data ${a.date} terhenti setelah ${a.last} sehingga hari tersebut belum utuh`,
        action:
          'Jadwalkan sinkronisasi setelah hari berakhir, atau tandai hari berjalan secara eksplisit agar tidak dibaca sebagai penurunan performa.',
      },
      zeroClick: {
        risk: (a) => `Kampanye “${a.name}” hampir tidak menghasilkan klik meski menyerap belanja besar`,
        action:
          'Konfirmasi bahwa tujuan kampanye memang tayangan; bila tujuannya trafik, tinjau ulang materi dan penargetan.',
      },
    },
    outlook: {
      intro: (a) =>
        `Proyeksi berikut disusun dari ${a.hours} jam penuh pada ${a.days} hari — cukup untuk membaca pola harian, namun belum cukup untuk menyimpulkan tren mingguan.`,
      daypartProjection: (a) =>
        `Bila pola bertahan, jam ${a.window} akan terus menyerap sekitar ${a.share} dari belanja harian.`,
      savings: (a) =>
        `Pengalihan anggaran menjauh dari jam termahal (${a.dear}) berpotensi menghemat hingga ${a.amount} per hari pada tingkat belanja saat ini, dengan asumsi volume klik dapat dipertahankan.`,
      caveat:
        'Estimasi ini bersifat indikatif dan perlu divalidasi melalui uji terkontrol sebelum diterapkan menyeluruh.',
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
      ctr: 'CTR', cpc: 'CPC', cpm: 'CPM', campaign: 'Campaign', total: 'Total',
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
    lowVolumeNote: (a) => `* Cost per click on fewer than ${a.min} clicks is unstable and is not used to support any recommendation.`,
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
        `Spend concentrates around ${a.peak} and bottoms at ${a.trough}, a ${a.multiple} swing. The heavier half of the day absorbs ${a.share} of daily spend, so schedule changes have immediate leverage on efficiency.`,
      efficiency: (a) =>
        `Clicks are cheapest at ${a.cheap} and dearest at ${a.dear} — a ${a.multiple} spread. CTR moves the same way, from ${a.ctrBest} down to ${a.ctrWorst}. The hours taking the most budget are not the hours the audience responds best in.`,
      mix: (a) =>
        `Spend concentrates in “${a.name}”, which absorbs ${a.share} of the total across ${a.count} active campaigns. That concentration simplifies management but increases dependence on a single campaign.`,
      adgroup: (a) =>
        `There are ${a.count} active adgroups. Comparing cost per click between adgroups inside the same campaign exposes an actionable efficiency gap.`,
    },
    findings: {
      daypart: (a) =>
        `Spend peaks at ${a.peak} (${a.peakSpend}) and bottoms at ${a.trough} (${a.troughSpend}) — a ${a.multiple} swing.`,
      efficiencyInversion: (a) =>
        `Clicks cost ${a.cheapCpc} at ${a.cheap} but ${a.dearCpc} at ${a.dear}, a ${a.multiple} difference — and the largest spend lands in the expensive hours.`,
      efficiencySpreadOnly: (a) =>
        `Cost per click swings ${a.multiple} between ${a.cheap} and ${a.dear}, though budget is not concentrated in the expensive hours.`,
      efficiencyStable: (a) =>
        `Cost per click is broadly stable through the day (${a.spread} range), so no hour is clearly more efficient than another.`,
      mix: (a) => `“${a.name}” absorbs ${a.share} of all spend this period.`,
      adgroupOutlier: (a) =>
        `Adgroup “${a.name}” pays ${a.cpc} per click, roughly ${a.multiple} its peers' average (${a.peerCpc}).`,
      adgroupEven: 'Cost per click is evenly distributed across adgroups; no standout waste.',
      dataGap:
        'This export carries no revenue or conversion-value column, so ROAS and CPA cannot be calculated. Every efficiency judgement in this report is cost-based (CPM/CPC), not outcome-based.',
    },
    risks: {
      inversion: {
        risk: (a) => `Spend concentrates in ${a.dear}, where clicks cost ${a.multiple} more`,
        action: (a) =>
          `Test shifting part of the budget from ${a.dear} to ${a.cheap} via dayparting, then measure blended CPC over seven days.`,
      },
      concentration: {
        risk: (a) => `Heavy dependence on “${a.name}” (${a.share} of total spend)`,
        action:
          'Stand up a secondary campaign on different creative so one campaign softening does not take the whole account with it.',
      },
      adgroup: {
        risk: (a) => `Adgroup “${a.name}” pays ${a.multiple} its peers' cost per click`,
        action: (a) => `Pause or refresh creative on “${a.name}” and move its budget to the cheaper sibling adgroups.`,
      },
      noRevenue: {
        risk: 'No revenue data, so efficiency cannot be judged at the ROAS level',
        action:
          'Enable conversion-value reporting in the TikTok Ads export so the next report can judge outcomes rather than only cost.',
      },
      coverage: {
        risk: (a) => `${a.date} stops after ${a.last}, so that day is incomplete`,
        action:
          'Schedule the sync after the day closes, or flag in-progress days explicitly so they are not read as a performance drop.',
      },
      zeroClick: {
        risk: (a) => `Campaign “${a.name}” generates almost no clicks despite heavy spend`,
        action:
          'Confirm the campaign objective really is views; if traffic is intended, revisit creative and targeting.',
      },
    },
    outlook: {
      intro: (a) =>
        `The following projections rest on ${a.hours} full hours across ${a.days} days — enough to read a within-day pattern, not enough to call a weekly trend.`,
      daypartProjection: (a) =>
        `If the pattern holds, the ${a.window} window will keep absorbing roughly ${a.share} of daily spend.`,
      savings: (a) =>
        `Shifting budget away from the most expensive hours (${a.dear}) could save up to ${a.amount} per day at current spend levels, assuming click volume holds.`,
      caveat:
        'These figures are indicative and should be validated with a controlled test before being applied across the account.',
    },
  },
};

const COPY: Record<Locale, ReportCopy> = { id: ID, en: EN };

export const getCopy = (locale: Locale = DEFAULT_LOCALE): ReportCopy => COPY[locale] ?? COPY[DEFAULT_LOCALE];
