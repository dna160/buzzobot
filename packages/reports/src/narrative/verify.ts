import { NorthStar } from '@tempo/core';
import type { FactSheet } from './facts.js';
import type { Narrative } from './schema.js';

/**
 * Post-generation guard against fabricated figures.
 *
 * The prompt tells the model it may only use numbers from the fact sheet; this
 * checks that it did. A report that quietly invents a plausible-looking rupiah
 * figure is worse than one that fails loudly, because nothing downstream can
 * detect it — so a violation rejects the whole narrative and the caller falls
 * back to the deterministic text.
 */

export interface VerificationResult {
  ok: boolean;
  violations: Array<{ field: string; token: string; sentence: string }>;
}

/**
 * Tokens that are never fabrication risks: small integers used in ordinary
 * prose ("the first two hours", "three campaigns"), clock times, and ordinary
 * date parts. Anything larger or with decimal/thousands punctuation must come
 * from the fact sheet.
 */
function isBenign(token: string): boolean {
  if (/^\d{1,2}:\d{2}$/.test(token)) return true; // clock time HH:MM
  // Indonesian/EU clock notation writes 19:00 as "19.00". Bounded to a valid
  // hour so a real hour reference is not mistaken for a fabricated decimal,
  // while an invented number like "56.00" still fails.
  if (/^([01]?\d|2[0-4])\.[0-5]\d$/.test(token)) return true; // clock time HH.MM
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return true; // ISO date
  const bare = token.replace(/[.,]/g, '');
  if (!/^\d+$/.test(bare)) return false;
  // Small counts are normal prose and can't misstate a money figure.
  return bare.length <= 2 && Number(bare) <= 24 && !token.includes('.') && !token.includes(',');
}

/** Every numeric token in a string, normalised for comparison. */
function tokensOf(text: string): string[] {
  return [...text.matchAll(/\d[\d.,]*/g)].map((m) => m[0].replace(/[.,]+$/, ''));
}

function collectStrings(n: Narrative): Array<{ field: string; text: string }> {
  const out: Array<{ field: string; text: string }> = [
    { field: 'headline', text: n.headline },
    { field: 'summaryProse', text: n.summaryProse },
    { field: 'dataGap.body', text: n.dataGap.body },
    { field: 'dataGap.title', text: n.dataGap.title },
  ];
  for (const key of ['daypart', 'efficiency', 'mix', 'adgroup'] as const) {
    const s = n[key];
    if (!s) continue;
    out.push({ field: `${key}.finding.title`, text: s.finding.title });
    out.push({ field: `${key}.finding.body`, text: s.finding.body });
    out.push({ field: `${key}.prose`, text: s.prose });
  }
  n.risks.forEach((r, i) => {
    out.push({ field: `risks[${i}].risk`, text: r.risk });
    out.push({ field: `risks[${i}].action`, text: r.action });
  });
  n.outlook.forEach((o, i) => out.push({ field: `outlook[${i}]`, text: o }));
  return out;
}

export function verifyNarrative(narrative: Narrative, facts: FactSheet): VerificationResult {
  // Allow both the exact formatted tokens and their punctuation-stripped forms,
  // so "1,705" and "1705" both match a fact-sheet value of "1,705".
  const allowed = new Set<string>();
  for (const a of facts.allowedNumbers) {
    allowed.add(a);
    allowed.add(a.replace(/[.,]/g, ''));
  }

  const violations: VerificationResult['violations'] = [];
  for (const { field, text } of collectStrings(narrative)) {
    for (const token of tokensOf(text)) {
      if (isBenign(token)) continue;
      if (allowed.has(token) || allowed.has(token.replace(/[.,]/g, ''))) continue;
      const sentence =
        text
          .split(/(?<=[.!?])\s+/)
          .find((s) => s.includes(token))
          ?.trim() ?? text.slice(0, 120);
      violations.push({ field, token, sentence });
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Metrics a given client's export cannot support. Naming them to say they are
 * unavailable is correct; presenting a value for one is the failure mode this
 * catches. Which patterns apply depends on the north star: a Shop client has
 * real conversions and (sometimes) ROAS, so neither is forbidden for it; an
 * app-install client has real "conversions" (installs) but never a monetary
 * ROAS/revenue figure.
 */
const ROAS_PATTERNS = [
  { label: 'ROAS value', re: /\bROAS\b[^.!?]{0,24}\d/i },
  { label: 'ROAS multiple', re: /\d\s*(?:x|×)\s*(?:blended\s+)?ROAS/i },
];
const CPA_AND_CONVERSION_PATTERNS = [
  { label: 'CPA value', re: /\bCPA\b[^.!?]{0,24}\d/i },
  { label: 'conversion count', re: /\b\d[\d.,]*\s+(?:conversions?|konversi)\b/i },
];

const FORBIDDEN_VALUE_PATTERNS: Record<NorthStar, Array<{ label: string; re: RegExp }>> = {
  [NorthStar.Vtr]: [...ROAS_PATTERNS, ...CPA_AND_CONVERSION_PATTERNS],
  [NorthStar.Shop]: [],
  [NorthStar.AppInstall]: [...ROAS_PATTERNS],
};

/**
 * Risk-register entries about a missing on-platform outcome that this
 * particular client's brief already explains is either permanent (VTR: sales
 * happen offline) or simply false (Shop/App Install: conversions ARE real and
 * measured for them). As a *risk entry* it is unactionable filler either way —
 * no team can change how the category sells, and a false "we can't measure
 * this" claim wastes a slot a real finding could occupy. Stripped before
 * schema validation so the six-entry floor is measured against genuinely
 * actionable risks.
 *
 * The "TikTok Shop" pattern only applies to a 'vtr' client, where any mention
 * of it is necessarily about the impossibility of on-platform conversion for
 * that brand — for a 'shop' client, "TikTok Shop" is normal, expected
 * vocabulary in a legitimate risk (e.g. a checkout drop-off) and must not be
 * stripped.
 */
const ALWAYS_UNACTIONABLE_PATTERNS: RegExp[] = [
  /conversion\s+tracking|pelacakan\s+konversi|pixel/i,
  // An outcome metric named alongside its own absence.
  /\b(roas|cpa|convers\w+|konversi|revenue|pendapatan|penjualan|install\w*)\b[^.!?]{0,60}\b(cannot|can't|can not|no|not|never|without|unavailable|missing|absent|impossible|tidak|tanpa|belum|mustahil)\b/i,
  /\b(cannot|can't|can not|no|not|never|without|unavailable|missing|absent|impossible|tidak|tanpa|belum|mustahil)\b[^.!?]{0,60}\b(roas|cpa|convers\w+|konversi|revenue|pendapatan|penjualan|install\w*)\b/i,
];

const isUnactionableRisk = (text: string, northStar: NorthStar): boolean =>
  ALWAYS_UNACTIONABLE_PATTERNS.some((re) => re.test(text)) ||
  (northStar === NorthStar.Vtr && /tiktok\s*shop/i.test(text));

/**
 * Drop unactionable measurement-gap entries from a raw parsed response, before
 * it is schema-checked. Operates on `unknown` because it runs pre-validation;
 * anything not shaped as expected is passed through untouched for the schema to
 * reject with a better message.
 */
export function stripUnactionableRisks(parsed: unknown, northStar: NorthStar): unknown {
  if (typeof parsed !== 'object' || parsed === null) return parsed;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.risks)) return parsed;

  const kept = obj.risks.filter((r) => {
    if (typeof r !== 'object' || r === null) return true;
    const entry = r as Record<string, unknown>;
    const risk = typeof entry.risk === 'string' ? entry.risk : '';
    const action = typeof entry.action === 'string' ? entry.action : '';
    return !isUnactionableRisk(`${risk} ${action}`, northStar);
  });

  return kept.length === obj.risks.length ? parsed : { ...obj, risks: kept };
}

/** Reject any sentence that presents a figure for a metric this client's export cannot support. */
export function verifyNoUnsupportedMetrics(
  narrative: Narrative,
  northStar: NorthStar,
): VerificationResult {
  const violations: VerificationResult['violations'] = [];
  for (const { field, text } of collectStrings(narrative)) {
    for (const { label, re } of FORBIDDEN_VALUE_PATTERNS[northStar]) {
      const m = text.match(re);
      if (m) violations.push({ field, token: label, sentence: m[0] });
    }
  }
  return { ok: violations.length === 0, violations };
}
