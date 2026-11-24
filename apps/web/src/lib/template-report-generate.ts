import {
  fetchNorthStarRawData,
  fetchTemplateReportRawData,
  listBenchmarks,
  type ClientSummary,
  type createSourcePool,
  type getDb,
} from '@tempo/db';
import { renderNorthStarReportHtml, renderTemplateReportHtml } from '@tempo/reports';
import { assembleNorthStarReportModel, computeNorthStarReportFacts } from '@/lib/north-star-report-pipeline';
import { assembleTemplateReportModel, computeTemplateReportFacts } from '@/lib/template-report-pipeline';
import { generateNorthStarNarratives, generateTemplateReportNarratives } from '@/lib/template-report-narrative';

/**
 * One Template Report, start to finish: raw source rows → deterministic facts
 * → six LM Studio narrative blocks → HTML. Shared by the API route
 * (`/api/reports/:slug/template-report`) and the shared link (`/r/:token`), so
 * the two can never drift into rendering different reports for the same input.
 */

export type TemplateReportTemplate = 'shop' | 'vtr' | 'app_install';
export type TemplateReportBenchmarkMode = 'industry' | 'previous_period';

/**
 * Narrative generation gave up after its retries. There is deliberately no
 * placeholder prose to fall back to (see `template-report-narrative.ts`), so
 * this fails the report; callers answer 502.
 */
export class NarrativeGenerationError extends Error {
  constructor(cause: unknown) {
    super('Narrative generation (LM Studio) failed after repeated retries — see server logs', { cause });
    this.name = 'NarrativeGenerationError';
  }
}

export interface GeneratedTemplateReport {
  html: string;
  periodStart: string;
  periodEndExclusive: string;
}

export async function generateTemplateReport(input: {
  db: ReturnType<typeof getDb>['db'];
  pool: NonNullable<ReturnType<typeof createSourcePool>>;
  client: ClientSummary;
  tiktokAdAccountIds: string[];
  template: TemplateReportTemplate;
  benchmarkMode: TemplateReportBenchmarkMode;
  /** Exclusive-end convention ([start, end)); both optional — see `fetchTemplateReportRawData`. */
  windowStart?: string;
  windowEnd?: string;
}): Promise<GeneratedTemplateReport> {
  const { db, pool, client, tiktokAdAccountIds, benchmarkMode, windowStart, windowEnd } = input;
  const benchmarks = await listBenchmarks(db, client.id);

  // GMV/TikTok Shop is the original report; Awareness (`vtr`) and App Install
  // are variants with the same 8-section skeleton.
  const northStar = input.template;

  if (northStar === 'vtr' || northStar === 'app_install') {
    const raw = await fetchNorthStarRawData(pool, { tiktokAdAccountIds, windowStart, windowEnd });
    const facts = computeNorthStarReportFacts({ client, raw, northStar, benchmarks, benchmarkMode });
    let narratives;
    try {
      narratives = await generateNorthStarNarratives(northStar, {
        execSummary: { kpis: facts.kpiGroups, areas: facts.areaRows },
        budgetAllocation: { benchmarkSource: facts.benchmarkSource.label, rows: facts.funnelRows },
        efficiency: { benchmarkSource: facts.benchmarkSource.label, sections: facts.benchmarkSections },
        trend: facts.trendRows,
        sources: facts.sourceBreakdown,
        campaigns: facts.campaignTable.rows.map((r) => r.cells),
        creatives: facts.creativeTable.rows.map((r) => r.cells),
        recommendations: facts.recommendations,
      });
    } catch (err) {
      console.error('[template-report] narrative generation failed after retries:', err);
      throw new NarrativeGenerationError(err);
    }
    return {
      html: renderNorthStarReportHtml(assembleNorthStarReportModel(facts, narratives)),
      periodStart: raw.windowStart,
      periodEndExclusive: raw.windowEnd,
    };
  }

  const raw = await fetchTemplateReportRawData(pool, { tiktokAdAccountIds, windowStart, windowEnd });

  // Compute every table/status first — pure functions of raw + benchmarks,
  // no LM Studio involved. Narrative prompts below are fed these already-
  // computed facts rather than raw totals: asking the model to derive
  // CPM/CTR/VTR/CPC/ROI/CVR/CPA itself before writing a word of prose
  // reliably burned its whole token budget on arithmetic and came back empty.
  const facts = computeTemplateReportFacts({ client, raw, benchmarks, benchmarkMode });

  // No placeholder fallback, by explicit request: each prompt retries on
  // its own (see `tryWriteNarrative`), and only gives up after repeated
  // failures — at which point this genuinely should fail the report rather
  // than ship fake "insight unavailable" prose.
  let narratives;
  try {
    narratives = await generateTemplateReportNarratives({
      execSummary: { kpis: facts.kpis, areas: facts.areaRows },
      budgetAllocation: { benchmarkSource: facts.benchmarkSource.label, rows: facts.funnelRows },
      efficiency: { benchmarkSource: facts.benchmarkSource.label, sections: facts.benchmarkSections },
      trend: facts.trendRows,
      roi: facts.roiBreakdown,
      products: facts.productRows,
      creatives: facts.creativeRows,
      recommendations: facts.recommendations,
    });
  } catch (err) {
    console.error('[template-report] narrative generation failed after retries:', err);
    throw new NarrativeGenerationError(err);
  }
  return {
    html: renderTemplateReportHtml(assembleTemplateReportModel(facts, narratives)),
    periodStart: raw.windowStart,
    periodEndExclusive: raw.windowEnd,
  };
}
