/**
 * Indonesian number formatting for the Strategy Report: `.` groups thousands,
 * `,` is the decimal mark. Prose numerals come from the engine already
 * formatted; these format the values tables and charts print — always from the
 * engine's own exported numbers, never recomputed.
 */

const nf = (digits: number) =>
  new Intl.NumberFormat('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const num = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? '—' : nf(0).format(v));

export const dec = (v: number | null | undefined, digits = 2): string =>
  v == null || !Number.isFinite(v) ? '—' : nf(digits).format(v);

/** 0.0447 → "4,47%"; shares under 1% keep three decimals so they never read as 0. */
export const pct = (ratio: number | null | undefined, digits = 1): string => {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  const v = ratio * 100;
  return `${nf(Math.abs(v) > 0 && Math.abs(v) < 1 ? Math.max(digits, 3) : digits).format(v)}%`;
};

/** 1_852_491 → "1,9 jt"; 129_635 → "129,6 rb". For chart labels and tight table cells. */
export const compact = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${dec(v / 1e9, 1)} M`;
  if (a >= 1e6) return `${dec(v / 1e6, 1)} jt`;
  if (a >= 1e4) return `${dec(v / 1e3, 1)} rb`;
  return num(v);
};

export const idr = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? '—' : `Rp${num(v)}`);
export const idrCompact = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `Rp${compact(v)}`;

export const rank = (r: number | null | undefined, n?: number | null): string =>
  r == null ? '—' : n ? `#${r} dari ${num(n)}` : `#${r}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "2026-10-10" → "10 Okt 2026" (the date is a TTMS UTC day; printed as-is). */
export const idDate = (iso: string | null | undefined): string => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso ?? '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
};

export const idShortDate = (iso: string): string => idDate(iso).replace(/ \d{4}$/, '');
