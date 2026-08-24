import { BriefObjective, METRICS, type MetricKey } from '@tempo/core';
import type { DeckTier, Light } from './model.js';

/**
 * Every string the deck prints, in one place (Brief Deck PRD §6, K7).
 *
 * Bahasa-only by design: the engine narrates in Bahasa already (engine PRD §7),
 * and a deck that mixes an Indonesian analysis with English furniture reads as
 * a machine translation of itself. `lang` is accepted by the route so existing
 * callers do not break, but there is no English deck — saying so plainly is
 * better than shipping a half-translated one.
 *
 * This is deliberately small. Metric labels come from `MetricDef.labelId`, not
 * from here; the only exception is the override map below.
 */

export const DECK_COPY = {
  slideTitles: {
    s1: 'Ringkasan',
    s2: 'Tren Harian',
    s3: 'Kinerja Kampanye',
    s4: {
      awareness: 'Frekuensi & Jangkauan Efektif',
      gmv: 'Funnel & Komposisi Penjualan',
      install: 'Kebocoran Funnel & Kualitas Kohort',
    },
    s5: 'Video Terbaik',
    s6: 'Risiko & Rencana Aksi',
    appendixA: 'Lampiran A — Data Mentah',
    appendixB: 'Lampiran B — Semua Video',
    appendixC: 'Lampiran C — Internal',
  },
  objectiveLabels: {
    awareness: 'Laporan Awareness',
    gmv: 'Laporan Penjualan',
    install: 'Laporan Instal Aplikasi',
  },
  tierBadges: {
    instant: 'Ringkas',
    full: 'Analisis Lengkap',
  },
  tierNotes: {
    instant:
      'Deck ringkas — angka dan temuan dihitung penuh, narasi memakai templat baku. ' +
      'Analisis lengkap menyusul otomatis.',
    full: 'Analisis lengkap — narasi disusun dan diperiksa oleh lapisan analitik.',
  },
  tables: {
    campaignHeaders: ['Kampanye', 'Biaya', 'Impresi', 'Klik', 'CTR', 'Status'],
    funnelHeaders: ['Tahap', 'Jumlah', 'Rasio dari tahap sebelumnya'],
    dayHeader: 'Tanggal',
    emptyCampaigns: 'Tidak ada kampanye yang berjalan pada periode ini.',
    emptyDays: 'Tidak ada hari dengan data pada periode ini.',
  },
  roadmap: {
    headers: ['Prioritas', 'Aksi', 'Pemilik', 'Dampak', 'Bukti'],
    empty: 'Tidak ada risiko material yang teridentifikasi pada periode ini.',
  },
  labels: {
    period: 'Periode',
    generated: 'Dibuat',
    previousPeriod: 'vs periode sebelumnya',
    outlook: 'Proyeksi',
    confidence: 'Tingkat keyakinan',
    suggested: 'disarankan',
    noMaterialFindings: 'Tidak ada temuan material periode ini.',
    notReported: '—',
    reachCaveat:
      'Jangkauan tingkat akun adalah penjumlahan jangkauan kampanye, sehingga merupakan ' +
      'batas atas — audiens yang beririsan antar kampanye belum dikurangi.',
  },
  footer: {
    engine: 'Mesin analitik',
    run: 'ID proses',
    probes: 'Probe',
    fallback: 'Catatan',
    legacyContent:
      'Brief ini dibuat sebelum mesin analitik mengekspor temuan — hanya narasi yang tersedia.',
  },
  confidence: {
    high: 'tinggi',
    medium: 'sedang',
    low: 'rendah',
  },
} as const;

/**
 * Objective-specific label overrides. `conversions` is the honest key for what
 * Tempo stores, but an install client reads "Instal", not "Konversi" — the same
 * column means a different word to a different brand. An explicit override map
 * keeps `labelId` as the default and makes each exception reviewable, instead
 * of forking the catalog per objective.
 */
const LABEL_OVERRIDES: Partial<Record<BriefObjective, Partial<Record<MetricKey, string>>>> = {
  [BriefObjective.Install]: {
    conversions: 'Instal',
    cpa: 'Biaya per Instal (CPI)',
    conversionRate: 'Rasio Instal',
  },
  [BriefObjective.Gmv]: {
    conversions: 'Pesanan',
    conversionValue: 'Omzet (GMV)',
    cpa: 'Biaya per Pesanan',
  },
};

/** The label a slide prints for a metric. Never the `MetricKey` (PRD §3.4). */
export function metricLabel(metric: MetricKey, objective: BriefObjective): string {
  return LABEL_OVERRIDES[objective]?.[metric] ?? METRICS[metric].labelId;
}

export function objectiveLabel(objective: BriefObjective): string {
  return DECK_COPY.objectiveLabels[objective];
}

export function tierBadge(tier: DeckTier): string {
  return DECK_COPY.tierBadges[tier];
}

/**
 * What a light means, spelled out. Plan_Template's semantics: green = tambah
 * anggaran, yellow = pertahankan, red = evaluasi. Printed next to a row action
 * so a colour never has to be interpreted from context alone.
 */
export function lightAction(light: Light): string | undefined {
  switch (light) {
    case 'green':
      return 'Tambah anggaran';
    case 'yellow':
      return 'Pertahankan';
    case 'red':
      return 'Evaluasi';
    default:
      return undefined;
  }
}

/**
 * Bahasa labels for evidence-dict keys (M3).
 *
 * `MetricDef.labelId` covers the catalog, but a finding's `evidence` keys are
 * the engine's own vocabulary — `aov_contribution`, `top1_share` — and a chip
 * labelled in English on an Indonesian deck breaks §3.4's rule just as surely
 * as printing a `MetricKey` would. Unknown keys fall back to a humanized form
 * rather than blocking a card: a slightly technical label is recoverable, a
 * missing card is not.
 */
const EVIDENCE_LABELS: Record<string, string> = {
  active_day_coverage_pct: 'Cakupan hari aktif',
  assessed_confidence: 'Tingkat keyakinan',
  cohort_median: 'Median kohort',
  cohort_median_roi: 'ROI median kohort',
  cohort_size: 'Ukuran kohort',
  current_active_days: 'Hari aktif periode ini',
  current_per_day: 'Rata-rata per hari',
  current_value: 'Nilai periode ini',
  delta: 'Selisih',
  entity_count: 'Jumlah entitas',
  gini: 'Ketimpangan (Gini)',
  gmv_share: 'Porsi omzet',
  hhi: 'Konsentrasi (HHI)',
  metric: 'Metrik',
  missing_preferred_metrics: 'Metrik pendukung yang hilang',
  missing_required_metrics: 'Metrik wajib yang hilang',
  nominal_delta_pct: 'Selisih nominal',
  orders_per_1000_views: 'Pesanan per 1.000 tontonan',
  outcome_metric: 'Metrik hasil',
  per_active_day_delta_pct: 'Selisih per hari aktif',
  primary_outcome: 'Hasil utama',
  prior_active_days: 'Hari aktif periode lalu',
  prior_per_day: 'Rata-rata per hari (lalu)',
  prior_value: 'Nilai periode lalu',
  product_count: 'Jumlah produk',
  recency_lag_days: 'Jeda data (hari)',
  top1_share: 'Porsi kontributor teratas',
  top1_value: 'Nilai kontributor teratas',
  total: 'Total',
  total_cost: 'Total biaya',
  total_gmv: 'Total omzet',
  z_score: 'Skor z',
};

/** Stems that compose with the `_current` / `_prior` / `_contribution` suffixes. */
const EVIDENCE_TERMS: Record<string, string> = {
  aov: 'Nilai pesanan',
  clicks: 'Klik',
  cost: 'Biaya',
  ctr: 'CTR',
  cvr: 'CVR',
  frequency: 'Frekuensi',
  gmv: 'Omzet',
  impressions: 'Impresi',
  installs: 'Instal',
  orders: 'Pesanan',
  reach: 'Jangkauan',
  roi: 'ROI',
  value: 'Nilai',
  vtr6s: 'VTR 6 detik',
  vtr15s: 'VTR 15 detik',
};

const SUFFIXES: Array<[string, (term: string) => string]> = [
  ['_contribution', (term) => `Kontribusi ${term.toLowerCase()}`],
  ['_current', (term) => `${term} periode ini`],
  ['_prior', (term) => `${term} periode lalu`],
  ['_share', (term) => `Porsi ${term.toLowerCase()}`],
];

/** The label a chip prints for an evidence key. */
export function evidenceLabel(key: string): string {
  const direct = EVIDENCE_LABELS[key];
  if (direct) return direct;

  for (const [suffix, compose] of SUFFIXES) {
    if (!key.endsWith(suffix)) continue;
    const term = EVIDENCE_TERMS[key.slice(0, -suffix.length)];
    if (term) return compose(term);
  }

  const term = EVIDENCE_TERMS[key];
  if (term) return term;

  const spaced = key.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "4 dari 6 sinyal tersedia" — the counted denominator, wired at M3. */
export function coverageLine(available: number, total: number): string {
  return `${available} dari ${total} sinyal tersedia`;
}
