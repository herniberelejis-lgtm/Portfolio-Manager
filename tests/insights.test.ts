import { describe, it, expect } from 'vitest';
import { coreConclusions } from '../static-app/src/insights';

const base = {
  maxPosTicker: 'CELU', maxPosPct: 10, maxClassName: 'CEDEAR', maxClassPct: 40, classCount: 3,
  usdPct: 50, winRatePct: 50, totalSales: 10, riskReward: 1.5, costsPctOfVolume: 0.5,
  totalPnlCents: 100000n, returnPct: 5, holdingsCount: 6,
};

describe('coreConclusions', () => {
  it('flags heavy concentration as bad', () => {
    const c = coreConclusions({ ...base, maxPosTicker: 'CELU', maxPosPct: 80 });
    expect(c.find((x) => x.title.includes('concentrada'))?.level).toBe('bad');
    expect(c[0].level).toBe('bad'); // sorted: bad first
  });
  it('warns on low USD exposure', () => {
    const c = coreConclusions({ ...base, usdPct: 15 });
    expect(c.some((x) => x.title.includes('tipo de cambio') && x.level === 'warn')).toBe(true);
  });
  it('detects the CEDEAR-wins / ARG-loses pattern', () => {
    const c = coreConclusions({ ...base, cedear: { winRatePct: 80, realizedCents: 7000000n }, arg: { winRatePct: 24, realizedCents: -6800000n } });
    expect(c.some((x) => x.title.includes('CEDEARs'))).toBe(true);
  });
  it('reports a positive overall result', () => {
    const c = coreConclusions({ ...base, totalPnlCents: 500000n, returnPct: 12 });
    expect(c.some((x) => x.title.includes('positivo') && x.level === 'good')).toBe(true);
  });
});
