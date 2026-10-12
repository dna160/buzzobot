import { describe, expect, it } from 'vitest';
import { buildPeriodInfo, formatIdDate, formatPeriodRange, inclusiveEnd } from './period.js';

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
