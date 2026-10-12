import { BENCHMARK_LAYOUT, type NorthStar } from '@tempo/core';

/**
 * Appendix legend: plain-language definitions of every term a reader of the
 * report meets, so people who don't live in ad metrics can follow it. Fully
 * static (no LLM, no data) — and per template, so a GMV report doesn't define
 * "CPI" and an Install report doesn't define "ROI". `legend.test.ts` asserts
 * every benchmark metric a template can show has an entry here, so adding a
 * metric to `BENCHMARK_LAYOUT` without defining it fails the build.
 */

export interface LegendEntry {
  term: string;
  definition: string;
  /** How it's calculated, where that's useful. */
  formula?: string;
}

export interface LegendGroup {
  title: string;
  entries: LegendEntry[];
}

/** One definition per benchmark metric key. */
export const METRIC_LEGEND: Record<string, LegendEntry> = {
  cpm: {
    term: 'CPM',
    definition: 'Biaya iklan untuk setiap 1.000 kali iklan tampil. Makin rendah makin murah menjangkau audiens.',
    formula: 'Spend ÷ Impressions × 1.000',
  },
  ctr: {
    term: 'CTR (Click-Through Rate)',
    definition: 'Persentase tayangan iklan yang berujung klik. Makin tinggi berarti creative makin menarik.',
    formula: 'Klik ÷ Impressions',
  },
  vtr: {
    term: 'VTR 6s (View-Through Rate)',
    definition: 'Persentase tayangan yang ditonton video-nya minimal 6 detik — tanda hook awal cukup kuat menahan penonton.',
    formula: 'Tayangan video ≥ 6 detik ÷ Impressions',
  },
  cpc: {
    term: 'CPC (Cost per Click)',
    definition: 'Rata-rata biaya untuk satu klik. Makin rendah makin efisien.',
    formula: 'Spend ÷ Klik',
  },
  cost_per_atc: {
    term: 'Cost per Add to Cart',
    definition: 'Biaya untuk satu produk dimasukkan ke keranjang. Belum tersedia karena data add-to-cart tidak dilaporkan oleh sumber data.',
  },
  roi: {
    term: 'ROI / ROAS',
    definition: 'Berapa rupiah revenue yang kembali untuk setiap Rp1 biaya iklan. 9,6x berarti setiap Rp1 iklan menghasilkan Rp9,6 penjualan.',
    formula: 'Revenue ÷ Spend',
  },
  cvr: {
    term: 'CVR (Conversion Rate)',
    definition:
      'Perbandingan jumlah order dengan jumlah klik. Bisa melebihi 100% karena order dari GMV Max/live tidak selalu melalui klik iklan reguler.',
    formula: 'Order ÷ Klik',
  },
  cpa: {
    term: 'CPA / Cost per Order',
    definition: 'Biaya iklan rata-rata untuk mendapatkan satu order. Makin rendah makin efisien.',
    formula: 'Spend sumber conversion ÷ Order',
  },
  cpmr: {
    term: 'Cost per 1.000 Reach',
    definition: 'Biaya untuk menjangkau 1.000 orang unik (bukan tayangan). Lebih jujur menggambarkan biaya menjangkau audiens baru.',
    formula: 'Spend ÷ Reach × 1.000',
  },
  frequency: {
    term: 'Frequency',
    definition: 'Rata-rata berapa kali satu orang melihat iklan. Terlalu tinggi berarti iklan jenuh dan budget berulang ke orang yang sama.',
    formula: 'Impressions ÷ Reach',
  },
  vtr_6s: {
    term: 'VTR 6s (View-Through Rate)',
    definition: 'Persentase tayangan yang ditonton video-nya minimal 6 detik — tanda hook awal cukup kuat menahan penonton.',
    formula: 'Tayangan video ≥ 6 detik ÷ Impressions',
  },
  view_rate_2s: {
    term: '2s View Rate',
    definition: 'Persentase tayangan yang ditonton minimal 2 detik — ukuran seberapa banyak yang tidak langsung scroll.',
    formula: 'Tayangan video ≥ 2 detik ÷ Impressions',
  },
  completion_p50: {
    term: 'Completion 50%',
    definition: 'Persentase penonton yang bertahan sampai setengah durasi video.',
    formula: 'Tayangan sampai 50% ÷ Total video play',
  },
  completion_p100: {
    term: 'Completion 100%',
    definition: 'Persentase penonton yang menonton video sampai habis.',
    formula: 'Tayangan sampai 100% ÷ Total video play',
  },
  avg_play: {
    term: 'Rata-rata Durasi Tonton',
    definition: 'Rata-rata detik yang ditonton per kali video diputar.',
    formula: 'Total detik tonton ÷ Total video play',
  },
  engagement_rate: {
    term: 'Engagement Rate',
    definition: 'Persentase tayangan yang menghasilkan interaksi (like, komentar, share, follow, dll.).',
    formula: 'Engagement ÷ Impressions',
  },
  profile_visit_rate: {
    term: 'Profile Visit Rate',
    definition: 'Persentase tayangan yang berujung kunjungan ke profil akun — tanda minat lebih jauh pada brand.',
    formula: 'Kunjungan profil ÷ Impressions',
  },
  cost_per_engagement: {
    term: 'Cost per Engagement',
    definition: 'Rata-rata biaya untuk satu interaksi. Makin rendah makin efisien.',
    formula: 'Spend ÷ Engagement',
  },
  cpi: {
    term: 'CPI (Cost per Install)',
    definition: 'Rata-rata biaya untuk satu install aplikasi. Makin rendah makin efisien.',
    formula: 'Spend ÷ Install',
  },
  install_rate: {
    term: 'Install Rate',
    definition: 'Persentase klik iklan yang berujung install aplikasi.',
    formula: 'Install ÷ Klik',
  },
  installs_per_1k: {
    term: 'Install per 1.000 Impresi',
    definition: 'Berapa install yang dihasilkan setiap 1.000 kali iklan tampil.',
    formula: 'Install ÷ Impressions × 1.000',
  },
  registration_rate: {
    term: 'Registration Rate',
    definition: 'Persentase user yang sudah install lalu menyelesaikan registrasi — ukuran kualitas install.',
    formula: 'Registrasi ÷ Install',
  },
  cost_per_registration: {
    term: 'Cost per Registration',
    definition: 'Rata-rata biaya untuk satu user yang selesai registrasi. Makin rendah makin efisien.',
    formula: 'Spend ÷ Registrasi',
  },
};

/** Metrics that appear in a template's KPI cards/trend table but not in its benchmark grid. */
const EXTRA_METRICS: Record<NorthStar, string[]> = {
  shop: ['frequency'],
  vtr: [],
  app_install: [],
};

const EXTRA_TERMS: Record<NorthStar, LegendEntry[]> = {
  shop: [
    {
      term: 'GMV / Revenue',
      definition: 'Nilai total penjualan yang dihasilkan iklan di TikTok Shop, gabungan GMV Max dan penjualan dari iklan TTAM.',
      formula: 'Gross revenue GMV Max + nilai penjualan onsite TTAM',
    },
    { term: 'Spend / Total Cost', definition: 'Total biaya iklan yang dikeluarkan pada periode laporan (TTAM + GMV Max).' },
    { term: 'Orders', definition: 'Jumlah pesanan yang dihasilkan iklan (GMV Max + onsite shopping TTAM).' },
    {
      term: 'AOV (Average Order Value)',
      definition: 'Rata-rata nilai belanja per order. Naik berarti pembeli membelanjakan lebih banyak per transaksi.',
      formula: 'GMV ÷ Orders',
    },
    {
      term: 'Reach',
      definition: 'Jumlah orang unik yang melihat iklan setidaknya sekali.',
    },
    {
      term: 'Engagement',
      definition: 'Total interaksi pada iklan: like, komentar, share, follow, dan sejenisnya.',
    },
    {
      term: 'ROI gabungan vs ROI sumber conversion',
      definition:
        'ROI gabungan memakai seluruh spend (termasuk awareness/consideration yang memang tidak dirancang menghasilkan penjualan langsung). ROI sumber conversion hanya memakai campaign yang berorientasi penjualan, sehingga biasanya lebih tinggi.',
    },
    {
      term: 'Dampak ke ROI',
      definition:
        'Seberapa besar satu sumber menaikkan (+) atau menurunkan (−) rata-rata ROI dibanding jika semua sumber sama efisiennya. Jumlah dampak seluruh sumber = 0.',
      formula: '(Revenue sumber − ROI rata-rata × Spend sumber) ÷ Total spend',
    },
    {
      term: 'TOP / BOTTOM',
      definition:
        'TOP = sumber dengan efisiensi tertinggi, BOTTOM = terendah (BOTTOM 1 yang paling lemah). Hanya sumber dengan porsi spend ≥ 2% yang diperingkat; jika sumber kurang dari 6, tabel dibagi dua sesuai jumlahnya.',
    },
  ],
  vtr: [
    { term: 'Reach', definition: 'Jumlah orang unik yang melihat iklan setidaknya sekali.' },
    { term: 'Impressions', definition: 'Berapa kali iklan ditampilkan (satu orang bisa melihat berkali-kali).' },
    { term: 'Spend', definition: 'Total biaya iklan regular (TTAM) pada periode laporan.' },
    {
      term: 'Dampak ke Rata-rata',
      definition:
        'Selisih antara porsi hasil (reach) dan porsi biaya sebuah campaign. Positif berarti campaign itu memberi lebih banyak reach dibanding porsi budgetnya sehingga menaikkan efisiensi rata-rata.',
      formula: '% Reach − % Spend',
    },
    {
      term: 'TOP / BOTTOM',
      definition:
        'TOP = campaign dengan reach per rupiah tertinggi, BOTTOM = terendah (BOTTOM 1 yang paling lemah). Hanya campaign dengan porsi spend ≥ 2% yang diperingkat; jika kurang dari 6, tabel dibagi dua sesuai jumlahnya.',
    },
  ],
  app_install: [
    { term: 'Impressions', definition: 'Berapa kali iklan ditampilkan (satu orang bisa melihat berkali-kali).' },
    { term: 'Klik', definition: 'Jumlah klik pada iklan.' },
    { term: 'Spend', definition: 'Total biaya iklan regular (TTAM) pada periode laporan.' },
    { term: 'Install', definition: 'Jumlah aplikasi yang berhasil terpasang dari iklan (data atribusi TikTok).' },
    { term: 'Registrasi', definition: 'Jumlah user yang menyelesaikan registrasi setelah install.' },
    {
      term: 'Dampak ke Rata-rata',
      definition:
        'Selisih antara porsi hasil (install) dan porsi biaya sebuah campaign. Positif berarti campaign itu menghasilkan lebih banyak install dibanding porsi budgetnya sehingga menurunkan CPI rata-rata.',
      formula: '% Install − % Spend',
    },
    {
      term: 'TOP / BOTTOM',
      definition:
        'TOP = campaign dengan install per rupiah tertinggi (CPI terendah), BOTTOM = terendah (BOTTOM 1 yang paling lemah). Hanya campaign conversion dengan porsi spend ≥ 2% yang diperingkat; jika kurang dari 6, tabel dibagi dua sesuai jumlahnya.',
    },
  ],
};

const STATUS_GROUP: LegendGroup = {
  title: 'Status, Skor & Prioritas',
  entries: [
    {
      term: 'Baik (hijau)',
      definition: 'Metrik mencapai atau melampaui benchmark.',
    },
    {
      term: 'Waspada (kuning)',
      definition: 'Metrik di bawah benchmark tetapi masih dalam toleransi 10% dari target — perlu dipantau.',
    },
    {
      term: 'Kritis (merah)',
      definition: 'Metrik lebih dari 10% di bawah benchmark — perlu tindakan segera.',
    },
    {
      term: 'Status area (Skor Kesehatan per Area)',
      definition:
        'Untuk area berbasis benchmark, statusnya mengikuti metrik terburuk di dalamnya — itu sebabnya sebuah area bisa "Kritis" walau sebagian besar metriknya baik. Area lain (funnel, tren, creative, konsentrasi) mengikuti aturannya sendiri. Kolom "Kondisi" menunjukkan berapa yang sudah baik; kolom catatan menyebut apa yang berjalan baik dan apa yang perlu diperbaiki.',
    },
    {
      term: 'Overall Health Score',
      definition:
        'Ringkasan seluruh area: Kritis jika ≥ 2 area Kritis; Waspada jika 1 area Kritis atau ≥ 2 area Waspada; selain itu Sehat.',
    },
    { term: 'Level risiko (Low / Medium / High)', definition: 'High = area berstatus Kritis; Medium = area berstatus Waspada.' },
    {
      term: 'Prioritas rekomendasi (P1 / P2 / P3)',
      definition: 'P1 = kerjakan dalam 0–3 hari (masalah Kritis atau pemborosan budget); P2 = 1–2 minggu; P3 = peluang yang dikerjakan di siklus berikutnya.',
    },
    {
      term: 'Winning / Watch / Underperform',
      definition: 'Penilaian creative: Winning = memenuhi semua ukuran utama; Watch = memenuhi sebagian; Underperform = tidak memenuhi.',
    },
    {
      term: 'Scale Up / Maintain / Optimize / Watch',
      definition:
        'Saran per produk/campaign: Scale Up = efisien, naikkan budget bertahap; Maintain = efisien, pertahankan; Optimize = di bawah target, perbaiki dulu; Watch = data belum cukup/pantau.',
    },
  ],
};

const GENERAL_TERMS: LegendEntry[] = [
  {
    term: 'TTAM (TikTok Ads Manager)',
    definition:
      'Iklan reguler di TikTok Ads Manager (reach, video views, traffic, engagement, dan sejenisnya). Menyediakan data tayangan, jangkauan, dan klik.',
  },
  {
    term: 'GMV Max',
    definition:
      'Jenis kampanye TikTok Shop yang dioptimasi otomatis untuk penjualan (Product/Live GMV Max). Punya data biaya, revenue, dan order, tetapi tidak punya data tayangan atau jangkauan.',
  },
  {
    term: 'Funnel: Awareness (TOF) / Consideration (MOF) / Conversion (BOF)',
    definition:
      'Tahapan perjalanan audiens. TOF = mengenalkan brand (reach, video views); MOF = menumbuhkan minat (traffic, engagement); BOF = mendorong aksi (penjualan/install). Tahap ditentukan dari tipe objective kampanye di TikTok.',
  },
  {
    term: 'Benchmark',
    definition:
      'Angka pembanding untuk menilai hasil: bisa target industri/yang ditetapkan AM, atau hasil periode sebelumnya (tertera di bagian atas laporan dan di tiap bagian).',
  },
  {
    term: 'Periode pembanding',
    definition: 'Periode berdurasi sama yang tepat sebelum periode laporan. Dipakai untuk kolom growth (%) dan bagian tren.',
  },
  { term: 'Growth (%)', definition: 'Perubahan dibanding periode pembanding.', formula: '(Periode ini − Periode sebelumnya) ÷ Periode sebelumnya' },
  { term: 'Gap', definition: 'Selisih hasil aktual terhadap benchmark, dalam persen dari benchmark.', formula: '(Aktual − Benchmark) ÷ Benchmark' },
  { term: 'Satuan angka', definition: 'Rb = ribu, Jt = juta, M = miliar (mis. Rp155,7Jt = Rp155,7 juta; Rp1,8M = Rp1,8 miliar).' },
  { term: 'n/a / "belum diatur"', definition: 'n/a = data tidak tersedia/tidak bisa dihitung; "belum diatur" = benchmark untuk metrik itu belum diisi, sehingga tidak dinilai.' },
];

export function buildLegend(template: NorthStar): LegendGroup[] {
  const keys = new Set<string>(EXTRA_METRICS[template]);
  for (const section of BENCHMARK_LAYOUT[template]) {
    for (const m of section.metrics) keys.add(m.metric);
  }
  const seen = new Set<string>();
  const metricEntries: LegendEntry[] = [];
  for (const key of keys) {
    const entry = METRIC_LEGEND[key];
    if (entry && !seen.has(entry.term)) {
      seen.add(entry.term);
      metricEntries.push(entry);
    }
  }
  const termEntries = EXTRA_TERMS[template].filter((e) => !seen.has(e.term));
  return [
    STATUS_GROUP,
    { title: 'Metrik & Istilah Performa', entries: [...termEntries, ...metricEntries] },
    { title: 'Sumber Data & Istilah Umum', entries: GENERAL_TERMS },
  ];
}
