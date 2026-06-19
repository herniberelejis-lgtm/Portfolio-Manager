import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncPrices } from '@/lib/market/priceSyncJob';
import { prisma } from '@/lib/prisma';
import { fetchLivePrices } from '@/lib/market/data912Client';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    asset: { findMany: vi.fn() },
    priceSnapshot: { create: vi.fn() },
  },
}));
vi.mock('@/lib/market/data912Client', () => ({ fetchLivePrices: vi.fn() }));

describe('syncPrices', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a PriceSnapshot for each successfully fetched asset', async () => {
    (prisma.asset.findMany as any).mockResolvedValue([
      { id: 'asset_ggal', ticker: 'GGAL' },
      { id: 'asset_ypfd', ticker: 'YPFD' },
    ]);
    (fetchLivePrices as any).mockResolvedValue([
      { ticker: 'GGAL', priceCents: 505050n, currency: 'ARS' },
      { ticker: 'YPFD', priceCents: 3000000n, currency: 'ARS' },
    ]);

    const result = await syncPrices();

    expect(result.updated).toBe(2);
    expect(result.failed).toHaveLength(0);
    expect(prisma.priceSnapshot.create).toHaveBeenCalledTimes(2);
  });

  it('reports failure without throwing when the fetch errors, leaving prior snapshots intact', async () => {
    (prisma.asset.findMany as any).mockResolvedValue([{ id: 'asset_ggal', ticker: 'GGAL' }]);
    (fetchLivePrices as any).mockRejectedValue(new Error('data912 request failed with status 503'));

    const result = await syncPrices();

    expect(result.updated).toBe(0);
    expect(result.failed).toEqual(['GGAL']);
    expect(prisma.priceSnapshot.create).not.toHaveBeenCalled();
  });
});
