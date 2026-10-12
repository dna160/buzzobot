/**
 * Report-period wording for the header block. Pure (no clock access) — the
 * caller passes in "today" — and uses a fixed Indonesian month table rather
 * than `Intl`, so the same input always renders the same words regardless of
 * the ICU data on the machine generating the report.
 */

const MONTHS_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/** "2026-09-01" → "1 September 2026". */
export function formatIdDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_ID[(m ?? 1) - 1]} ${y}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The data layer's windows are [start, end) — this is the last day actually covered. */
export function inclusiveEnd(endExclusive: string): string {
  return addDays(endExclusive, -1);
}

export function daysBetween(start: string, endExclusive: string): number {
  return Math.round(
    (new Date(`${endExclusive}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

/** "1 September 2026 – 30 September 2026" for a [start, endExclusive) window. */
export function formatPeriodRange(start: string, endExclusive: string): string {
  return `${formatIdDate(start)} – ${formatIdDate(inclusiveEnd(endExclusive))}`;
}

/** Everything the header block prints about when and what a report covers. */
export interface ReportPeriodInfo {
  /** "1 September 2026 – 30 September 2026" */
  label: string;
  days: number;
  /** The equal-length window immediately before — what trend/growth % compare against. */
  comparisonLabel: string;
  comparisonDays: number;
  /** What §2/§3 are graded against (the comparison window, or industry/AM targets). */
  benchmarkLabel: string;
  /** Plain-language scope: which delivery types and which accounts the numbers cover. */
  coverage: string;
  /** Which template this is (GMV / Awareness / App Install). */
  templateLabel: string;
  /** "5 Oktober 2026" */
  generatedAt: string;
}

export function buildPeriodInfo(input: {
  start: string;
  endExclusive: string;
  priorStart: string;
  priorEndExclusive: string;
  benchmarkMode: 'industry' | 'previous_period';
  coverage: string;
  templateLabel: string;
  /** ISO date (YYYY-MM-DD) the report was generated. */
  generatedOn: string;
}): ReportPeriodInfo {
  const comparisonLabel = formatPeriodRange(input.priorStart, input.priorEndExclusive);
  return {
    label: formatPeriodRange(input.start, input.endExclusive),
    days: daysBetween(input.start, input.endExclusive),
    comparisonLabel,
    comparisonDays: daysBetween(input.priorStart, input.priorEndExclusive),
    benchmarkLabel:
      input.benchmarkMode === 'previous_period'
        ? `Periode pembanding (${comparisonLabel})`
        : 'Target benchmark industri / yang ditetapkan AM',
    coverage: input.coverage,
    templateLabel: input.templateLabel,
    generatedAt: formatIdDate(input.generatedOn),
  };
}
