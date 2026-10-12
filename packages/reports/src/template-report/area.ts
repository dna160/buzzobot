import type { Status } from './rubric.js';

/**
 * Turns a health-check area's constituent checks into the three things a
 * reader needs to act on a "Kritis"/"Waspada" label: how many passed, what is
 * working, and exactly what needs improvement (with the number behind it).
 * Pure and deterministic — the same items always yield the same words — and
 * shared by every Template Report variant.
 */

export interface AreaItem {
  label: string;
  status: Status;
  /** The number behind the status, e.g. "-89.3% vs target" or "7.3% vs ideal 15–35%". */
  detail?: string;
  /** false when there is no benchmark/actual to judge against — excluded from the counts, listed separately. */
  scored?: boolean;
}

export interface ElaboratedArea {
  /** "2/3 metrik baik, 1/3 perlu perbaikan" */
  kondisi: string;
  /** What is on target. */
  working: string;
  /** What is not, worst first, with status and number. */
  improve: string;
}

/**
 * Shortens a long campaign/creative name so a table cell stays readable.
 * Truncates in the middle, not at the end: names within one account tend to
 * share a long prefix and differ only at the tail ("… - AEO - Install - IOS
 * 2026"), so cutting the tail would make different campaigns look identical.
 */
export function shortName(name: string, max = 34): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.5);
  const tail = keep - head;
  return `${clean.slice(0, head).trimEnd()}…${clean.slice(clean.length - tail).trimStart()}`;
}

const SEVERITY: Record<Status, number> = { Kritis: 0, Waspada: 1, Baik: 2 };

const withDetail = (i: AreaItem, extra?: string): string => {
  const parts = [i.detail, extra].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? `${i.label} (${parts.join(', ')})` : i.label;
};

export function elaborateArea(items: AreaItem[], opts: { noun?: string } = {}): ElaboratedArea {
  const noun = opts.noun ?? 'metrik';
  const scored = items.filter((i) => i.scored !== false);
  const unscored = items.filter((i) => i.scored === false);
  const good = scored.filter((i) => i.status === 'Baik');
  const bad = scored
    .filter((i) => i.status !== 'Baik')
    .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status]);
  const n = scored.length;

  let kondisi: string;
  if (n === 0) kondisi = `Belum ada ${noun} yang bisa dinilai`;
  else if (good.length === n) kondisi = `Semua ${n} ${noun} baik`;
  else kondisi = `${good.length}/${n} ${noun} baik, ${n - good.length}/${n} perlu perbaikan`;

  const working =
    n === 0 ? '—' : good.length > 0 ? good.map((i) => withDetail(i)).join('; ') : 'Belum ada yang mencapai target';

  const improveParts: string[] = [];
  if (bad.length > 0) improveParts.push(bad.map((i) => withDetail(i, i.status)).join('; '));
  else if (n > 0) improveParts.push('Tidak ada — semua sesuai target');
  if (unscored.length > 0) {
    improveParts.push(`Belum dinilai (benchmark/data belum ada): ${unscored.map((i) => i.label).join(', ')}`);
  }

  return { kondisi, working, improve: improveParts.join('. ') || '—' };
}
