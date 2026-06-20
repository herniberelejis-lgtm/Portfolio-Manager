import { describe, it, expect } from 'vitest';
import { valueAtDate, latestValue, inflationAccum } from '../static-app/src/benchmarks';

describe('benchmarks compute', () => {
  const ccl = [
    { fecha: '2025-01-01', venta: 1000 },
    { fecha: '2025-06-01', venta: 1200 },
    { fecha: '2026-01-01', venta: 1500 },
  ];
  it('valueAtDate picks the point on or before the date', () => {
    expect(valueAtDate(ccl, new Date('2025-03-15'))).toBe(1000);
    expect(valueAtDate(ccl, new Date('2025-08-01'))).toBe(1200);
    expect(latestValue(ccl)).toBe(1500);
  });
  it('inflationAccum compounds monthly from the start month', () => {
    const infl = [
      { fecha: '2025-01-01', valor: 10 },
      { fecha: '2025-02-01', valor: 10 },
      { fecha: '2025-03-01', valor: 10 },
    ];
    // from Feb: (1.1*1.1)-1 = 21%
    expect(inflationAccum(infl, new Date('2025-02-10'))).toBeCloseTo(21, 5);
  });
});
