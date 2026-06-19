import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildPortfolioView } from '@/lib/pnl/buildPortfolioView';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const view = await buildPortfolioView(user.id);

  return Response.json({
    positions: view.positions.map((p) => ({
      ticker: p.ticker,
      currency: p.currency,
      quantity: p.quantity,
      avgCostCents: p.avgCostCents.toString(),
      currentPriceCents: p.currentPriceCents.toString(),
      marketValueCents: p.marketValueCents.toString(),
      unrealizedPnlCents: p.unrealizedPnlCents.toString(),
      realizedPnlCents: p.realizedPnlCents.toString(),
      pctOfPortfolio: p.pctOfPortfolio,
    })),
    history: view.history.map((h) => ({
      date: h.date.toISOString(),
      investedCostCents: h.investedCostCents.toString(),
      cumulativeRealizedPnlCents: h.cumulativeRealizedPnlCents.toString(),
    })),
    totals: {
      marketValueCents: view.totals.marketValueCents.toString(),
      unrealizedPnlCents: view.totals.unrealizedPnlCents.toString(),
      realizedPnlCents: view.totals.realizedPnlCents.toString(),
    },
    accountsCount: view.accountsCount,
  });
}
