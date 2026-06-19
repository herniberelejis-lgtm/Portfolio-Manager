import { prisma } from '@/lib/prisma';
import { fetchLivePrices } from './data912Client';

export async function syncPrices(): Promise<{ updated: number; failed: string[] }> {
  const assets = await prisma.asset.findMany();
  if (assets.length === 0) return { updated: 0, failed: [] };

  const tickers = assets.map((a) => a.ticker);

  let prices;
  try {
    prices = await fetchLivePrices(tickers);
  } catch {
    // Source is down: leave existing PriceSnapshot rows untouched, report all as failed.
    return { updated: 0, failed: tickers };
  }

  const priceByTicker = new Map(prices.map((p) => [p.ticker, p]));
  let updated = 0;
  const failed: string[] = [];

  for (const asset of assets) {
    const price = priceByTicker.get(asset.ticker);
    if (!price) {
      failed.push(asset.ticker);
      continue;
    }

    await prisma.priceSnapshot.create({
      data: { assetId: asset.id, priceCents: price.priceCents, currency: price.currency },
    });
    updated++;
  }

  return { updated, failed };
}
