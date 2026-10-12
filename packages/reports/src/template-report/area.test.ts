import { describe, expect, it } from 'vitest';
import { elaborateArea, shortName } from './area.js';

describe('elaborateArea', () => {
  it('says how many passed and names what works and what does not', () => {
    const r = elaborateArea([
      { label: 'ROI', status: 'Baik', detail: '+41.9% vs target' },
      { label: 'CVR', status: 'Kritis', detail: '-89.3% vs target' },
      { label: 'CPA', status: 'Waspada', detail: '+5.0% vs target' },
    ]);
    expect(r.kondisi).toBe('1/3 metrik baik, 2/3 perlu perbaikan');
    expect(r.working).toBe('ROI (+41.9% vs target)');
    // worst first, with the status spelled out
    expect(r.improve).toBe('CVR (-89.3% vs target, Kritis); CPA (+5.0% vs target, Waspada)');
  });

  it('reads 2/3 vs 1/3 the way the report asks for', () => {
    const r = elaborateArea([
      { label: 'A', status: 'Baik' },
      { label: 'B', status: 'Baik' },
      { label: 'C', status: 'Kritis' },
    ]);
    expect(r.kondisi).toBe('2/3 metrik baik, 1/3 perlu perbaikan');
  });

  it('handles an all-good and an all-bad area', () => {
    expect(
      elaborateArea([
        { label: 'A', status: 'Baik' },
        { label: 'B', status: 'Baik' },
      ]).kondisi,
    ).toBe('Semua 2 metrik baik');
    const bad = elaborateArea([{ label: 'A', status: 'Kritis' }]);
    expect(bad.kondisi).toBe('0/1 metrik baik, 1/1 perlu perbaikan');
    expect(bad.working).toBe('Belum ada yang mencapai target');
  });

  it('keeps unscored items out of the counts but still lists them', () => {
    const r = elaborateArea([
      { label: 'CPM', status: 'Baik' },
      { label: 'Cost per Add to Cart', status: 'Waspada', scored: false },
    ]);
    expect(r.kondisi).toBe('Semua 1 metrik baik');
    expect(r.improve).toContain('Belum dinilai');
    expect(r.improve).toContain('Cost per Add to Cart');
  });

  it('uses a custom noun', () => {
    const r = elaborateArea(
      [
        { label: 'TOF', status: 'Baik' },
        { label: 'MOF', status: 'Waspada' },
      ],
      { noun: 'tahap funnel' },
    );
    expect(r.kondisi).toBe('1/2 tahap funnel baik, 1/2 perlu perbaikan');
  });

  it('shortens long names', () => {
    expect(shortName('short')).toBe('short');
    expect(shortName('x'.repeat(60), 20).length).toBeLessThanOrEqual(20);
    expect(shortName('x'.repeat(60), 20)).toContain('…');
  });

  it('truncates in the middle so campaigns that differ only at the end stay distinguishable', () => {
    const a = shortName('Treasury x BZHR - App promotion - AEO - Registration 2024', 34);
    const b = shortName('Treasury x BZHR - App promotion - AEO - Install - IOS 2026', 34);
    expect(a).not.toBe(b);
    expect(a.endsWith('2024')).toBe(true);
    expect(b.endsWith('2026')).toBe(true);
  });
});
