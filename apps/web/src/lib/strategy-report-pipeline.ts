import {
  buildStrategyReportModel,
  parseEngineContent,
  renderStrategyReportHtml,
  type StrategyReportModel,
} from '@tempo/reports';

/**
 * The one assembly path for the Strategy Report (PRD §9.4): engine content →
 * validated → `StrategyReportModel` → A4 HTML. Both the route and the weekly
 * cron go through it, so a report cannot differ by which entry point made it.
 *
 * Nothing here computes a number: the engine computed every one, and the model
 * only arranges and formats them.
 */

const TEMPO_ENGINE_URL = process.env.TEMPO_ENGINE_URL ?? 'http://127.0.0.1:8001';

export interface StrategyEngineRequest {
  slug: string;
  tier: 'instant' | 'full';
  windowDays: number;
  endDate?: string;
  reportClass?: 'brand' | 'shop';
}

export interface StrategyEngineResult {
  runId: string;
  status: string;
  content: unknown;
}

export class StrategyEngineError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'StrategyEngineError';
  }
}

/** `POST /v1/briefs/sync` with `brief_type: strategy`; 404 = not eligible, anything else = 502. */
export async function requestStrategyRun(req: StrategyEngineRequest): Promise<StrategyEngineResult> {
  let res: Response;
  try {
    res = await fetch(`${TEMPO_ENGINE_URL}/v1/briefs/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_slug: req.slug,
        brief_type: 'strategy',
        window_days: req.windowDays,
        tier: req.tier,
        end_date: req.endDate ?? null,
        report_class: req.reportClass ?? null,
      }),
      cache: 'no-store',
    });
  } catch (err) {
    console.error('[strategy-report] tempo-engine request failed:', err);
    throw new StrategyEngineError(502, 'Strategy report service is unreachable');
  }
  if (res.status === 404) {
    throw new StrategyEngineError(404, (await res.text()) || `No Market Scope data for "${req.slug}"`);
  }
  if (!res.ok) {
    console.error(`[strategy-report] tempo-engine returned ${res.status}:`, await res.text());
    throw new StrategyEngineError(502, 'Failed to generate the strategy report');
  }
  const body = (await res.json()) as { run_id: string; status: string; content: unknown };
  return { runId: body.run_id, status: body.status, content: body.content };
}

export interface AssembledStrategyReport {
  model: StrategyReportModel;
  html: string;
  /** The window the engine actually reported on — the ledger's key. */
  periodStart: string;
  periodEnd: string;
}

/** Throws `ZodError` / `NotAStrategyReportError` on a content contract failure (a 502 at the route). */
export function assembleStrategyReport(input: {
  content: unknown;
  runId: string | null;
  clientName: string;
  slug: string;
}): AssembledStrategyReport {
  const { content } = parseEngineContent(input.content);
  const model = buildStrategyReportModel(content, { clientName: input.clientName, slug: input.slug, runId: input.runId });
  return {
    model,
    html: renderStrategyReportHtml(model),
    periodStart: model.meta.windowStart,
    periodEnd: model.meta.windowEnd,
  };
}

/**
 * Start a full-tier run without waiting for it (PRD §9.4, §13 #1): the engine
 * writes its row as `running` and returns the id at once. `auto_approve`
 * supplies the review gate's decision when the run reaches it, as `/sync` does.
 */
export async function startStrategyRun(req: Omit<StrategyEngineRequest, 'tier' | 'reportClass'>): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${TEMPO_ENGINE_URL}/v1/briefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_slug: req.slug,
        brief_type: 'strategy',
        window_days: req.windowDays,
        tier: 'full',
        end_date: req.endDate ?? null,
        auto_approve: true,
      }),
      cache: 'no-store',
    });
  } catch (err) {
    console.error('[strategy-report] starting the full run failed:', err);
    throw new StrategyEngineError(502, 'Strategy report service is unreachable');
  }
  if (res.status === 404) {
    throw new StrategyEngineError(404, (await res.text()) || `No Market Scope data for "${req.slug}"`);
  }
  if (!res.ok) {
    console.error(`[strategy-report] tempo-engine returned ${res.status}:`, await res.text());
    throw new StrategyEngineError(502, 'Failed to start the strategy report');
  }
  return ((await res.json()) as { run_id: string }).run_id;
}

/** `GET /v1/briefs/:id` — `null` when the engine is unreachable (the poll just tries again). */
export async function fetchStrategyRun(engineRunId: string): Promise<StrategyEngineResult | null> {
  try {
    const res = await fetch(`${TEMPO_ENGINE_URL}/v1/briefs/${encodeURIComponent(engineRunId)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { run_id: string; status: string; content: unknown };
    return { runId: body.run_id, status: body.status, content: body.content };
  } catch (err) {
    console.error('[strategy-report] polling the full run failed:', err);
    return null;
  }
}
