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

  it('throws a descriptive error when the API call fails', async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 503 });

    await expect(fetchLivePrices(['GGAL'])).rejects.toThrow(/data912.*503/i);
  });
});
