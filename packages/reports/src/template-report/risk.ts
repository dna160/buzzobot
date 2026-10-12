import type { TemplateReportRiskRow } from './model.js';
import type { Status } from './rubric.js';

/**
 * §7 "Risiko Utama": one row per health-check area that isn't Baik, with the
 * numbers behind it (the area's own "needs improvement" list) and what
 * happens if it is left alone. The *what to do* lives in §8 (Rekomendasi Next
 * Steps), so this table only states the risk. Deterministic and shared by
 * every template variant.
 */

/** What an unaddressed problem in each area costs, by area key. */
export const RISK_IMPACT: Record<string, string> = {
  funnel: 'Budget tidak seimbang antar tahap funnel: efisiensi biaya menurun dan pasokan audiens ke tahap conversion tidak terjaga.',
  conversion: 'ROI/CVR/CPA di bawah target: setiap rupiah iklan menghasilkan penjualan lebih sedikit sehingga profitabilitas iklan tertekan.',
  topfunnel: 'Biaya jangkauan dan kualitas traffic tidak efisien: audiens yang masuk ke funnel berkurang sehingga conversion ikut tertahan.',
  trend: 'Momentum menurun dibanding periode pembanding: target periode berikutnya berisiko tidak tercapai bila tren tidak dibalik.',
  concentration: 'Ketergantungan tinggi pada satu sumber: performa akun rentan anjlok jika sumber tersebut menurun atau jenuh.',
  creative: 'Creative kurang efektif atau mulai jenuh: CTR/VTR turun dan biaya per hasil naik.',
  delivery: 'Biaya delivery tinggi atau frequency berlebih: budget terbuang pada audiens yang sama atau tayangan yang mahal.',
  retention: 'Penonton berhenti menonton lebih awal: pesan brand kurang tersampaikan dan sinyal kualitas video melemah.',
  engagement: 'Interaksi rendah: konten kurang memicu respons sehingga nilai awareness yang dihasilkan lebih kecil dari biayanya.',
  install: 'CPI tinggi atau install rate rendah: biaya akuisisi user membengkak dan volume install sulit diskalakan.',
  quality: 'Banyak user yang install tetapi tidak registrasi: biaya per user aktif jauh lebih tinggi dari biaya per install.',
};

const DEFAULT_IMPACT = 'Area ini di bawah target dan berpotensi menekan hasil keseluruhan jika tidak ditangani.';

export function buildRisks(
  areas: Array<{ key: string; area: string; status: Status; improve: string }>,
): TemplateReportRiskRow[] {
  const rank = (s: Status): number => (s === 'Kritis' ? 0 : 1);
  return areas
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.status !== 'Baik')
    .sort((x, y) => rank(x.a.status) - rank(y.a.status) || x.i - y.i)
    .map(({ a }) => ({
      risiko: a.area,
      level: a.status === 'Kritis' ? ('High' as const) : ('Medium' as const),
      bukti: a.improve,
      dampak: RISK_IMPACT[a.key] ?? DEFAULT_IMPACT,
    }));
}
