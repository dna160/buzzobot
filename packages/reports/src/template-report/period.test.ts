import { describe, expect, it } from 'vitest';
import {
  buildPeriodInfo,
  defaultReportRange,
  formatIdDate,
  formatPeriodRange,
  inclusiveEnd,
  jakartaYesterday,
  monthReportRange,
  reportRangeIssue,
} from './period.js';

describe('shared-report windows (Asia/Jakarta, H-1)', () => {
  it('takes yesterday on the WIB calendar, not the UTC one', () => {
    // 13 Oct 18:00 UTC is already 14 Oct 01:00 in Jakarta.
    expect(jakartaYesterday(new Date('2026-10-13T18:00:00Z'))).toBe('2026-10-13');
    expect(jakartaYesterday(new Date('2026-10-13T16:59:59Z'))).toBe('2026-10-12');
  });

  it('defaults to this month through yesterday', () => {
    expect(defaultReportRange('2026-10-12')).toEqual({ from: '2026-10-01', to: '2026-10-12' });
  });

  it('falls back to the whole previous month on the 1st', () => {
    // On 1 Oct, yesterday is 30 Sep.
    expect(defaultReportRange(jakartaYesterday(new Date('2026-10-01T03:00:00Z')))).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(defaultReportRange('2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('clips a month to the latest day, and refuses one that has not started', () => {
    expect(monthReportRange('2026-02', '2026-10-12')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthReportRange('2028-02', '2028-12-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthReportRange('2026-10', '2026-10-12')).toEqual({ from: '2026-10-01', to: '2026-10-12' });
    expect(monthReportRange('2026-11', '2026-10-12')).toBeNull();
    expect(monthReportRange('2026-13', '2026-10-12')).toBeNull();
  });

  it('rejects impossible, inverted, future and oversized windows', () => {
    const latest = '2026-10-12';
    expect(reportRangeIssue({ from: '2026-09-01', to: '2026-09-30' }, latest, 366)).toBeNull();
    expect(reportRangeIssue({ from: '2026-02-30', to: '2026-03-01' }, latest, 366)).toMatch(/real dates/);
    expect(reportRangeIssue({ from: '2026-09-30', to: '2026-09-01' }, latest, 366)).toMatch(/on or before/);
    expect(reportRangeIssue({ from: '2026-10-01', to: '2026-10-13' }, latest, 366)).toMatch(/day late/);
    expect(reportRangeIssue({ from: '2025-01-01', to: '2026-01-02' }, latest, 366)).toMatch(/at most 366/);
    expect(reportRangeIssue({ from: '2025-01-02', to: '2026-01-02' }, latest, 366)).toBeNull();
  });
});

describe('period wording', () => {
  it('formats Indonesian dates without relying on Intl/ICU', () => {
    expect(formatIdDate('2026-09-01')).toBe('1 September 2026');
    expect(formatIdDate('2026-08-31')).toBe('31 Agustus 2026');
    expect(formatIdDate('2026-12-05')).toBe('5 Desember 2026');
  });

  it('turns an exclusive window end into the last covered day', () => {
    expect(inclusiveEnd('2026-10-01')).toBe('2026-09-30');
    expect(formatPeriodRange('2026-09-01', '2026-10-01')).toBe('1 September 2026 – 30 September 2026');
  });

  it('describes the period, its equal-length comparison window and the scope', () => {
    const info = buildPeriodInfo({
      start: '2026-09-01',
      endExclusive: '2026-10-01',
      priorStart: '2026-08-02',
      priorEndExclusive: '2026-09-01',
      benchmarkMode: 'previous_period',
      coverage: 'TTAM + GMV Max',
      templateLabel: 'GMV / TikTok Shop',
      generatedOn: '2026-10-05',
    });
    expect(info.label).toBe('1 September 2026 – 30 September 2026');
    expect(info.days).toBe(30);
    expect(info.comparisonLabel).toBe('2 Agustus 2026 – 31 Agustus 2026');
    expect(info.comparisonDays).toBe(30);
    expect(info.benchmarkLabel).toContain('2 Agustus 2026 – 31 Agustus 2026');
    expect(info.generatedAt).toBe('5 Oktober 2026');
  });

  it('labels the benchmark as industry/AM targets in industry mode', () => {
    const info = buildPeriodInfo({
      start: '2026-09-01',
      endExclusive: '2026-10-01',
      priorStart: '2026-08-02',
      priorEndExclusive: '2026-09-01',
      benchmarkMode: 'industry',
      coverage: 'x',
      templateLabel: 'y',
      generatedOn: '2026-10-05',
    });
    expect(info.benchmarkLabel).toMatch(/industri/i);
  });
});
