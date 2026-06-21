import { describe, it, expect } from 'vitest';
import { toReturns, stdev, annualizedVolPct, maxDrawdownPct, correlation, monthlyVaR95Pct, cumulativeValue } from '../static-app/src/risk';

describe('risk math', () => {
  it('toReturns computes simple daily returns', () => {
    const r = toReturns([100, 110, 99]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 10);
    expect(r[1]).toBeCloseTo(-0.1, 10);
  });
  it('maxDrawdownPct finds peak-to-trough', () => {
    expect(maxDrawdownPct([100, 120, 90, 130])).toBeCloseTo(-25, 5);
    expect(maxDrawdownPct([100, 101, 102])).toBeCloseTo(0, 5);
  });
  it('correlation is +1 for identical, -1 for opposite', () => {
    expect(correlation([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 6);
    expect(correlation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 6);
  });
  it('annualized vol scales daily stdev by sqrt(252)', () => {
    const r = [0.01, -0.01, 0.02, -0.02, 0.0];
    expect(annualizedVolPct(r)).toBeCloseTo(stdev(r) * Math.sqrt(252) * 100, 6);
  });
  it('monthly VaR 95 uses z=1.645 and sqrt(21)', () => {
    const r = [0.01, -0.01, 0.02, -0.02];
    expect(monthlyVaR95Pct(r)).toBeCloseTo(1.645 * stdev(r) * Math.sqrt(21) * 100, 6);
  });
  it('cumulativeValue compounds from base 100', () => {
    const v = cumulativeValue([0.1, -0.5]);
    expect(v[0]).toBe(100);
    expect(v[1]).toBeCloseTo(110, 6);
    expect(v[2]).toBeCloseTo(55, 6);
  });
});
