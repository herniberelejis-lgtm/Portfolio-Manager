import { describe, it, expect } from 'vitest';
import { buildView, type ParsedTransaction } from '../static-app/src/portfolio';
import { noLivePriceTickers, portfolioSummary } from '../static-app/src/analytics';

// Regression for a mixed ARS/USD portfolio: USD positions showed 0.0% of the
// portfolio (dollars summed as if they were pesos) and USD ONs valued "at cost"
// showed tens of dollars of fake P&L from rounding the ~US$1,03 unit price.

function tx(
  ticker: string,
  type: 'buy' | 'sell',
  qty: number,
  amount: number,
  currency: 'ARS' | 'USD',
  instrumento: string,
  date = '2026-09-04',
): ParsedTransaction {
  return {
    date: new Date(date),
    type,
    ticker,
    quantity: qty,
    price: null,
    currency,
    amountCents: BigInt(Math.round(amount * 100)),
    rawRow: { instrumento, tipoOperacion: type === 'buy' ? 'Compra' : 'Venta' },
  };
}

const TXS: ParsedTransaction[] = [
  tx('PEP', 'buy', 338, 4_191_200, 'ARS', 'CEDEAR PEPSICO INC. (PEP)'),
  // MGCTD: 2.000 @ 102,60 + 2.559 @ 103,45 − 824 @ 102,05 (USD, per 100 VN)
  tx('MGCTD', 'buy', 2000, 2052.0, 'USD', 'ON PAMPA ENERGIA S.A. CL.27 U$S (MGCTD)', '2026-09-04'),
  tx('MGCTD', 'buy', 2559, 2647.29, 'USD', 'ON PAMPA ENERGIA S.A. CL.27 U$S (MGCTD)', '2026-09-07'),
  tx('MGCTD', 'sell', 824, 840.89, 'USD', 'ON PAMPA ENERGIA S.A. CL.27 U$S (MGCTD)', '2026-09-24'),
];
const FX = 1500;

describe('mixed ARS/USD portfolio with an FX rate', () => {
  const snap = noLivePriceTickers(TXS);
  const view = buildView(TXS, { PEP: 1_240_000n }, snap, FX);

  it('gives USD positions their real share of the portfolio', () => {
    const mgctd = view.positions.find((p) => p.ticker === 'MGCTD')!;
    const pep = view.positions.find((p) => p.ticker === 'PEP')!;
    // ~US$3.850 × 1.500 ≈ $5,77M vs PEP $4,19M → MGCTD is the biggest.
    expect(mgctd.pctOfPortfolio).toBeGreaterThan(50);
    expect(pep.pctOfPortfolio).toBeGreaterThan(30);
    expect(view.positions[0].ticker).toBe('MGCTD');
    expect(mgctd.pctOfPortfolio + pep.pctOfPortfolio).toBeCloseTo(100, 5);
  });

  it('values bonds at exactly their remaining cost (no rounding P&L)', () => {
    const mgctd = view.positions.find((p) => p.ticker === 'MGCTD')!;
    expect(mgctd.unrealizedPnlCents).toBe(0n);
    // Remaining cost after the partial sale, not qty × rounded avg price.
    expect(mgctd.marketValueCents).toBe(2052_00n + 2647_29n - 849_36n);
    expect(mgctd.valueArsCents).toBe(BigInt(Math.round(Number(mgctd.marketValueCents) * FX)));
  });

  it('expresses totals in pesos', () => {
    const mgctd = view.positions.find((p) => p.ticker === 'MGCTD')!;
    const pep = view.positions.find((p) => p.ticker === 'PEP')!;
    expect(view.totals.marketValueCents).toBe(mgctd.valueArsCents + pep.valueArsCents);
  });

  it('portfolioSummary concentrates across currencies and counts USD exposure', () => {
    const sum = portfolioSummary(TXS, { PEP: 1_240_000n }, FX);
    expect(sum.conc.map((c) => c.ticker)).toEqual(['MGCTD', 'PEP']);
    // CEDEAR + USD ON both track the dollar.
    expect(sum.usdPct).toBeCloseTo(100, 5);
    expect(sum.currentValueCents).toBe(view.totals.marketValueCents);
  });

  it('without an FX rate keeps the legacy raw sum', () => {
    const legacy = buildView(TXS, { PEP: 1_240_000n }, snap);
    const mgctd = legacy.positions.find((p) => p.ticker === 'MGCTD')!;
    expect(mgctd.valueArsCents).toBe(mgctd.marketValueCents);
  });
});
