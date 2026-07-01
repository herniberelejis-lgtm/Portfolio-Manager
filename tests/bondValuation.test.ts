import { describe, it, expect } from 'vitest';
import { classifyInstrument, noLivePriceTickers } from '../static-app/src/analytics';
import { buildView, type ParsedTransaction } from '../static-app/src/portfolio';

// Regression for the GD35 bug: a sovereign bond snapshot ("BONOS REP. ARG. ...")
// was classified as an equity, so data912's per-100-nominal price fed a raw
// quantity*price and inflated the position ~100x (GD35 showed as 92% of a
// portfolio). Bonds/FCI must be recognized and valued at imported cost.

function holding(instrumento: string, ticker: string, quantity: number, totalPesos: number): ParsedTransaction {
  return {
    date: new Date('2026-06-19'),
    type: 'buy',
    ticker,
    quantity,
    price: null,
    currency: 'ARS',
    amountCents: BigInt(Math.round(totalPesos * 100)),
    rawRow: { instrumento },
  };
}

describe('classifyInstrument', () => {
  it('classifies sovereign bonds (BONOS ...) as Bono/ON', () => {
    expect(classifyInstrument('BONOS REP. ARG. U$S STEP UP V.09/07/35 (GD35)')).toBe('Bono/ON');
    expect(classifyInstrument('BONAR 2030 (AL30)')).toBe('Bono/ON');
    expect(classifyInstrument('LETRA DEL TESORO (S31L5)')).toBe('Bono/ON');
  });

  it('still classifies CEDEARs, FCI and equities correctly', () => {
    expect(classifyInstrument('CEDEAR APPLE INC. (AAPL)')).toBe('CEDEAR');
    expect(classifyInstrument('FCI COCOS RENDIMIENTO CL. A $ ESC (COCORMA)')).toBe('FCI');
    expect(classifyInstrument('ALUAR S.A ORD 1 V ESCRITURALES (ALUA)')).toBe('Acción ARG');
  });
});

describe('noLivePriceTickers', () => {
  it('includes bonds so their live price never overrides the imported value', () => {
    const txs = [
      holding('BONOS REP. ARG. U$S STEP UP V.09/07/35 (GD35)', 'GD35', 135, 167400),
      holding('CEDEAR APPLE INC. (AAPL)', 'AAPL', 1, 23010),
    ];
    const set = noLivePriceTickers(txs);
    expect(set.has('GD35')).toBe(true);
    expect(set.has('AAPL')).toBe(false);
  });
});

describe('buildView snapshot valuation for bonds', () => {
  const txs = [
    holding('BONOS REP. ARG. U$S STEP UP V.09/07/35 (GD35)', 'GD35', 135, 167400),
    holding('CEDEAR APPLE INC. (AAPL)', 'AAPL', 1, 23010),
  ];

  it('values GD35 at imported cost even when a bad per-100 price is stored', () => {
    const snapshot = noLivePriceTickers(txs);
    // data912-style corrupt price: 124000 pesos per unit (should be per 100 VN).
    const prices = { GD35: 12400000n, AAPL: 2301000n };
    const view = buildView(txs, prices, snapshot);
    const gd35 = view.positions.find((p) => p.ticker === 'GD35')!;
    // Correct value is the imported total, ~$167.400 — not 100x that.
    expect(gd35.marketValueCents).toBe(16740000n);
    expect(gd35.pctOfPortfolio).toBeLessThan(90); // was ~92.6% before the fix
  });

  it('without the snapshot set the bug reproduces (100x)', () => {
    const prices = { GD35: 12400000n, AAPL: 2301000n };
    const view = buildView(txs, prices); // no snapshotValued
    const gd35 = view.positions.find((p) => p.ticker === 'GD35')!;
    expect(gd35.marketValueCents).toBe(135n * 12400000n); // inflated
  });
});
