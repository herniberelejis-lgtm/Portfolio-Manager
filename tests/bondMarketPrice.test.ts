import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildView, type ParsedTransaction } from '../static-app/src/portfolio';
import { noLivePriceTickers } from '../static-app/src/analytics';
import { fetchMepRate, fetchBondPricesPer100 } from '../src/lib/market/data912Client';

function buy(ticker: string, qty: number, amount: number, currency: 'ARS' | 'USD', instrumento: string): ParsedTransaction {
  return {
    date: new Date('2026-09-04'),
    type: 'buy',
    ticker,
    quantity: qty,
    price: null,
    currency,
    amountCents: BigInt(Math.round(amount * 100)),
    rawRow: { instrumento, tipoOperacion: 'Compra' },
  };
}

const TXS = [
  buy('MGCTD', 3735, 3849.93, 'USD', 'ON PAMPA ENERGIA S.A. CL.27 U$S (MGCTD)'),
  buy('GD35', 135, 167400, 'ARS', 'BONOS REP. ARG. U$S STEP UP V.09/07/35 (GD35)'),
];
const snap = noLivePriceTickers(TXS);

describe('bonds at market price (quoted per 100 VN)', () => {
  it('values a bond as quantity × price / 100', () => {
    // MGCTD at US$100,01 per 100 VN (BYMALAB 09/10).
    const v = buildView(TXS, {}, snap, 1534.91, { MGCTD: 10001n });
    const m = v.positions.find((p) => p.ticker === 'MGCTD')!;
    expect(m.marketValueCents).toBe(BigInt(Math.round(3735 * 10001 / 100)));
    expect(m.unrealizedPnlCents).toBe(m.marketValueCents - 384993n);
    expect(m.valuedAtCost).toBe(false);
  });

  it('GD35 at 124.000 per 100 gives the real $167.400, not 100x', () => {
    const v = buildView(TXS, {}, snap, undefined, { GD35: 12_400_000n });
    expect(v.positions.find((p) => p.ticker === 'GD35')!.marketValueCents).toBe(16_740_000n);
  });

  it('ignores a quote in the wrong unit and falls back to cost', () => {
    // 1,0001 "per nominal" mistaken as per 100 → 1% of real value: rejected.
    const v = buildView(TXS, {}, snap, undefined, { MGCTD: 100n });
    const m = v.positions.find((p) => p.ticker === 'MGCTD')!;
    expect(m.valuedAtCost).toBe(true);
    expect(m.marketValueCents).toBe(384993n);
  });

  it('without a quote stays at cost', () => {
    const m = buildView(TXS, {}, snap).positions.find((p) => p.ticker === 'MGCTD')!;
    expect(m.valuedAtCost).toBe(true);
    expect(m.unrealizedPnlCents).toBe(0n);
  });
});

describe('data912 bond feeds', () => {
  afterEach(() => vi.unstubAllGlobals());
  const feeds: Record<string, unknown> = {
    '/live/arg_bonds': [
      { symbol: 'AL30', c: 83300 },
      { symbol: 'AL30D', c: 54.27 },
    ],
    '/live/arg_corp': [{ symbol: 'MGCTD', c: 100.01 }],
  };
  const stub = () =>
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      return { ok: true, json: async () => feeds[path] ?? [] } as Response;
    }));

  it('derives the MEP from AL30 / AL30D', async () => {
    stub();
    expect(await fetchMepRate()).toBeCloseTo(83300 / 54.27, 6);
  });

  it('returns bond quotes per 100 VN', async () => {
    stub();
    expect(await fetchBondPricesPer100(['MGCTD', 'XXX'])).toEqual({ MGCTD: 100.01 });
  });
});
