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
  if (/^\d{1,2}:\d{2}$/.test(token)) return true; // clock time
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
 * Metrics the export cannot support. Naming them to say they are unavailable is
 * correct; presenting a value for one is the failure mode this catches.
 */
const FORBIDDEN_VALUE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'ROAS value', re: /\bROAS\b[^.!?]{0,24}\d/i },
  { label: 'ROAS multiple', re: /\d\s*(?:x|×)\s*(?:blended\s+)?ROAS/i },
  { label: 'CPA value', re: /\bCPA\b[^.!?]{0,24}\d/i },
  { label: 'conversion count', re: /\b\d[\d.,]*\s+(?:conversions?|konversi)\b/i },
];

/** Reject any sentence that presents a figure for an unsupported metric. */
export function verifyNoUnsupportedMetrics(narrative: Narrative): VerificationResult {
  const violations: VerificationResult['violations'] = [];
  for (const { field, text } of collectStrings(narrative)) {
    for (const { label, re } of FORBIDDEN_VALUE_PATTERNS) {
      const m = text.match(re);
      if (m) violations.push({ field, token: label, sentence: m[0] });
    }
  }
  return { ok: violations.length === 0, violations };
}
