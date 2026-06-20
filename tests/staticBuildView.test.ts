import { describe, it, expect } from 'vitest';
import { buildView, parseCsv, type ParsedTransaction } from '../static-app/src/portfolio';

function mk(date: string, type: ParsedTransaction['type'], ticker: string | null, quantity: number | null, amount: number): ParsedTransaction {
  return { date: new Date(date), type, ticker, quantity, price: null, currency: 'ARS', amountCents: BigInt(amount * 100), rawRow: {} };
}

describe('buildView (browser aggregation)', () => {
  const txs: ParsedTransaction[] = [
    mk('2025-01-10', 'buy', 'GGAL', 100, 350000),
    mk('2025-02-05', 'buy', 'YPFD', 20, 560000),
    mk('2025-03-12', 'buy', 'GGAL', 50, 210000),
    mk('2025-04-01', 'buy', 'AL30', 1000, 70000),
    mk('2025-05-20', 'sell', 'GGAL', 60, 312000),
    mk('2025-06-02', 'buy', 'YPFD', 10, 410000),
  ];

  it('aggregates held positions with correct quantities', () => {
    const v = buildView(txs, {});
    const byTicker = Object.fromEntries(v.positions.map(p => [p.ticker, p]));
    expect(v.positions.length).toBe(3);
    expect(byTicker.GGAL.quantity).toBe(90);
    expect(byTicker.YPFD.quantity).toBe(30);
    expect(byTicker.AL30.quantity).toBe(1000);
  });

  it('realizes proportional gain on the GGAL sell', () => {
    const v = buildView(txs, {});
    const ggal = v.positions.find(p => p.ticker === 'GGAL')!;
    // cost 560000, sold 60/150 -> costOfSold 224000, proceeds 312000 -> +88000 pesos
    expect(ggal.realizedPnlCents).toBe(8800000n);
    expect(v.totals.realizedPnlCents).toBe(8800000n);
  });

  it('uses provided prices for market value and unrealized P&L', () => {
    const v = buildView(txs, { GGAL: 520000n }); // $5200/unit in cents
    const ggal = v.positions.find(p => p.ticker === 'GGAL')!;
    expect(ggal.marketValueCents).toBe(90n * 520000n);
    expect(ggal.unrealizedPnlCents).toBe(90n * 520000n - 33600000n); // mv - remaining cost
  });

  it('builds a cumulative history with one point per buy/sell event', () => {
    const v = buildView(txs, {});
    expect(v.history.length).toBe(6);
  });

  it('parses a Cocos-style CSV through the reused parser', () => {
    // smoke: detectAndParse should at least throw a known error for junk, not crash on import
    expect(() => parseCsv('foo,bar\n1,2')).toThrow();
  });
});
