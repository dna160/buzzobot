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

/** "4 dari 6 sinyal tersedia" — the counted denominator, wired at M3. */
export function coverageLine(available: number, total: number): string {
  return `${available} dari ${total} sinyal tersedia`;
}
