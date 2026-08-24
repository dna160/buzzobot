import { formatNumberCompact, type Currency } from '@tempo/core';
import { DECK_COPY, evidenceLabel } from './copy.js';
import type { EngineFinding } from './engine-content.js';
import type { EvidenceChip, FindingCard, Light } from './model.js';

/**
 * `Finding` → `FindingCard` (Brief Deck PRD §3.2, §4).
 *
 * The card grammar is verdict-first: light chip → specific headline → evidence
 * chips → mechanism → action. Numbers live in the chips, prose carries the
 * mechanism. That split is what earns trust in the reference audit format, and
 * it is also what the numeral gate wants — **every chip value is read straight
 * out of `finding.evidence`**, the dict the engine's gate already verified.
 * Nothing here computes, rounds differently, or re-derives a figure; it
 * formats, orders, and labels.
 *
 * A card is therefore only ever as specific as the finding behind it. When the
 * generators find four material things, the deck shows four excellent cards —
 * this module cannot invent a fifth.
 */

/**
 * Evidence keys that are internal switches rather than findings: they name the
 * rule that fired or the axis it ran on, which the claim frame already says.
 * Mirrors `_PROSE_SKIP_KEYS` in `tempo-engine/src/engine/copy/templates.py`;
 * kept separately because that one governs a sentence and this one governs
 * chips — the same list today, but they answer different questions and should
 * be free to diverge.
 */
const CHIP_SKIP_KEYS = new Set(['rule', 'count_metric', 'cohort_level', 'basis', 'method']);

/** Evidence keys that are money, so a chip prints Rp rather than a bare number. */
const CURRENCY_KEYS = new Set([
  'cost',
  'total_cost',
  'spend',
  'total_spend',
  'gmv',
  'total_gmv',
  'revenue',
  'aov',
  'cpa',
  'cpi',
  'cpm',
  'cpc',
  'entity_cost',
  'wasted_cost',
]);

/** Evidence keys already expressed as a percentage (0–100), not a fraction. */
const PERCENT_KEYS = new Set([
  'active_day_coverage_pct',
  'share_pct',
  'magnitude_pct',
  'contribution_pct',
]);

const MAX_CHIPS = 4;

const LEVEL_LABELS: Record<string, string> = {
  account: 'Akun',
  campaign: 'Kampanye',
  adgroup: 'Grup Iklan',
  creative: 'Materi',
  product: 'Produk',
  creator: 'Kreator',
  session: 'Sesi',
};

/**
 * A card's light is the finding's own `direction` — the generator's verdict,
 * not a threshold re-applied here. A positive finding is something to lean
 * into, a negative one something to evaluate; a neutral finding (a
 * comparability caveat, a coverage note) is genuinely neither, and colouring it
 * anyway would be the guess `light()` refuses to make for metrics.
 */
export function cardLight(finding: EngineFinding): Light {
  switch (finding.direction) {
    case 'positive':
      return 'green';
    case 'negative':
      return 'red';
    default:
      return 'none';
  }
}

/**
 * Format one evidence value. Indonesian decimal convention (comma decimal,
 * dot thousands) so a chip and the engine's own prose cannot print the same
 * number two ways.
 */
function formatEvidenceValue(key: string, value: number | string, currency: Currency): string {
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return DECK_COPY.labels.notReported;

  if (PERCENT_KEYS.has(key)) return `${formatIdNumber(value, 1)}%`;
  if (CURRENCY_KEYS.has(key)) {
    const symbol = currency === 'IDR' ? 'Rp' : `${currency} `;
    return Math.abs(value) >= 10_000
      ? `${symbol}${formatNumberCompact(value)}`
      : `${symbol}${formatIdNumber(value, 2)}`;
  }
  // Integers stay integers; a count rendered as "5,00" reads as a measurement.
  if (Number.isInteger(value)) return formatIdNumber(value, 0);
  // Two decimals on a nine-digit figure is false precision in a chip — the
  // fractional part of 247.020.272,23 tells a reader nothing and costs half the
  // chip's width. Precision is kept where it carries meaning (ratios, rates).
  return Math.abs(value) >= 10_000 ? formatIdNumber(value, 0) : formatIdNumber(value, 2);
}

function formatIdNumber(value: number, fractionDigits: number): string {
  const fixed = Math.abs(value).toFixed(fractionDigits);
  const [whole, fraction] = fixed.split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = value < 0 ? '-' : '';
  return fraction ? `${sign}${grouped},${fraction}` : `${sign}${grouped}`;
}

/**
 * Chips for one finding: numeric evidence first (a card leading with a label
 * reads like a debug dump), internal switches dropped, capped at four so the
 * card stays scannable. Values are never recomputed.
 */
export function evidenceChips(finding: EngineFinding, currency: Currency): EvidenceChip[] {
  const entries = Object.entries(finding.evidence).filter(([key]) => !CHIP_SKIP_KEYS.has(key));
  const numeric = entries.filter(([, value]) => typeof value === 'number');
  const chosen = (numeric.length > 0 ? numeric : entries).slice(0, MAX_CHIPS);
  return chosen.map(([key, value]) => ({
    label: evidenceLabel(key),
    value: formatEvidenceValue(key, value, currency),
  }));
}

/** "G04" for the generator battery, "Probe · G02" for a probe-loop finding. */
function sourceLabel(finding: EngineFinding): string {
  return finding.origin === 'probe' ? `Probe · ${finding.generator}` : finding.generator;
}

export interface CardCopy {
  headline: string;
  mechanism: string;
  implication?: string;
  action?: string;
}

/**
 * Build a card. The narrative half (`copy`) comes from the engine's section
 * draft — the deck never writes prose of its own — while the evidence,
 * grading, and provenance halves come from the finding itself.
 */
export function buildFindingCard(
  finding: EngineFinding,
  copy: CardCopy,
  currency: Currency,
): FindingCard {
  return {
    findingId: finding.id,
    light: cardLight(finding),
    headline: copy.headline,
    evidenceChips: evidenceChips(finding, currency),
    mechanism: copy.mechanism,
    implication: copy.implication,
    action: copy.action,
    footer: {
      level: LEVEL_LABELS[finding.level] ?? finding.level,
      confidence:
        DECK_COPY.confidence[finding.confidence as keyof typeof DECK_COPY.confidence] ??
        finding.confidence,
      source: sourceLabel(finding),
    },
  };
}

/**
 * A named action for a table row, when a finding names that entity.
 *
 * PRD §3.5: at campaign granularity the red row *is* the culprit, so G04
 * (zero-yield) and G05 (marginal return) findings upgrade a generic
 * "Evaluasi" to "Matikan: [campaign], 0 pesanan pada belanja Rp N". The
 * figures come from `evidence`, so the numeral gate already covers them.
 */
export function namedRowAction(
  finding: EngineFinding | undefined,
  currency: Currency,
): string | undefined {
  if (!finding) return undefined;
  const chips = evidenceChips(finding, currency);
  const detail = chips
    .slice(0, 2)
    .map((chip) => `${chip.label.toLowerCase()} ${chip.value}`)
    .join(', ');

  switch (finding.claim_frame) {
    case 'zero_yield_spend':
      return detail ? `Matikan: ${detail}` : 'Matikan kampanye ini';
    case 'marginal_return_scaling':
      return detail ? `Tambah anggaran: ${detail}` : 'Tambah anggaran';
    case 'marginal_return_declining':
      return detail ? `Tahan anggaran: ${detail}` : 'Tahan anggaran';
    case 'efficiency_outlier_negative':
      return detail ? `Evaluasi: ${detail}` : 'Evaluasi kampanye ini';
    default:
      return undefined;
  }
}
