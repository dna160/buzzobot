/**
 * Guards for the LLM-written prose in a Template Report. The model is only
 * ever handed already-computed facts and told to quote nothing else; these two
 * helpers make that checkable and repeatable:
 *
 *  - `stableSeed` — the same prompt + data always maps to the same sampling
 *    seed, so re-generating a report doesn't reshuffle its wording.
 *  - `ungroundedNumbers` — flags any figure in the prose that does not appear
 *    in the data the model was given (an invented or mis-copied number).
 *
 * Both are pure, so they are unit-tested rather than trusted.
 */

/** 32-bit FNV-1a of a string, as a positive integer — a stable seed for `text`. */
export function stableSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 2_147_483_647;
}

const NUMBER_TOKEN = /\d[\d.,]*\d|\d/g;

/** Digits only, no leading zeros — "7,79%" and "7.79%" and "+7.79" all become "779". */
const normalise = (token: string): string => token.replace(/\D/g, '').replace(/^0+/, '');

function tokens(text: string): string[] {
  return text.match(NUMBER_TOKEN) ?? [];
}

/**
 * Numbers of 3+ significant digits in `text` that never appear in `data`.
 * Shorter numbers ("3 metrik", "2 dari 5", "30 hari") and calendar years
 * ("September 2026") are ignored: they are counts, ordinals and dates the
 * model can legitimately write, and flagging them would only burn retries. Decimal/thousand separators are ignored, so a
 * number is matched by its digits.
 */
export function ungroundedNumbers(text: string, data: unknown): string[] {
  const known = new Set(tokens(typeof data === 'string' ? data : JSON.stringify(data)).map(normalise));
  const out: string[] = [];
  for (const token of tokens(text)) {
    const digits = normalise(token);
    if (digits.length < 3 || known.has(digits)) continue;
    // A calendar year ("September 2026") is not a data claim.
    if (/^(19|20)\d{2}$/.test(token)) continue;
    out.push(token);
  }
  return out;
}

/** Strips markdown emphasis, list bullets and wrapping quotes the model sometimes adds despite being told not to. */
export function cleanNarrative(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/^\s*[-•*]\s+/gm, '')
    .replace(/^["“”']+|["“”']+$/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}
