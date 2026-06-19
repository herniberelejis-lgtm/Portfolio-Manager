import { prisma } from '@/lib/prisma';
import { computePosition, computePositionTimeline } from '@/lib/pnl/engine';
import type { PositionInput, TimelineInput } from '@/lib/pnl/engine';

export interface PortfolioPosition {
  ticker: string;
  currency: string;
  quantity: number;
  avgCostCents: bigint;
  currentPriceCents: bigint;
  marketValueCents: bigint;
  unrealizedPnlCents: bigint;
  realizedPnlCents: bigint;
  pctOfPortfolio: number;
}

export interface PortfolioHistoryPoint {
  date: Date;
  investedCostCents: bigint;
  cumulativeRealizedPnlCents: bigint;
}

export interface PortfolioView {
  positions: PortfolioPosition[];
  history: PortfolioHistoryPoint[];
  totals: {
    marketValueCents: bigint;
    unrealizedPnlCents: bigint;
    realizedPnlCents: bigint;
  };
  accountsCount: number;
}

export async function buildPortfolioView(userId: string): Promise<PortfolioView> {
  const accounts = await prisma.brokerAccount.findMany({
    where: { userId },
    select: { id: true },
  });
  const accountIds = accounts.map((a) => a.id);

  const transactions = await prisma.transaction.findMany({
    where: { brokerAccountId: { in: accountIds } },
    include: { asset: true },
    orderBy: { date: 'asc' },
  });

  const byAsset = new Map<string, { ticker: string; currency: string; txs: TimelineInput[] }>();
  for (const tx of transactions) {
    if (!tx.asset || !tx.assetId) continue;
    const entry = byAsset.get(tx.assetId) ?? { ticker: tx.asset.ticker, currency: tx.asset.currency, txs: [] };
    entry.txs.push({
      type: tx.type as PositionInput['type'],
      quantity: tx.quantity ? Number(tx.quantity) : null,
      amountCents: tx.amountCents,
      date: tx.date,
    });
    byAsset.set(tx.assetId, entry);
  }

  const positions = await Promise.all(
    Array.from(byAsset.entries()).map(async ([assetId, entry]) => {
      const latestPrice = await prisma.priceSnapshot.findFirst({
        where: { assetId },
        orderBy: { fetchedAt: 'desc' },
      });
      const currentPriceCents = latestPrice?.priceCents ?? 0n;
      const result = computePosition(entry.txs, currentPriceCents);

      return {
        ticker: entry.ticker,
        currency: entry.currency,
        quantity: result.quantity,
        avgCostCents: result.avgCostCents,
        currentPriceCents,
        marketValueCents: result.marketValueCents,
        unrealizedPnlCents: result.unrealizedPnlCents,
        realizedPnlCents: result.realizedPnlCents,
      };
    }),
  );

  const heldPositions = positions.filter((p) => p.quantity > 0);

  const totals = heldPositions.reduce(
    (acc, p) => ({
      marketValueCents: acc.marketValueCents + p.marketValueCents,
      unrealizedPnlCents: acc.unrealizedPnlCents + p.unrealizedPnlCents,
      realizedPnlCents: acc.realizedPnlCents + p.realizedPnlCents,
    }),
    { marketValueCents: 0n, unrealizedPnlCents: 0n, realizedPnlCents: 0n },
  );

  const sortedPositions = heldPositions
    .map((p) => ({
      ...p,
      pctOfPortfolio: totals.marketValueCents > 0n
        ? (Number(p.marketValueCents) / Number(totals.marketValueCents)) * 100
        : 0,
    }))
    .sort((a, b) => (b.marketValueCents > a.marketValueCents ? 1 : -1));

  const timelineEvents = Array.from(byAsset.values())
    .flatMap((entry) => computePositionTimeline(entry.txs))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  let runningCost = 0n;
  let runningRealized = 0n;
  const history: PortfolioHistoryPoint[] = timelineEvents.map((event) => {
    runningCost += event.costDeltaCents;
    runningRealized += event.realizedPnlDeltaCents;
    return {
      date: event.date,
      investedCostCents: runningCost,
      cumulativeRealizedPnlCents: runningRealized,
    };
  });

  return { positions: sortedPositions, history, totals, accountsCount: accountIds.length };
}
