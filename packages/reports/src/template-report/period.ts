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

/**
 * Yesterday in Asia/Jakarta — the newest day a report can cover, since the
 * warehouse lands each day on the next (H-1). WIB is a fixed UTC+7 with no
 * DST, so this is arithmetic rather than an `Intl` lookup, for the same
 * reason the month names above are a table.
 */
export function jakartaYesterday(now: Date): string {
  const wib = new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  return addDays(wib, -1);
}

export interface ReportDateRange {
  /** First day, YYYY-MM-DD. */
  from: string;
  /** Last day, inclusive, YYYY-MM-DD. */
  to: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

function isRealDate(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  // "2026-13-01" is Invalid Date (toISOString would throw); "2026-02-30" rolls over to March.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/**
 * One calendar month ("2026-10"), clipped to `latestDay` — the current month
 * reads "1 Oct – yesterday". Null for a month that has not started by then.
 */
export function monthReportRange(month: string, latestDay: string): ReportDateRange | null {
  if (!ISO_MONTH.test(month)) return null;
  const from = `${month}-01`;
  if (!isRealDate(from) || from > latestDay) return null;
  const [y, m] = month.split('-').map(Number);
  const lastOfMonth = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  return { from, to: lastOfMonth < latestDay ? lastOfMonth : latestDay };
}

/**
 * The window a shared report opens on: the month `latestDay` falls in,
 * through `latestDay`. On the 1st, `latestDay` is the last day of the prior
 * month, so this is that whole month — never an empty "1 Oct – 30 Sep".
 */
export function defaultReportRange(latestDay: string): ReportDateRange {
  return monthReportRange(latestDay.slice(0, 7), latestDay)!;
}

/** Why a requested window cannot be generated, or null when it can. */
export function reportRangeIssue(
  range: ReportDateRange,
  latestDay: string,
  maxDays: number,
): string | null {
  if (!isRealDate(range.from) || !isRealDate(range.to)) return 'from/to must be real dates (YYYY-MM-DD)';
  if (range.from > range.to) return 'from must be on or before to';
  if (range.to > latestDay) return `to cannot be after ${latestDay} — data lands a day late`;
  if (daysBetween(range.from, addDays(range.to, 1)) > maxDays) return `a range can cover at most ${maxDays} days`;
  return null;
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
