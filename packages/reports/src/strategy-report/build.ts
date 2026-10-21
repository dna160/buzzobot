import type { EngineBriefContentV2, EngineFinding } from '../deck/engine-content.js';
import { light } from '../deck/lights.js';
import {
  EngineStrategySectionDraftSchema,
  EngineVerdictDraftSchema,
  type EngineActionItem,
  type EngineStrategyCharts,
} from './engine-content.js';
import { compact, dec, idDate, idr, num, pct, rank } from './format.js';
import type {
  ActionRowModel,
  ContentMixModel,
  FunnelBarModel,
  LogRowModel,
  ReportClass,
  SectionVisual,
  StrategyReportModel,
  StrategySectionModel,
} from './model.js';

/**
 * Engine content → `StrategyReportModel`. Pure. The engine has already chosen,
 * ranked, computed and written; this decides only arrangement (the class's
 * section order), labels, and number formatting.
 */

export const SECTION = {
  T1: 101,
  T2: 102,
  T3: 103,
  T4: 104,
  T5: 105,
  T6: 106,
  T7: 107,
  T8: 108,
  T9: 109,
  LAMPIRAN: 110,
} as const;

const TITLES: Record<number, string> = {
  103: 'Di mana funnel bocor',
  104: 'Apa yang dibeli oleh belanja iklan',
  105: 'Laju menuju target',
  107: 'Komposisi konten & efek tular',
  108: 'Peringatan dini',
  109: 'Log tindakan',
  110: 'Lampiran A — Data & definisi',
};
const T6_TITLE: Record<ReportClass, string> = { brand: 'Share of Voice & peringkat', shop: 'Konversi & product card' };
const KEY: Record<number, string> = { 103: 'T3', 104: 'T4', 105: 'T5', 106: 'T6', 107: 'T7', 108: 'T8', 109: 'T9', 110: 'Lampiran A' };

const STAGE: Record<string, string> = { acc: 'ACC', awareness: 'Awareness', consideration: 'Consideration', conversion: 'Conversion' };
const LEVER: Record<string, string> = {
  content_mix: 'Komposisi konten',
  budget_cap: 'Batas belanja',
  stage_targeting: 'Penargetan tahap',
  creative_refresh: 'Penyegaran kreatif',
  creator_boost: 'Boost kreator',
  investigate: 'Selidiki',
};
const CONFIDENCE: Record<string, string> = { high: 'Keyakinan tinggi', medium: 'Keyakinan sedang', low: 'Keyakinan rendah' };
const STAKE_UNIT: Record<string, string> = { people: 'orang', impressions: 'impresi', idr: '', ranks: 'peringkat' };
const CONTENT: Record<string, string> = {
  ads: 'Iklan',
  bgc_organic: 'Konten BGC internal (organik)',
  bgc_boosted: 'Konten BGC internal (di-boost)',
  creator_organic: 'Video kreator (organik)',
  creator_boosted: 'Video kreator (di-boost)',
  ugc_organic: 'Konten pengguna/UGC (organik)',
  ugc_boosted: 'Konten pengguna/UGC (di-boost)',
};
const GENERATOR: Record<string, string> = {
  T01: 'aliran tahap funnel',
  T02: 'respons belanja',
  T03: 'laju target',
  T04: 'komposisi konten',
  T05: 'pangsa kategori & peringkat',
  T06: 'pergerakan pesaing',
  T07: 'pencarian & sentimen',
  T08: 'lonjakan audiens keluar',
  T09: 'pemecah target',
  T10: 'cakupan data',
  T11: 'pengukuran ulang tindakan',
};

export interface BuildContext {
  clientName: string;
  slug: string;
  runId: string | null;
}

export class NotAStrategyReportError extends Error {
  constructor() {
    super('engine content is not a Strategy Report (brief_type must be "strategy")');
    this.name = 'NotAStrategyReportError';
  }
}

function selected(content: EngineBriefContentV2, sid: number): EngineFinding[] {
  const byId = new Map(content.findings.map((f) => [f.id, f]));
  return (content.rankings[String(sid)]?.selected ?? []).map((id) => byId.get(id)).filter((f): f is EngineFinding => !!f);
}

function draftOf(content: EngineBriefContentV2, sid: number) {
  const raw = content.sections[String(sid)]?.draft;
  const parsed = EngineStrategySectionDraftSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function actionRow(a: EngineActionItem, findings: Map<string, EngineFinding>): ActionRowModel {
  const stake = a.stake
    ? a.stake.unit === 'idr'
      ? `${idr(a.stake.value)} (rentang ${idr(a.stake.range[0])}–${idr(a.stake.range[1])})`
      : `${num(a.stake.value)} ${STAKE_UNIT[a.stake.unit]} (rentang ${num(a.stake.range[0])}–${num(a.stake.range[1])})`
    : null;
  const gens = [...new Set(a.evidence_refs.map((r) => findings.get(r)?.generator).filter((g): g is string => !!g))];
  return {
    rank: a.rank,
    priority: a.priority,
    leverLabel: LEVER[a.lever] ?? a.lever,
    langkah: a.copy?.langkah ?? '',
    dasar: a.copy?.dasar ?? '',
    cara: a.copy?.cara ?? '',
    gagalJika: a.copy?.gagal_jika ?? '',
    stake,
    confidenceLabel: CONFIDENCE[a.confidence] ?? a.confidence,
    sources: gens.length ? `Sumber: ${gens.map((g) => GENERATOR[g] ?? g).join(', ')} (TTMS)` : 'Sumber: TTMS',
  };
}

function funnelVisual(charts: EngineStrategyCharts): SectionVisual | null {
  if (!charts.funnel.length) return null;
  const bars: FunnelBarModel[] = charts.funnel.map((b, i) => {
    const next = charts.funnel[i + 1];
    const ratio = next && b.total && next.total != null ? next.total / b.total : null;
    const benchRatio = next && b.bench_total && next.bench_total != null ? next.bench_total / b.bench_total : null;
    const key = b.stage === 'awareness' || b.stage === 'consideration' ? (`ttms.audience.${b.stage}.size_ratio` as const) : null;
    return {
      stage: STAGE[b.stage] ?? b.stage,
      total: b.total,
      benchTotal: b.bench_total ?? null,
      rankLabel: rank(b.rank ?? null, b.rank_n ?? null),
      ratio: ratio != null && ratio <= 1 ? ratio : null,
      benchRatio: benchRatio != null && benchRatio <= 1 ? benchRatio : null,
      // Graded with the shared substrate (PRD D5): the benchmark is the target.
      light: key && ratio != null && ratio <= 1 && benchRatio ? light(key, { value: ratio, target: benchRatio, objective: 'gmv' }) : 'none',
    };
  });
  return { kind: 'funnel', bars };
}

function mixVisual(charts: EngineStrategyCharts): ContentMixModel | null {
  const by = new Map(charts.content_mix.map((m) => [m.content_type, m]));
  const paid = by.get('paid');
  const nonPaid = by.get('non_paid');
  if (!paid || !nonPaid) return null;
  return {
    paid: paid.share,
    nonPaid: nonPaid.share,
    subtypes: Object.keys(CONTENT)
      .map((ct) => by.get(ct))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map((m) => ({ label: CONTENT[m.content_type] ?? m.content_type, share: m.share, benchShare: m.bench_share })),
  };
}

export function buildStrategyReportModel(content: EngineBriefContentV2, ctx: BuildContext): StrategyReportModel {
  if (content.brief_type !== 'strategy' || !content.meta || !content.report_class) throw new NotAStrategyReportError();
  const meta = content.meta;
  const cls = content.report_class.report_class;
  const charts = content.charts ?? { funnel: [], rank_weekly: [], content_mix: [], stage_table: [] };
  const findings = new Map(content.findings.map((f) => [f.id, f]));

  const verdictRaw = EngineVerdictDraftSchema.safeParse(content.sections[String(SECTION.T1)]?.draft);
  const verdict = verdictRaw.success
    ? { headline: verdictRaw.data.headline, paragraph: verdictRaw.data.paragraph, chips: verdictRaw.data.chips.map((c) => ({ label: c.label, value: c.value, status: c.status })) }
    : { headline: `Ringkasan strategi ${meta.brand_name}`, paragraph: 'Vonis tidak tersedia untuk laporan ini.', chips: [] };

  const order = (meta.section_order.length ? meta.section_order : [101, 102, 103, 104, 105, 106, 107, 108, 109, 110]).filter(
    (s) => s !== SECTION.T1 && s !== SECTION.T2,
  );
  if (!order.includes(SECTION.LAMPIRAN)) order.push(SECTION.LAMPIRAN);

  const sections: StrategySectionModel[] = order.map((sid) => {
    const draft = draftOf(content, sid);
    const paragraphs = draft?.paragraphs.map((p) => p.text) ?? [];
    // An empty state's headline and paragraph are the same sentence; print it once.
    const headline = draft?.headline && !paragraphs[0]?.startsWith(draft.headline.replace(/\.$/, '')) ? draft.headline : '';
    const s: StrategySectionModel = {
      id: sid,
      key: KEY[sid] ?? String(sid),
      title: sid === SECTION.T6 ? T6_TITLE[cls] : (TITLES[sid] ?? String(sid)),
      headline,
      paragraphs,
      visual: null,
      signals: [],
      log: [],
      table: null,
      notes: [],
    };
    if (sid === SECTION.T3) s.visual = funnelVisual(charts);
    if (sid === SECTION.T4 && charts.spend_response && charts.spend_response.points.length) {
      const f = selected(content, sid).find((x) => x.generator === 'T02') ?? content.findings.find((x) => x.generator === 'T02');
      s.visual = {
        kind: 'spend',
        chart: {
          stageLabel: STAGE[charts.spend_response.stage] ?? charts.spend_response.stage,
          lagDays: charts.spend_response.lag_days,
          points: charts.spend_response.points,
          fit: charts.spend_response.fit ?? null,
          showKnee: f?.claim_frame === 'spend_response_diminishing',
        },
      };
      s.notes.push('Korelasi, bukan sebab-akibat. Hari TTMS memakai UTC, hari iklan memakai waktu lokal akun (WIB).');
    }
    if (sid === SECTION.T5) {
      const g = content.goal_pace;
      const stage = g?.stage ?? 'consideration';
      const weekly = charts.rank_weekly.filter((r) => r.stage === stage).map((r) => ({ date: r.date, rank: r.rank }));
      if (weekly.length) {
        const n = charts.funnel.find((b) => b.stage === stage)?.rank_n ?? null;
        s.visual = {
          kind: 'rank',
          chart: {
            stageLabel: STAGE[stage] ?? stage,
            weekly,
            target: g && g.kind === 'rank' ? g.target : null,
            deadline: g?.deadline ?? null,
            projected: g && g.kind === 'rank' ? (g.projected ?? null) : null,
            projectedLow: g && g.kind === 'rank' ? (g.projected_low ?? null) : null,
            projectedHigh: g && g.kind === 'rank' ? (g.projected_high ?? null) : null,
            listSize: n,
          },
        };
      }
    }
    if (sid === SECTION.T6 && cls === 'brand' && charts.rank_list) {
      s.visual = {
        kind: 'ranklist',
        stageLabel: STAGE[charts.rank_list.stage] ?? charts.rank_list.stage,
        n: charts.rank_list.n,
        rows: charts.rank_list.rows.map((r) => ({
          rank: r.rank,
          brand: r.brand,
          own: r.own,
          movement: r.rank_7d == null ? '—' : r.rank_7d > r.rank ? `▲${r.rank_7d - r.rank}` : r.rank_7d < r.rank ? `▼${r.rank - r.rank_7d}` : '—',
        })),
      };
      s.notes.push('TikTok hanya membagikan peringkat merek lain, bukan angka mereka.');
    }
    if (sid === SECTION.T7) {
      const mix = mixVisual(charts);
      if (mix) s.visual = { kind: 'mix', mix };
      s.notes.push('Jenis konten saling tumpang tindih (video kreator yang di-boost juga dihitung sebagai iklan); hanya berbayar + non-berbayar yang berjumlah 100%.');
    }
    if (sid === SECTION.T8) {
      s.signals = (content.signals ?? []).map((x) => ({ status: x.status, title: x.title, detail: x.detail }));
      // The signal rows are T8's content; the draft only restates them.
      if (s.signals.length) {
        s.headline = '';
        s.paragraphs = [];
      }
    }
    if (sid === SECTION.T9) {
      s.log = (content.action_log ?? []).slice(0, 6).map(
        (l): LogRowModel => ({
          startedAt: idDate(l.started_at),
          langkah: l.langkah ?? l.metric_key,
          measured: l.start_value != null && l.measured_value != null ? `${dec(l.start_value, 4)} → ${dec(l.measured_value, 4)}` : '—',
          category: l.category_delta == null ? '—' : pct(l.category_delta, 1),
          verdict: l.verdict,
        }),
      );
    }
    if (sid === SECTION.LAMPIRAN) {
      s.table = {
        head: ['Tahap', 'Audiens', 'Baru (periode)', 'Keluar (periode)', 'Peringkat', 'Rata-rata Top 10'],
        rows: charts.stage_table.map((r) => [
          STAGE[r.stage] ?? r.stage,
          num(r.total),
          r.new ? num(r.new) : '—',
          r.outflow ? num(r.outflow) : '—',
          rank(r.rank, r.rank_n),
          compact(r.bench_total),
        ]),
      };
      const candidates = selected(content, sid).filter((f) => f.claim_frame === 'action_proposed');
      if (candidates.length) s.notes.push(`Kandidat berikutnya: ${candidates.map((f) => LEVER[String(f.evidence.lever)] ?? f.evidence.lever).join(', ')}.`);
      s.notes.push(
        'Definisi: “ukuran tahap X dibanding tahap Y” adalah perbandingan jumlah audiens dua tahap pada hari yang sama — bukan persentase orang yang berpindah tahap. ' +
          'Rata-rata Top 10 adalah rata-rata 10 merek teratas di kategori. Data TTMS bersifat harian (UTC) dan tersedia sekitar 3 hari setelah tanggalnya.',
      );
      s.notes.push(`Sumber: ${[...new Set(content.findings.map((f) => f.generator))].sort().map((g) => GENERATOR[g] ?? g).join(', ')}.`);
    }
    return s;
  });

  return {
    meta: {
      clientName: ctx.clientName,
      slug: ctx.slug,
      brandName: meta.brand_name,
      reportClass: cls,
      classLabel: cls === 'brand' ? 'Brand-heavy' : 'Shop-heavy',
      classOverridden: content.report_class.overridden,
      vertical: meta.vertical ?? null,
      plan: meta.is_lite ? 'Lite' : 'Full',
      asOf: meta.as_of,
      windowStart: meta.window_start,
      windowEnd: meta.window_end,
      tier: content.tier,
      runId: ctx.runId,
      engineVersion: content.engine_version,
      promptVersion: meta.prompt_version ?? null,
      degraded: meta.degraded,
    },
    verdict,
    actions: (content.action_plan ?? []).map((a) => actionRow(a, findings)),
    sections,
  };
}
