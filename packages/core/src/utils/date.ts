/**
 * Date helpers operating on ISO date strings (YYYY-MM-DD) in UTC. We avoid
 * Date-object timezone surprises by treating dates as opaque calendar days.
 */

export type IsoDate = string;

const MS_PER_DAY = 86_400_000;

/** Parse a YYYY-MM-DD string into a UTC-midnight Date. */
export const parseIsoDate = (d: IsoDate): Date => new Date(`${d}T00:00:00.000Z`);

/** Format a Date as YYYY-MM-DD in UTC. */
export const toIsoDate = (d: Date): IsoDate => d.toISOString().slice(0, 10);

/** Add (or subtract) whole days to an ISO date. */
export const addDays = (d: IsoDate, days: number): IsoDate =>
  toIsoDate(new Date(parseIsoDate(d).getTime() + days * MS_PER_DAY));

/** Inclusive count of days between two ISO dates. */
export const daysBetween = (start: IsoDate, end: IsoDate): number =>
  Math.round((parseIsoDate(end).getTime() - parseIsoDate(start).getTime()) / MS_PER_DAY) + 1;

/** Every ISO date from start to end, inclusive. */
export const eachDay = (start: IsoDate, end: IsoDate): IsoDate[] => {
  const out: IsoDate[] = [];
  const total = daysBetween(start, end);
  for (let i = 0; i < total; i += 1) out.push(addDays(start, i));
  return out;
};

export interface DateRange {
  start: IsoDate;
  end: IsoDate;
}

/**
 * The immediately-preceding window of equal length, for period-over-period
 * comparisons. A 30-day range ending today compares to the prior 30 days.
 */
export const previousRange = (range: DateRange): DateRange => {
  const len = daysBetween(range.start, range.end);
  return {
    start: addDays(range.start, -len),
    end: addDays(range.start, -1),
  };
};

/** Common preset windows anchored to a reference "today". */
export const rangePreset = (
  preset: '7d' | '28d' | '30d' | '90d',
  today: IsoDate,
): DateRange => {
  const map: Record<typeof preset, number> = { '7d': 7, '28d': 28, '30d': 30, '90d': 90 };
  const len = map[preset];
  return { start: addDays(today, -(len - 1)), end: today };
};
