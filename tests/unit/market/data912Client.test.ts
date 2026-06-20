import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchLivePrices } from '@/lib/market/data912Client';

describe('fetchLivePrices', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('maps the API response to price entries in cents', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [
        { symbol: 'GGAL', c: 5050.5, currency: 'ARS' },
        { symbol: 'YPFD', c: 30000, currency: 'ARS' },
      ],
    });

    const prices = await fetchLivePrices(['GGAL', 'YPFD']);

    expect(prices).toEqual([
      { ticker: 'GGAL', priceCents: 505050n, currency: 'ARS' },
      { ticker: 'YPFD', priceCents: 3000000n, currency: 'ARS' },
    ]);
  });

  it('returns no prices (gracefully) when the feeds are unavailable', async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 503 });

    await expect(fetchLivePrices(['GGAL'])).resolves.toEqual([]);
  });

  it('merges quotes across feeds (e.g. a stock and a CEDEAR) and de-dups', async () => {
    (global.fetch as any).mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          url.includes('arg_cedears')
            ? [{ symbol: 'JPM', c: 31570 }]
            : url.includes('arg_stocks')
              ? [{ symbol: 'CELU', c: 292 }]
              : [],
      }),
    );

    const prices = await fetchLivePrices(['CELU', 'JPM']);

    expect(prices).toContainEqual({ ticker: 'CELU', priceCents: 29200n, currency: 'ARS' });
    expect(prices).toContainEqual({ ticker: 'JPM', priceCents: 3157000n, currency: 'ARS' });
  });
});
