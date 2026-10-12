import {
  createSourcePool,
  fetchNorthStarRawData,
  fetchTemplateReportRawData,
  getPaidTiktokAdAccountIds,
  getBrandIndustry,
  listPeersByIndustry,
  type Database,
} from '@tempo/db';
import { INDUSTRY_TAXONOMY, isIndustryCode, type NorthStar } from '@tempo/core';
import {
  averageNorthStarPeers,
  averagePeerMetrics,
  computeNorthStarMetrics,
  computePeerAccountMetrics,
  PEER_MATERIALITY_FLOOR,
  type AveragedBenchmarkEntry,
  type AveragedPeerBenchmarks,
} from '@tempo/reports';

/**
 * "Populate benchmarks from industry peers" — the same manual process used
 * once for Laneige (find comparable accounts in Buzzohero's real database,
 * pull each one's real TTAM+GMV Max data, average ignoring nulls),
 * scaffolded as a repeatable button.
 *
 * The hard part — recognizing which of ~700 messy real account names are
 * legitimate brands in a given industry — is a one-time Claude categorization
 * pass (`scratch-categorize.ts`, results in `brand_industry_tags`), not a
 * runtime LLM call. An earlier version of this feature asked Gemma to
 * generate free-text search keywords on every run and substring-match them
 * against real names; that missed real brands whose names don't contain a
 * category word (Nivea, Etude, Olay) and over-matched small reseller
 * accounts that happened to spell out "skincare". Gemma's remaining job here
 * is much smaller and more reliable: when a client's own account isn't
 * already tagged, pick ONE industry code from the fixed ~20-option
 * `INDUSTRY_TAXONOMY` — a closed-set classification, not open-ended
 * brainstorming — and everything downstream is a deterministic DB lookup.
 */

const LM_STUDIO_URL = process.env.LM_STUDIO_URL ?? 'http://localhost:1234/v1';
const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL ?? 'google/gemma-4-12b';
const PICK_ATTEMPTS = 5;
const PICK_RETRY_DELAY_MS = 3000;
/**
 * Bounds how many real peer accounts get queried per run. `listPeersByIndustry`
 * is already scoped to one industry (never the full ~700-account universe),
 * so this is generous headroom above the largest current bucket (~75 for
 * cosmetics_skincare) rather than a tight cap — the earlier keyword-matching
 * version needed a tighter cap since matches could sprawl across categories.
 */
const MAX_CANDIDATES = 150;
const FETCH_CONCURRENCY = 5;

async function requestIndustryPick(clientName: string): Promise<string> {
  const options = INDUSTRY_TAXONOMY.map((t) => `${t.code} (${t.label})`).join(', ');
  const res = await fetch(`${LM_STUDIO_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LM_STUDIO_MODEL,
      messages: [
        {
          role: 'system',
          content:
            `Diberi nama satu brand/klien, pilih SATU kode industri yang paling cocok dari daftar tetap berikut: ${options}. ` +
            'Balas hanya JSON sesuai skema dengan kode yang PERSIS sama seperti di daftar (jangan buat kode baru). Jangan tampilkan proses berpikir.',
        },
        { role: 'user', content: clientName },
      ],
      temperature: 0.1,
      // Closed-set pick from ~20 options — a much smaller task than free-text
      // keyword generation, but keeps the same generous budget as the rest of
      // this app's LM Studio calls (see template-report-narrative.ts) since
      // Gemma 4 still spends tokens "thinking" before the final answer.
      max_tokens: 8192,
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'industry_pick',
          schema: {
            type: 'object',
            properties: { industry: { type: 'string', enum: INDUSTRY_TAXONOMY.map((t) => t.code) } },
            required: ['industry'],
          },
        },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`LM Studio returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    throw new Error(`LM Studio returned no content (finish_reason: ${choice?.finish_reason ?? 'unknown'})`);
  }
  const parsed = JSON.parse(content) as { industry?: unknown };
  if (typeof parsed.industry !== 'string' || !isIndustryCode(parsed.industry)) {
    throw new Error(`LM Studio picked an invalid industry code: ${JSON.stringify(parsed.industry)}`);
  }
  return parsed.industry;
}

/** Retries a bounded number of times before giving up — a struggling local model reliably clears within a few attempts. */
async function inferIndustryPick(clientName: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PICK_ATTEMPTS; attempt += 1) {
    try {
      return await requestIndustryPick(clientName);
    } catch (err) {
      lastError = err;
      console.warn(`[industry-peer-benchmark] pick attempt ${attempt}/${PICK_ATTEMPTS} failed, retrying:`, err);
      if (attempt < PICK_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, PICK_RETRY_DELAY_MS));
      }
    }
  }
  throw new Error(
    `Failed to infer industry after ${PICK_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export interface AutoBenchmarkPeer {
  name: string;
  tiktokAdAccountId: string;
  spend: number;
  /** Cleared the materiality floor and actually contributed to the averages below. */
  included: boolean;
}

export interface AutoBenchmarkResult {
  northStar: NorthStar;
  industry: string;
  /** 'own-account' when the client's own account was already tagged; 'gemma-pick' when Gemma had to choose. */
  industrySource: 'own-account' | 'gemma-pick';
  peers: AutoBenchmarkPeer[];
  /** Averaged targets keyed by the north star's own (objective, metric) grid — plus funnel `budget_pct` per stage. */
  entries: AveragedBenchmarkEntry[];
}

/** GMV's fixed-shape averages, flattened into the same (objective, metric) entries the other north stars produce. */
function shopEntries(avg: AveragedPeerBenchmarks): AveragedBenchmarkEntry[] {
  const out: AveragedBenchmarkEntry[] = [];
  const add = (objective: string, metric: string, e: { value: number; n: number } | null): void => {
    if (e) out.push({ objective, metric, value: e.value, n: e.n });
  };
  add('awareness', 'cpm', avg.cpm);
  add('awareness', 'ctr', avg.ctr);
  add('awareness', 'vtr', avg.vtr);
  add('consideration', 'ctr', avg.ctr);
  add('consideration', 'cpc', avg.cpc);
  add('conversion', 'roi', avg.roi);
  add('conversion', 'cvr', avg.cvr);
  add('conversion', 'cpa', avg.cpa);
  add('awareness', 'budget_pct', avg.budgetPct.awareness);
  add('consideration', 'budget_pct', avg.budgetPct.consideration);
  add('conversion', 'budget_pct', avg.budgetPct.conversion);
  return out;
}

/**
 * Full pipeline for one client: resolve its industry (real tag lookup first,
 * Gemma closed-set pick only as a fallback), pull every other tagged account
 * in that industry, fetch each one's real data, and average. Read-only —
 * does not write to `report_benchmarks` itself, so the caller can show the
 * result for review before anything is saved.
 */
export async function autoPopulateBenchmarksFromIndustryPeers(
  db: Database,
  clientId: string,
  clientName: string,
  northStar: NorthStar,
): Promise<AutoBenchmarkResult> {
  const ownAccountIds = await getPaidTiktokAdAccountIds(db, clientId);

  let industry: string | null = null;
  for (const accountId of ownAccountIds) {
    industry = await getBrandIndustry(db, accountId);
    if (industry) break;
  }
  const industrySource: AutoBenchmarkResult['industrySource'] = industry ? 'own-account' : 'gemma-pick';
  if (!industry) {
    industry = await inferIndustryPick(clientName);
  }

  const peerAccounts = (await listPeersByIndustry(db, industry, ownAccountIds)).slice(0, MAX_CANDIDATES);

  if (peerAccounts.length === 0) {
    return { northStar, industry, industrySource, peers: [], entries: [] };
  }

  const pool = createSourcePool();
  if (!pool) {
    throw new Error('Source TikTok database is not configured (DB_HOST/DB_NAME/DB_USER)');
  }
  try {
    // GMV keeps its own blended TTAM+GMV Max metrics; Awareness/Install read
    // only the regular-ads tables (no creatives — the average needs totals and
    // campaigns only). Either way each account yields a spend figure plus its
    // metrics, and the same materiality floor decides who counts.
    type PeerResult = { name: string; tiktokAdAccountId: string; spend: number };
    const shopResults: Array<PeerResult & { metrics: ReturnType<typeof computePeerAccountMetrics> }> = [];
    const nsResults: Array<PeerResult & { metrics: ReturnType<typeof computeNorthStarMetrics> }> = [];
    for (let i = 0; i < peerAccounts.length; i += FETCH_CONCURRENCY) {
      const batch = peerAccounts.slice(i, i + FETCH_CONCURRENCY);
      if (northStar === 'shop') {
        const batchResults = await Promise.all(
          batch.map(async (c) => {
            const raw = await fetchTemplateReportRawData(pool, { tiktokAdAccountIds: [c.tiktokAdAccountId] });
            const metrics = computePeerAccountMetrics(raw);
            return { name: c.name, tiktokAdAccountId: c.tiktokAdAccountId, spend: metrics.spend, metrics };
          }),
        );
        shopResults.push(...batchResults);
      } else {
        const batchResults = await Promise.all(
          batch.map(async (c) => {
            const raw = await fetchNorthStarRawData(pool, {
              tiktokAdAccountIds: [c.tiktokAdAccountId],
              includeCreatives: false,
              includePrior: false,
            });
            const metrics = computeNorthStarMetrics(
              northStar,
              { totals: raw.current, campaigns: raw.campaigns },
              PEER_MATERIALITY_FLOOR,
            );
            return { name: c.name, tiktokAdAccountId: c.tiktokAdAccountId, spend: metrics.spend, metrics };
          }),
        );
        nsResults.push(...batchResults);
      }
    }

    const all: PeerResult[] = northStar === 'shop' ? shopResults : nsResults;
    const peers: AutoBenchmarkPeer[] = all.map((r) => ({
      name: r.name,
      tiktokAdAccountId: r.tiktokAdAccountId,
      spend: r.spend,
      included: r.spend >= PEER_MATERIALITY_FLOOR,
    }));
    const entries =
      northStar === 'shop'
        ? shopEntries(averagePeerMetrics(shopResults.map((r) => r.metrics)))
        : averageNorthStarPeers(northStar, nsResults.map((r) => r.metrics));

    return { northStar, industry, industrySource, peers, entries };
  } finally {
    await pool.end();
  }
}
