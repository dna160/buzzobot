import { describe, expect, it } from 'vitest';
import { resolveReportWindow, DEFAULT_WINDOW_DAYS } from './hourly-model.js';

describe('resolveReportWindow', () => {
  it('defaults to a trailing 7-day calendar window ending on the latest date', () => {
    const dates = ['2026-07-25', '2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01'];
    const win = resolveReportWindow(dates);
    expect(DEFAULT_WINDOW_DAYS).toBe(7);
    expect(win).toEqual(['2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01']);
  });

  it('scopes to the 7 calendar days ending on a clicked date, not the whole history', () => {
    // The exact scenario reported: clicking Jul 31 must show Jul 25-31, not
    // the account's entire ingested range.
    const dates = ['2026-07-01', '2026-07-15', '2026-07-25', '2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01'];
    const win = resolveReportWindow(dates, { endDate: '2026-07-31' });
    expect(win).toEqual(['2026-07-25', '2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31']);
  });

  it('is tolerant of gaps in the ingested history', () => {
    // Only 4 of the 7 calendar days actually have data — the window still
    // spans the real 7 calendar days (Jul 25-31), it just contains fewer
    // entries. A fixed calendar span with gaps is the intended behavior.
    const dates = ['2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01'];
    const win = resolveReportWindow(dates, { endDate: '2026-07-31' });
    expect(win).toEqual(['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31']);
  });

  it('clamps a requested date beyond the ingested range down to the latest available date', () => {
    const dates = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'];
    const win = resolveReportWindow(dates, { endDate: '2026-08-15' });
    expect(win[win.length - 1]).toBe('2026-07-31');
  });

  it('falls back to the latest available date when the requested one predates all ingested data', () => {
    // Mirrors getHourlyDashboard's own fallback (most recent date, never the
    // oldest) for a requested date with nothing to clamp down to.
    const dates = ['2026-07-27', '2026-07-28', '2026-07-29'];
    const win = resolveReportWindow(dates, { endDate: '2020-01-01' });
    expect(win).toEqual(['2026-07-27', '2026-07-28', '2026-07-29']);
  });

  it('honors a custom window size', () => {
    const dates = ['2026-07-25', '2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'];
    const win = resolveReportWindow(dates, { endDate: '2026-07-31', windowDays: 3 });
    expect(win).toEqual(['2026-07-29', '2026-07-30', '2026-07-31']);
  });

  it('returns an empty window for an empty history', () => {
    expect(resolveReportWindow([])).toEqual([]);
  });
});
