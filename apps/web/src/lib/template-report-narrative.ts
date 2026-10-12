import { cleanNarrative, stableSeed, ungroundedNumbers } from '@tempo/reports';

/**
 * Narrative strings for the Template Report, written by LM Studio (Gemma 4
 * 12B, the same local model tempo-engine's `LmStudioClient` targets) called
 * directly from Node — no new tempo-engine endpoint, since LM Studio is a
 * shared local server both processes reach identically, and this report's
 * facts (tables, statuses, budget moves, recommendations) are all computed
 * deterministically before the model ever sees them. The model writes prose
 * about numbers; it never picks, derives or invents one.
 *
 * Three guards keep the prose repeatable and on the standard of the rest of
 * the report:
 *  1. Low temperature plus a seed derived from the prompt and data — the same
 *     report inputs reproduce the same wording instead of reshuffling it.
 *  2. A number-grounding check: any figure in the answer that isn't in the
 *     data the model was handed counts as a failed quality attempt and is
 *     retried (bounded — see `QUALITY_TRIES`).
 *  3. Transport failures retry up to `MAX_ATTEMPTS`; there is still no
 *     placeholder fallback, a report that can't get real prose fails loudly.
 */

const LM_STUDIO_URL = process.env.LM_STUDIO_URL ?? 'http://localhost:1234/v1';
const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL ?? 'google/gemma-4-12b';

async function writeNarrative(system: string, dataJson: unknown, sentenceCount: string, seed: number): Promise<string> {
  const res = await fetch(`${LM_STUDIO_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LM_STUDIO_MODEL,
      messages: [
        {
          role: 'system',
          content:
            `${system} Tulis dalam Bahasa Indonesia, ${sentenceCount} kalimat, nada profesional seorang Account Manager agensi. ` +
            'Gunakan HANYA angka, nama campaign/produk/creative, dan fakta yang ada di data JSON berikut — jangan mengarang angka, ' +
            'nama, penyebab, atau klaim baru, dan jangan menghitung angka baru yang tidak tertulis di data. ' +
            'Jika data tidak cukup untuk menyimpulkan sesuatu, katakan terbatas alih-alih menebak. ' +
            'Jangan tampilkan proses berpikir; langsung tulis jawaban akhir saja. Balas hanya teks naratif, tanpa markdown, daftar, atau tanda kutip.',
        },
        { role: 'user', content: JSON.stringify(dataJson) },
      ],
      temperature: 0.2,
      seed,
      // Gemma 4 is a reasoning model: it spends tokens "thinking" (surfaced
      // separately as `reasoning_content`) before writing the final answer in
      // `content`. A budget too small to finish both leaves `content` empty
      // with `finish_reason: "length"` — 1024 wasn't enough for even a 2-3
      // sentence summary. Prompts now receive pre-computed facts rather than
      // raw totals (see `template-report-pipeline.ts`), which cut typical
      // reasoning length substantially, but the budget is kept generous
      // rather than tuned to the minimum: report quality matters more than
      // shaving tokens, and a truncated answer is never acceptable output.
      // Never fall back to `reasoning_content` on a short budget: it's an
      // unedited scratchpad ("Option 1: ... Option 2: ... constraint
      // checklist ..."), not prose fit for a client-facing report.
      max_tokens: 8192,
      stream: false,
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
  return cleanNarrative(content);
}

const MAX_ATTEMPTS = 8;
const RETRY_DELAY_MS = 4000;
/** How many differently-seeded drafts to try before accepting the one with the fewest ungrounded numbers. */
const QUALITY_TRIES = 3;

/**
 * No placeholder fallback, by explicit request: a real insight is the
 * requirement, not a fast response, so a failed or truncated attempt is
 * retried rather than papered over with "insight not available" text.
 * Retries a bounded number of times (transient overload/truncation reliably
 * clears within a few) before finally throwing — a report that can't get a
 * real answer should fail loudly (502 at the route), never ship fake prose.
 *
 * On top of that, a draft quoting a number that isn't in the data is retried
 * with a new (but still deterministic) seed; if every try has one, the best
 * draft is used and the offending numbers are logged.
 */
async function tryWriteNarrative(system: string, dataJson: unknown, sentenceCount = '2-3'): Promise<string> {
  const baseSeed = stableSeed(`${system}\n${JSON.stringify(dataJson)}`);
  let best: { text: string; bad: string[] } | null = null;

  for (let tryNo = 0; tryNo < QUALITY_TRIES; tryNo += 1) {
    let text: string | null = null;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        text = await writeNarrative(system, dataJson, sentenceCount, baseSeed + tryNo * 101 + (attempt - 1));
        break;
      } catch (err) {
        lastError = err;
        console.warn(`[template-report] narrative attempt ${attempt}/${MAX_ATTEMPTS} failed, retrying:`, err);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }
    if (text === null) {
      throw new Error(
        `LM Studio narrative failed after ${MAX_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    }

    const bad = ungroundedNumbers(text, dataJson);
    if (bad.length === 0) return text;
    if (!best || bad.length < best.bad.length) best = { text, bad };
    console.warn(
      `[template-report] narrative draft ${tryNo + 1}/${QUALITY_TRIES} quotes numbers not in the data (${bad.join(', ')})` +
        (tryNo + 1 < QUALITY_TRIES ? ', retrying with a new seed' : ', keeping the closest draft'),
    );
  }
  return (best as { text: string }).text;
}

// --- GMV / TikTok Shop ------------------------------------------------------

export interface TemplateReportNarrativeInputs {
  execSummary: unknown;
  budgetAllocation: unknown;
  efficiency: unknown;
  trend: unknown;
  /** The ROI source breakdown (top/bottom sources and what they do to blended ROI). */
  roi: unknown;
  products: unknown;
  creatives: unknown;
  /** The computed recommendation rows and next-period funnel plan. */
  recommendations: unknown;
}

export interface TemplateReportNarratives {
  execNarrative: string;
  funnelInsight: string;
  efficiencyInsight: string;
  trendInsight: string;
  roiInsight: string;
  productInsight: string;
  creativeInsight: string;
  recommendationInsight: string;
}

/**
 * Runs every narrative call in parallel against the one local LM Studio
 * instance. Can throw (after `MAX_ATTEMPTS` retries on whichever prompt is
 * struggling) — callers should let a failure here surface as a real error,
 * not substitute placeholder text.
 */
export async function generateTemplateReportNarratives(
  inputs: TemplateReportNarrativeInputs,
): Promise<TemplateReportNarratives> {
  const [
    execNarrative,
    funnelInsight,
    efficiencyInsight,
    trendInsight,
    roiInsight,
    productInsight,
    creativeInsight,
    recommendationInsight,
  ] = await Promise.all([
    tryWriteNarrative(
      'Ringkas kondisi kesehatan akun iklan TikTok brand ini pada periode laporan: apa yang paling menonjol, apakah performa membaik atau menurun dibanding periode pembanding, dan tutup dengan satu rekomendasi utama.',
      inputs.execSummary,
    ),
    tryWriteNarrative(
      'Jelaskan alokasi budget iklan brand ini di tiga tahap funnel (Awareness/Consideration/Conversion) dibanding benchmark yang tertera (sumbernya ada di data), dan berikan rekomendasi realokasi jika ada yang timpang.',
      inputs.budgetAllocation,
    ),
    tryWriteNarrative(
      'Jelaskan efisiensi metrik iklan brand ini dibanding benchmark yang tertera (sumbernya ada di data): sebutkan metrik mana yang sudah baik dan mana yang perlu perhatian.',
      inputs.efficiency,
    ),
    tryWriteNarrative(
      'Jelaskan tren performa gabungan brand ini dibanding periode pembanding — apa pendorong utama kenaikan atau penurunannya.',
      inputs.trend,
    ),
    tryWriteNarrative(
      'Jelaskan dari mana ROI berasal berdasarkan tabel breakdown: sebut sumber TOP sebagai pendorong dan sumber BOTTOM sebagai penahan beserta ROI dan dampaknya terhadap ROI rata-rata, lalu apa artinya bagi alokasi budget. Hanya bahas sumber yang ada di tabel; jika sumber kurang dari 6, sebutkan bahwa tabel dibagi sesuai jumlah sumber yang ada.',
      inputs.roi,
      '3-4',
    ),
    tryWriteNarrative(
      'Jelaskan produk mana yang paling layak discale up dan mana yang perlu dioptimasi, berdasarkan data GMV/ROI/kontribusi produk berikut.',
      inputs.products,
    ),
    tryWriteNarrative(
      'Jelaskan materi creative mana yang paling efektif mendorong konversi dan pola apa yang terlihat dari creative yang winning. Jangan menyimpulkan pola yang tidak terlihat di data.',
      inputs.creatives,
    ),
    tryWriteNarrative(
      'Ringkas rekomendasi next steps: sebutkan 2–3 prioritas utama (P1 lebih dulu), tegaskan perpindahan atau alokasi budget yang direkomendasikan beserta angkanya, dan tutup dengan target yang ingin dicapai. Jangan menambah rekomendasi baru di luar yang ada di data.',
      inputs.recommendations,
      '3-4',
    ),
  ]);

  return {
    execNarrative,
    funnelInsight,
    efficiencyInsight,
    trendInsight,
    roiInsight,
    productInsight,
    creativeInsight,
    recommendationInsight,
  };
}

// --- Awareness / App Install ------------------------------------------------

export interface NorthStarNarrativeInputs {
  execSummary: unknown;
  budgetAllocation: unknown;
  efficiency: unknown;
  trend: unknown;
  /** The campaign source breakdown (best/worst campaigns on the headline efficiency). */
  sources: unknown;
  campaigns: unknown;
  creatives: unknown;
  recommendations: unknown;
}

export interface NorthStarNarrativeSet {
  execNarrative: string;
  funnelInsight: string;
  efficiencyInsight: string;
  trendInsight: string;
  sourceInsight: string;
  campaignInsight: string;
  creativeInsight: string;
  recommendationInsight: string;
}

/**
 * The Awareness (`vtr`) / App Install (`app_install`) counterpart of
 * `generateTemplateReportNarratives` — same slots, same guards, prompts about
 * what those north stars actually buy media for (reach and video retention;
 * installs and their cost/quality). Every number is handed in pre-computed;
 * the model writes prose only.
 */
export async function generateNorthStarNarratives(
  northStar: 'vtr' | 'app_install',
  inputs: NorthStarNarrativeInputs,
): Promise<NorthStarNarrativeSet> {
  const awareness = northStar === 'vtr';
  const [
    execNarrative,
    funnelInsight,
    efficiencyInsight,
    trendInsight,
    sourceInsight,
    campaignInsight,
    creativeInsight,
    recommendationInsight,
  ] = await Promise.all([
    tryWriteNarrative(
      awareness
        ? 'Ringkas kondisi kesehatan kampanye awareness TikTok brand ini pada periode laporan: jangkauan (reach), frequency, efisiensi CPM, dan kualitas view. Sebutkan apa yang paling menonjol dan tutup dengan satu rekomendasi utama.'
        : 'Ringkas kondisi kesehatan kampanye app install TikTok brand ini pada periode laporan: volume install, cost per install (CPI), dan kualitas pasca-install (registrasi). Sebutkan apa yang paling menonjol dan tutup dengan satu rekomendasi utama.',
      inputs.execSummary,
    ),
    tryWriteNarrative(
      'Jelaskan alokasi budget iklan brand ini di tiga tahap funnel (Awareness/Consideration/Conversion) dibanding benchmark yang tertera (sumbernya ada di data), dan berikan rekomendasi realokasi jika ada yang timpang.',
      inputs.budgetAllocation,
    ),
    tryWriteNarrative(
      awareness
        ? 'Jelaskan efisiensi delivery, retensi video, dan engagement brand ini dibanding benchmark yang tertera (sumbernya ada di data); sebutkan metric mana yang perlu perhatian dan apa artinya bagi efektivitas awareness.'
        : 'Jelaskan efisiensi traffic, install, dan kualitas pasca-install brand ini dibanding benchmark yang tertera (sumbernya ada di data); sebutkan metric mana yang perlu perhatian dan apa artinya bagi efisiensi akuisisi user.',
      inputs.efficiency,
    ),
    tryWriteNarrative(
      awareness
        ? 'Jelaskan tren performa awareness brand ini dibanding periode pembanding — apa pendorong utama perubahan reach, CPM, dan VTR.'
        : 'Jelaskan tren performa install brand ini dibanding periode pembanding — apa pendorong utama perubahan volume install, CPI, dan registrasi.',
      inputs.trend,
    ),
    tryWriteNarrative(
      awareness
        ? 'Jelaskan campaign mana yang paling efisien menjangkau audiens (TOP) dan mana yang paling boros (BOTTOM) berdasarkan tabel breakdown, beserta dampaknya terhadap rata-rata dan apa artinya bagi alokasi budget. Hanya bahas campaign yang ada di tabel; jika kurang dari 6, sebutkan bahwa tabel dibagi sesuai jumlah yang ada.'
        : 'Jelaskan campaign mana yang paling efisien menghasilkan install (TOP) dan mana yang paling boros (BOTTOM) berdasarkan tabel breakdown, beserta dampaknya terhadap CPI rata-rata dan apa artinya bagi alokasi budget. Hanya bahas campaign yang ada di tabel; jika kurang dari 6, sebutkan bahwa tabel dibagi sesuai jumlah yang ada.',
      inputs.sources,
      '3-4',
    ),
    tryWriteNarrative(
      awareness
        ? 'Jelaskan campaign mana yang paling layak discale up dan mana yang perlu dioptimasi, berdasarkan reach, frequency, CPM, dan VTR campaign berikut.'
        : 'Jelaskan campaign mana yang paling layak discale up dan mana yang perlu dioptimasi, berdasarkan volume install, CPI, dan install rate campaign berikut.',
      inputs.campaigns,
    ),
    tryWriteNarrative(
      awareness
        ? 'Jelaskan materi creative mana yang paling efektif menahan penonton (VTR/completion) dan memicu engagement, serta pola apa yang terlihat dari creative yang winning. Jangan menyimpulkan pola yang tidak terlihat di data.'
        : 'Jelaskan materi creative mana yang paling efektif mendorong install dengan CPI rendah dan pola apa yang terlihat dari creative yang winning. Jangan menyimpulkan pola yang tidak terlihat di data.',
      inputs.creatives,
    ),
    tryWriteNarrative(
      'Ringkas rekomendasi next steps: sebutkan 2–3 prioritas utama (P1 lebih dulu), tegaskan perpindahan atau alokasi budget yang direkomendasikan beserta angkanya, dan tutup dengan target yang ingin dicapai. Jangan menambah rekomendasi baru di luar yang ada di data.',
      inputs.recommendations,
      '3-4',
    ),
  ]);
  return {
    execNarrative,
    funnelInsight,
    efficiencyInsight,
    trendInsight,
    sourceInsight,
    campaignInsight,
    creativeInsight,
    recommendationInsight,
  };
}
