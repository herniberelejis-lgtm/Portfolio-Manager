import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchExchangeRate } from '@/lib/market/exchangeRateClient';

describe('fetchExchangeRate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the MEP rate and converts to cents', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ mep: { value_sell: 1250.75 } }),
    });

    const result = await fetchExchangeRate('mep');

    expect(result.rateCents).toBe(125075n);
    expect(result.date).toBeInstanceOf(Date);
  });

  it('throws when the rate type is missing from the response', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ oficial: { value_sell: 1000 } }),
    });

    await expect(fetchExchangeRate('mep')).rejects.toThrow(/mep/i);
  });
});
