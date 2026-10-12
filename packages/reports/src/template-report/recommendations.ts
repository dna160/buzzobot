import { shortName } from './area.js';
import type { RankedSource, SourceRanking } from './breakdown.js';
import type { FunnelStage, ProductRecommendation, Status } from './rubric.js';

/**
 * Rule-based "what to do next" for the Template Report — concrete budget
 * moves and strategy steps derived from the already-computed tables, never
 * from an LLM. The same inputs always produce the same rows (stable ordering,
 * no randomness), so a re-generated report recommends the same thing; the
 * narrative layer only writes a summary paragraph *about* these rows.
 *
 * Estimates are deliberately conservative and labelled as indicative: a
 * source that is efficient at its current spend rarely stays that efficient
 * when scaled, so the recipient's marginal efficiency is assumed to be half
 * of its current average, and a move is only recommended if it still pays off
 * under that assumption.
 */

export type Priority = 'P1' | 'P2' | 'P3';

export interface RecommendationRow {
  prioritas: Priority;
  area: string;
  /** What to do. */
  langkah: string;
  /** The budget move or the strategy stance — how much, from where to where. */
  alokasi: string;
  /** The numbers that justify it. */
  dasar: string;
  /** What success looks like. */
  target: string;
  timeline: string;
}

export interface FunnelPlanRow {
  stage: string;
  saatIni: string;
  usulan: string;
  perubahan: string;
}

export interface RecommendationSet {
  rows: RecommendationRow[];
  /** Proposed next-period split of the same total budget across the funnel. */
  funnelPlan: FunnelPlanRow[];
  funnelPlanNote: string;
}

export interface RecMetric {
  /** `${objective}:${metric}`, the key into the playbook. */
  key: string;
  label: string;
  section: string;
  status: Status;
  scored: boolean;
  actual: string;
  benchmark: string;
  gap: string;
  higherIsBetter: boolean;
}

export interface RecSourceContext {
  ranking: SourceRanking;
  /** What a unit of output is, e.g. "Revenue", "Install", "Reach". */
  outputLabel: string;
  /** The metric name readers know, e.g. "ROI", "CPI", "Cost per 1.000 Reach". */
  efficiencyLabel: string;
  fmt: {
    money: (n: number) => string;
    output: (n: number) => string;
    /** output ÷ spend → the readable metric. */
    efficiency: (outputPerSpend: number) => string;
  };
  /** A donor this bad is a P1 (default: produced nothing). e.g. ROI below 1x loses money. */
  isCritical?: (donor: RankedSource) => boolean;
}

export interface RecommendationInput {
  money: (n: number) => string;
  funnel: {
    spendByStage: Record<FunnelStage, number>;
    ranges: Record<FunnelStage, [number, number]>;
  };
  metrics: RecMetric[];
  sources?: RecSourceContext;
  creatives: Array<{ name: string; status: 'Winning' | 'Watch' | 'Underperform' }>;
  products?: Array<{ name: string; rec: ProductRecommendation; roi: string }>;
  concentration?: { name: string; share: number; status: Status; noun: 'produk' | 'campaign'; limitLabel: string };
}

const STAGES: FunnelStage[] = ['awareness', 'consideration', 'conversion'];
const STAGE_LABEL: Record<FunnelStage, string> = {
  awareness: 'Awareness (TOF)',
  consideration: 'Consideration (MOF)',
  conversion: 'Conversion (BOF)',
};
const TIMELINE: Record<Priority, string> = {
  P1: '0–3 hari',
  P2: '1–2 minggu',
  P3: 'Siklus berikutnya (2–4 minggu)',
};
const PRIORITY_ORDER: Record<Priority, number> = { P1: 0, P2: 1, P3: 2 };
const STATUS_ORDER: Record<Status, number> = { Kritis: 0, Waspada: 1, Baik: 2 };

/** Recommended-action text per benchmark metric, keyed `${objective}:${metric}` (a bare metric key is the fallback). */
export const PLAYBOOK: Record<string, string> = {
  // GMV / TikTok Shop
  'awareness:cpm': 'Tekan CPM: refresh creative TOF, tes 2–3 audiens baru, hindari audiens yang terlalu sempit.',
  'awareness:ctr': 'Naikkan CTR: uji hook 3 detik pertama dan CTA yang lebih jelas lewat A/B test 2–3 varian.',
  'awareness:vtr': 'Perkuat hook 3 detik pertama dan jaga durasi 15–25 detik; buang opening yang lambat.',
  'consideration:ctr': 'Naikkan CTR: ganti creative ber-CTR rendah dan uji CTA yang lebih spesifik.',
  'consideration:cpc': 'Turunkan CPC: arahkan ke audiens yang sudah engaged dan matikan creative ber-CTR rendah.',
  'consideration:cost_per_atc': 'Turunkan biaya add-to-cart: perjelas manfaat produk di creative dan perbaiki halaman produk.',
  'conversion:roi': 'Naikkan ROI: pindahkan budget ke sumber ber-ROI tertinggi dan jeda sumber ber-ROI di bawah 1x (lihat tabel breakdown ROI di bagian 4).',
  'conversion:cvr': 'Naikkan CVR: perbaiki halaman produk/toko (harga, voucher, ulasan, stok) dan samakan penawaran di creative dengan halaman tujuan.',
  'conversion:cpa': 'Turunkan CPA: optimalkan creative dan penargetan campaign BOF, naikkan AOV lewat bundling atau voucher minimum belanja.',
  // Awareness
  'delivery:cpm': 'Tekan CPM: rotasi creative, perluas audiens, dan konsolidasi ad group yang terfragmentasi.',
  'delivery:cpmr': 'Turunkan biaya per 1.000 reach: perluas audiens dan pasang frequency cap agar budget tidak berulang ke orang yang sama.',
  'delivery:frequency': 'Frequency tinggi: pasang frequency cap atau perluas audiens, dan siapkan creative baru agar tidak jenuh.',
  'retention:vtr_6s': 'Perkuat hook 3 detik pertama; buang opening yang lambat dan tampilkan produk/pesan lebih cepat.',
  'retention:view_rate_2s': 'Perbaiki 2 detik pertama (visual dan audio pembuka) agar penonton tidak langsung scroll.',
  'retention:completion_p50': 'Percepat alur cerita agar penonton bertahan sampai pertengahan video.',
  'retention:completion_p100': 'Pangkas durasi atau padatkan pesan agar lebih banyak penonton menonton sampai akhir.',
  'retention:avg_play': 'Perkuat storytelling dan ritme video agar durasi tonton rata-rata naik.',
  'engagement:ctr': 'Naikkan CTR: perjelas CTA dan uji varian hook baru.',
  'engagement:engagement_rate': 'Tambahkan elemen interaktif (pertanyaan, ajakan komentar/share, tren atau sound yang relevan).',
  'engagement:profile_visit_rate': 'Tambahkan CTA ke profil dan alasan untuk follow (konten seri, penawaran khusus follower).',
  'engagement:cost_per_engagement': 'Alihkan budget ke creative dengan engagement rate tertinggi.',
  // App install
  'delivery:ctr': 'Naikkan CTR: uji hook dan CTA unduh yang lebih jelas.',
  'delivery:cpc': 'Turunkan CPC: matikan creative ber-CTR rendah dan fokuskan budget ke audiens dengan klik termurah.',
  'install:cpi': 'Turunkan CPI: scale campaign/creative ber-CPI terendah dan jeda yang tidak menghasilkan install.',
  'install:install_rate': 'Naikkan install rate: samakan pesan creative dengan halaman app store, perbaiki screenshot/rating, dan cek tracking.',
  'install:installs_per_1k': 'Naikkan install per 1.000 impresi: perkuat CTA unduh dan targetkan audiens yang relevan.',
  'quality:registration_rate': 'Perbaiki onboarding (kurangi langkah registrasi) dan optimalkan ke event registrasi, bukan hanya install.',
  'quality:cost_per_registration': 'Optimalkan campaign ke event registrasi (AEO) dan alihkan budget ke campaign dengan biaya registrasi terendah.',
};

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
/** Names in the recommendation text get more room than a table cell, and keep their distinguishing tail. */
const nm = (name: string): string => shortName(name, 46);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const pct1 = (v: number): string => `${(v * 100).toFixed(1)}%`;
const rangeText = ([lo, hi]: [number, number]): string => `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`;
const signed = (n: number): string => (n >= 0 ? '+' : '−');

/**
 * The nearest in-range split of the same budget: every stage is pulled to its
 * range, and whatever that frees up or needs is spread over the stages that
 * still have room, in proportion to that room. A split that is already in
 * range comes back unchanged.
 */
export function proposeFunnelAllocation(
  pct: Record<FunnelStage, number>,
  ranges: Record<FunnelStage, [number, number]>,
): Record<FunnelStage, number> {
  const p = {} as Record<FunnelStage, number>;
  for (const s of STAGES) p[s] = clamp(pct[s], ranges[s][0], ranges[s][1]);
  for (let iter = 0; iter < 8; iter += 1) {
    const diff = 1 - sum(STAGES.map((s) => p[s]));
    if (Math.abs(diff) < 1e-9) break;
    const room = STAGES.map((s) => Math.max(0, diff > 0 ? ranges[s][1] - p[s] : p[s] - ranges[s][0]));
    const totalRoom = sum(room);
    if (totalRoom <= 1e-12) break;
    const move = Math.min(Math.abs(diff), totalRoom);
    STAGES.forEach((s, i) => {
      p[s] += (diff > 0 ? 1 : -1) * move * ((room[i] ?? 0) / totalRoom);
    });
  }
  return p;
}

function buildFunnel(input: RecommendationInput): {
  plan: FunnelPlanRow[];
  note: string;
  row: RecommendationRow | null;
} {
  const { spendByStage, ranges } = input.funnel;
  const total = sum(STAGES.map((s) => spendByStage[s]));
  if (total <= 0) return { plan: [], note: 'Belum ada spend pada periode ini.', row: null };

  const pct = {} as Record<FunnelStage, number>;
  for (const s of STAGES) pct[s] = spendByStage[s] / total;
  const proposed = proposeFunnelAllocation(pct, ranges);
  const out = STAGES.filter((s) => pct[s] < ranges[s][0] - 1e-9 || pct[s] > ranges[s][1] + 1e-9);

  const deltas = {} as Record<FunnelStage, number>;
  for (const s of STAGES) deltas[s] = (proposed[s] - pct[s]) * total;
  const material = (s: FunnelStage): boolean => Math.abs(deltas[s]) >= total * 0.005;

  const plan: FunnelPlanRow[] = STAGES.map((s) => ({
    stage: STAGE_LABEL[s],
    saatIni: `${input.money(spendByStage[s])} (${pct1(pct[s])})`,
    usulan: `${input.money(proposed[s] * total)} (${pct1(proposed[s])})`,
    perubahan: material(s)
      ? `${signed(deltas[s])}${input.money(Math.abs(deltas[s]))} (${signed(deltas[s])}${(Math.abs(proposed[s] - pct[s]) * 100).toFixed(1)}pp)`
      : 'Tetap',
  }));

  if (out.length === 0) {
    return { plan, note: 'Komposisi funnel sudah berada dalam rentang ideal — pertahankan.', row: null };
  }

  const up = STAGES.filter((s) => material(s) && deltas[s] > 0);
  const down = STAGES.filter((s) => material(s) && deltas[s] < 0);
  const moved = sum(up.map((s) => deltas[s]));
  const alokasi =
    `Geser ±${input.money(moved)} (${((moved / total) * 100).toFixed(1)}% dari total budget): ` +
    `${down.map((s) => `${STAGE_LABEL[s]} −${input.money(Math.abs(deltas[s]))}`).join(', ')} → ` +
    `${up.map((s) => `${STAGE_LABEL[s]} +${input.money(deltas[s])}`).join(', ')}. Total budget tetap.`;

  return {
    plan,
    note: 'Total budget tetap; usulan menggeser komposisi ke batas rentang ideal terdekat.',
    row: {
      prioritas: out.length >= 2 ? 'P1' : 'P2',
      area: 'Alokasi Budget Funnel',
      langkah: `Seimbangkan funnel: tambah budget ${up.map((s) => STAGE_LABEL[s]).join(' & ')}, kurangi ${down.map((s) => STAGE_LABEL[s]).join(' & ')}.`,
      alokasi,
      dasar: out.map((s) => `${STAGE_LABEL[s]} ${pct1(pct[s])} vs ideal ${rangeText(ranges[s])}`).join('; '),
      target: 'Seluruh tahap funnel berada dalam rentang ideal (lihat tabel usulan alokasi).',
      timeline: TIMELINE[out.length >= 2 ? 'P1' : 'P2'],
    },
  };
}

/** Budget moves from below-average sources to above-average ones, paired rank for rank. */
function buildSourceMoves(ctx: RecSourceContext, totalSpend: number): RecommendationRow[] {
  const { ranking, fmt } = ctx;
  const blended = ranking.blended;
  if (blended === null) return [];
  const critical = ctx.isCritical ?? ((d: RankedSource) => d.output === 0);
  const rows: RecommendationRow[] = [];
  const pairs = Math.min(ranking.top.length, ranking.bottom.length, 3);
  for (let i = 0; i < pairs; i += 1) {
    const recipient = ranking.top[i];
    const donor = ranking.bottom[i];
    if (!recipient || !donor) continue;
    if (donor.efficiency >= blended) continue; // only move money out of below-average sources
    if (recipient.efficiency < donor.efficiency * 1.2) continue; // not a meaningful difference
    const zero = donor.output === 0;
    const amount = Math.min(donor.spend * (zero ? 0.5 : 0.3), recipient.spend * 0.3);
    if (amount < totalSpend * 0.01) continue;
    // Conservative: the recipient keeps only half of its current efficiency on the extra money.
    const gain = amount * (0.5 * recipient.efficiency - donor.efficiency);
    if (gain <= 0) continue;
    const p: Priority = critical(donor) ? 'P1' : 'P2';
    const lowerOut = ctx.outputLabel.toLowerCase();
    rows.push({
      prioritas: p,
      area: `Realokasi Budget — ${ctx.efficiencyLabel}`,
      langkah: zero
        ? `Jeda/audit "${nm(donor.name)}" (${fmt.money(donor.spend)} belum menghasilkan ${lowerOut}), lalu alihkan ke "${nm(recipient.name)}".`
        : `Geser budget dari "${nm(donor.name)}" (${ctx.efficiencyLabel} ${fmt.efficiency(donor.efficiency)}) ke "${nm(recipient.name)}" (${ctx.efficiencyLabel} ${fmt.efficiency(recipient.efficiency)}).`,
      alokasi: `Geser ±${fmt.money(amount)} (${Math.round((amount / donor.spend) * 100)}% dari spend ${fmt.money(donor.spend)}); naikkan "${nm(recipient.name)}" bertahap ≤30% per 3 hari.`,
      dasar: `${ctx.efficiencyLabel} rata-rata ${fmt.efficiency(blended)}; "${nm(recipient.name)}" ${fmt.efficiency(recipient.efficiency)} vs "${nm(donor.name)}" ${fmt.efficiency(donor.efficiency)}.`,
      target: `Estimasi +${fmt.output(gain)} ${lowerOut} (indikatif, konservatif: efisiensi marginal ≈50% dari ${fmt.efficiency(recipient.efficiency)}).`,
      timeline: TIMELINE[p],
    });
  }
  return rows;
}

function buildMetricRows(metrics: RecMetric[]): RecommendationRow[] {
  const sections = new Map<string, RecMetric[]>();
  // The same metric can be graded under two sections (CTR sits in both
  // Awareness and Consideration) with an identical result; advise on it once,
  // under the first section it appears in.
  const advised = new Set<string>();
  for (const m of metrics) {
    if (!m.scored || m.status === 'Baik') continue;
    const signature = `${m.label}|${m.actual}|${m.benchmark}`;
    if (advised.has(signature)) continue;
    advised.add(signature);
    const list = sections.get(m.section) ?? [];
    list.push(m);
    sections.set(m.section, list);
  }
  const rows: RecommendationRow[] = [];
  for (const [section, list] of sections) {
    const weak = [...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]).slice(0, 2);
    const kritis = weak.some((m) => m.status === 'Kritis');
    const p: Priority = kritis ? 'P1' : 'P2';
    rows.push({
      prioritas: p,
      area: section,
      langkah: weak.map((m) => PLAYBOOK[m.key] ?? `Evaluasi ${m.label} dan telusuri penyebabnya.`).join(' '),
      alokasi: kritis
        ? 'Tahan scale-up budget di area ini; sisihkan ±15% budget untuk A/B test perbaikan.'
        : 'Budget tetap; sisihkan ±10% untuk A/B test perbaikan.',
      dasar: weak.map((m) => `${m.label} ${m.actual} vs ${m.benchmark} (${m.gap}, ${m.status})`).join('; '),
      target: weak.map((m) => `${m.label} ${m.higherIsBetter ? '≥' : '≤'} ${m.benchmark}`).join('; '),
      timeline: TIMELINE[p],
    });
  }
  return rows;
}

function buildCreativeRows(creatives: RecommendationInput['creatives']): RecommendationRow[] {
  const rows: RecommendationRow[] = [];
  const names = (s: 'Winning' | 'Watch' | 'Underperform') =>
    creatives.filter((c) => c.status === s).map((c) => `"${nm(c.name)}"`);
  const under = names('Underperform');
  const win = names('Winning');
  if (under.length > 0) {
    rows.push({
      prioritas: 'P2',
      area: 'Creative',
      langkah: `Jeda atau refresh creative underperform: ${under.join(', ')}.`,
      alokasi: 'Alihkan budget creative ini ke creative Winning atau varian baru; jangan tambah budget sebelum diperbaiki.',
      dasar: `${under.length} dari ${creatives.length} creative teratas berstatus Underperform.`,
      target: 'Tidak ada creative Underperform di lima besar spend.',
      timeline: TIMELINE.P2,
    });
  }
  if (win.length > 0) {
    rows.push({
      prioritas: 'P3',
      area: 'Creative',
      langkah: `Scale up creative Winning: ${win.join(', ')} — duplikasi angle/format dan buat 2–3 variasi.`,
      alokasi: 'Naikkan budget creative Winning +20–30% bertahap selama metrik utamanya bertahan.',
      dasar: `${win.length} dari ${creatives.length} creative teratas berstatus Winning.`,
      target: 'Jumlah creative Winning bertambah di periode berikutnya.',
      timeline: TIMELINE.P3,
    });
  } else if (creatives.length > 0 && under.length === 0) {
    rows.push({
      prioritas: 'P2',
      area: 'Creative',
      langkah: 'Belum ada creative Winning: produksi 3–5 creative baru dengan angle berbeda untuk A/B test.',
      alokasi: 'Sisihkan ±10–15% budget untuk menguji creative baru.',
      dasar: `0 dari ${creatives.length} creative teratas berstatus Winning.`,
      target: 'Minimal 1 creative Winning pada periode berikutnya.',
      timeline: TIMELINE.P2,
    });
  }
  return rows;
}

function buildProductRows(input: RecommendationInput): RecommendationRow[] {
  const rows: RecommendationRow[] = [];
  const scale = (input.products ?? []).filter((p) => p.rec === 'Scale Up');
  const optimize = (input.products ?? []).filter((p) => p.rec === 'Optimize');
  if (scale.length > 0) {
    rows.push({
      prioritas: 'P2',
      area: 'Produk Andalan',
      langkah: `Scale up produk: ${scale.map((p) => `"${nm(p.name)}"`).join(', ')}.`,
      alokasi: 'Naikkan budget GMV Max produk ini +20–30% bertahap (tiap 3–4 hari) selama ROI tetap ≥ target.',
      dasar: scale.map((p) => `${nm(p.name)} ROI ${p.roi}`).join('; '),
      target: 'ROI tetap ≥ target saat budget naik.',
      timeline: TIMELINE.P2,
    });
  }
  if (optimize.length > 0) {
    rows.push({
      prioritas: 'P2',
      area: 'Produk Andalan',
      langkah: `Audit dan optimasi produk: ${optimize.map((p) => `"${nm(p.name)}"`).join(', ')}.`,
      alokasi: 'Tahan budget; perbaiki harga/penawaran/creative, lalu evaluasi ulang setelah 7 hari.',
      dasar: optimize.map((p) => `${nm(p.name)} ROI ${p.roi}`).join('; '),
      target: 'ROI naik ke ≥ target dalam 7–14 hari, atau kurangi budget.',
      timeline: TIMELINE.P2,
    });
  }
  return rows;
}

export function buildRecommendations(input: RecommendationInput): RecommendationSet {
  const totalSpend = sum(STAGES.map((s) => input.funnel.spendByStage[s]));
  const funnel = buildFunnel(input);

  const rows: RecommendationRow[] = [
    ...(input.sources ? buildSourceMoves(input.sources, totalSpend) : []),
    ...(funnel.row ? [funnel.row] : []),
    ...buildMetricRows(input.metrics),
    ...buildProductRows(input),
    ...buildCreativeRows(input.creatives),
  ];

  const c = input.concentration;
  if (c && c.status !== 'Baik') {
    // Diversify by adding other sources, never by cutting the big one: it is
    // usually the big one *because* it is efficient, and the budget-move rows
    // above may be scaling it up. The two pieces of advice must not collide.
    rows.push({
      prioritas: 'P2',
      area: 'Konsentrasi',
      langkah: `Kembangkan ${c.noun} lain sebagai sumber hasil tambahan agar tidak bergantung pada "${nm(c.name)}".`,
      alokasi: `Jangan memotong budget "${nm(c.name)}" selama efisiensinya masih di atas rata-rata; alokasikan ±10–15% budget baru ke ${c.noun} lain yang efisien agar porsinya turun bertahap.`,
      dasar: `"${nm(c.name)}" = ${pct1(c.share)} dari total (batas aman ${c.limitLabel}).`,
      target: `Porsi ${c.noun} terbesar ${c.limitLabel} tanpa menurunkan hasil total.`,
      timeline: TIMELINE.P2,
    });
  }

  // Stable sort by priority; the insertion order above is the tie-break.
  const sorted = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => PRIORITY_ORDER[a.r.prioritas] - PRIORITY_ORDER[b.r.prioritas] || a.i - b.i)
    .map((x) => x.r)
    .slice(0, 8);

  if (totalSpend <= 0) {
    // No spend at all is "nothing to judge", not "everything is fine" — say so
    // instead of telling the reader to keep doing what they are (not) doing.
    return {
      rows: [
        {
          prioritas: 'P1',
          area: 'Data Periode',
          langkah:
            'Tidak ada spend pada periode ini, sehingga tidak ada rekomendasi budget atau strategi yang bisa disusun. Periksa rentang tanggal laporan serta status akun dan kampanye.',
          alokasi: 'Tidak ada perubahan budget yang dapat direkomendasikan.',
          dasar: 'Total spend periode ini Rp0.',
          target: 'Data spend tersedia pada periode laporan.',
          timeline: TIMELINE.P1,
        },
      ],
      funnelPlan: funnel.plan,
      funnelPlanNote: funnel.note,
    };
  }

  if (sorted.length === 0) {
    sorted.push({
      prioritas: 'P3',
      area: 'Keseluruhan',
      langkah: 'Pertahankan strategi dan alokasi saat ini; lanjutkan pemantauan mingguan.',
      alokasi: 'Budget tetap; sisihkan ±10% untuk menguji creative atau audiens baru.',
      dasar: 'Seluruh area yang dinilai berada pada atau di atas target.',
      target: 'Pertahankan seluruh metrik di atas target.',
      timeline: TIMELINE.P3,
    });
  }

  return { rows: sorted, funnelPlan: funnel.plan, funnelPlanNote: funnel.note };
}
