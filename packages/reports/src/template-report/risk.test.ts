import { describe, expect, it } from 'vitest';
import { buildRisks, RISK_IMPACT } from './risk.js';

describe('buildRisks', () => {
  const areas = [
    { key: 'funnel', area: 'Alokasi Budget Funnel', status: 'Waspada' as const, improve: 'Conversion 88% vs 64–84%' },
    { key: 'conversion', area: 'Efisiensi Konversi', status: 'Kritis' as const, improve: 'CVR (6.9% vs 64.4%, Kritis)' },
    { key: 'trend', area: 'Tren', status: 'Baik' as const, improve: 'Tidak ada' },
  ];

  it('lists only areas that are not Baik, worst first', () => {
    const risks = buildRisks(areas);
    expect(risks.map((r) => r.risiko)).toEqual(['Efisiensi Konversi', 'Alokasi Budget Funnel']);
    expect(risks.map((r) => r.level)).toEqual(['High', 'Medium']);
  });

  it('carries the evidence and a specific impact statement', () => {
    const [first] = buildRisks(areas);
    expect(first?.bukti).toBe('CVR (6.9% vs 64.4%, Kritis)');
    expect(first?.dampak).toBe(RISK_IMPACT.conversion);
  });

  it('returns nothing when every area is healthy', () => {
    expect(buildRisks([{ key: 'x', area: 'X', status: 'Baik', improve: '' }])).toEqual([]);
  });

  it('falls back to a generic impact for an unknown area key', () => {
    const [r] = buildRisks([{ key: 'unknown', area: 'U', status: 'Waspada', improve: 'x' }]);
    expect(r?.dampak.length).toBeGreaterThan(10);
  });
});
