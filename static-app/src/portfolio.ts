// Browser-side portfolio logic. Reuses the tested CSV parsers and P&L engine
// from the main app (../../src/lib) but replaces the Prisma-backed aggregation
// in buildPortfolioView with an in-memory version that works on transactions
// held in the browser.
import { detectAndParse } from '../../src/lib/csv/parserRegistry';
import { computePosition, computePositionTimeline } from '../../src/lib/pnl/engine';
import type { TimelineInput } from '../../src/lib/pnl/engine';
import type { ParsedTransaction } from '../../src/lib/csv/types';

export type { ParsedTransaction };

export interface Position {
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

export interface HistoryPoint {
  date: Date;
  investedCostCents: bigint;
  cumulativeRealizedPnlCents: bigint;
}

export interface PortfolioView {
  positions: Position[];
  history: HistoryPoint[];
  totals: {
    marketValueCents: bigint;
    unrealizedPnlCents: bigint;
    realizedPnlCents: bigint;
  };
}

export interface ImportResult {
  brokerId: string;
  transactions: ParsedTransaction[];
  errors: { row: number; message: string }[];
}

/** Parse a CSV export (Cocos Capital / Bull Market). */
export function parseCsv(text: string): ImportResult {
  const { brokerId, transactions, errors } = detectAndParse(text);
  return { brokerId, transactions, errors };
}

/** Parse a PPI XLSX export. exceljs is loaded lazily so it never weighs on the
 *  CSV path nor blocks the initial load. */
export async function parseXlsx(buffer: ArrayBuffer): Promise<ImportResult> {
  const { parsePpiWorkbook } = await import('../../src/lib/csv/ppiParser');
  const result = await parsePpiWorkbook(buffer as unknown as Buffer);
  return {
    brokerId: 'ppi',
    transactions: result.transactions,
    errors: result.errors.map((e) => ({ row: e.row, message: `[${e.sheet}] ${e.message}` })),
  };
}

/** Stable key used to de-duplicate transactions across repeated imports. */
export function txKey(tx: ParsedTransaction): string {
  return [
    tx.date instanceof Date ? tx.date.toISOString() : String(tx.date),
    tx.type,
    tx.ticker ?? '',
    tx.quantity ?? '',
    tx.price ?? '',
    tx.currency,
    tx.amountCents.toString(),
  ].join('|');
}

/** Aggregate in-memory transactions into a portfolio view, mirroring the
 *  server's buildPortfolioView (weighted-average cost, realized/unrealized
 *  P&L, holdings split and an invested-cost timeline). */
export function buildView(
  transactions: ParsedTransaction[],
  prices: Record<string, bigint>,
): PortfolioView {
  const byTicker = new Map<string, { ticker: string; currency: string; txs: TimelineInput[] }>();

  for (const tx of transactions) {
    if (!tx.ticker) continue; // deposits / withdrawals / fees have no asset
    const entry = byTicker.get(tx.ticker) ?? { ticker: tx.ticker, currency: tx.currency, txs: [] };
    entry.txs.push({
      type: tx.type,
      quantity: tx.quantity,
      amountCents: tx.amountCents,
      date: tx.date instanceof Date ? tx.date : new Date(tx.date),
    });
    byTicker.set(tx.ticker, entry);
  }

  // The engine processes transactions sequentially and assumes chronological
  // order (buys before the sells that close them).
  for (const entry of byTicker.values()) {
    entry.txs.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  const positions = Array.from(byTicker.values()).map((entry) => {
    const currentPriceCents = prices[entry.ticker] ?? 0n;
    const r = computePosition(entry.txs, currentPriceCents);
    return {
      ticker: entry.ticker,
      currency: entry.currency,
      quantity: r.quantity,
      avgCostCents: r.avgCostCents,
      currentPriceCents,
      marketValueCents: r.marketValueCents,
      unrealizedPnlCents: r.unrealizedPnlCents,
      realizedPnlCents: r.realizedPnlCents,
      pctOfPortfolio: 0,
    };
  });

  const held = positions.filter((p) => p.quantity > 0);

  const totals = held.reduce(
    (acc, p) => ({
      marketValueCents: acc.marketValueCents + p.marketValueCents,
      unrealizedPnlCents: acc.unrealizedPnlCents + p.unrealizedPnlCents,
      realizedPnlCents: acc.realizedPnlCents + p.realizedPnlCents,
    }),
    { marketValueCents: 0n, unrealizedPnlCents: 0n, realizedPnlCents: 0n },
  );

  const sortedPositions = held
    .map((p) => ({
      ...p,
      pctOfPortfolio:
        totals.marketValueCents > 0n
          ? (Number(p.marketValueCents) / Number(totals.marketValueCents)) * 100
          : 0,
    }))
    .sort((a, b) => (b.marketValueCents > a.marketValueCents ? 1 : -1));

  const timelineEvents = Array.from(byTicker.values())
    .flatMap((entry) => computePositionTimeline(entry.txs))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  let runningCost = 0n;
  let runningRealized = 0n;
  const history: HistoryPoint[] = timelineEvents.map((event) => {
    runningCost += event.costDeltaCents;
    runningRealized += event.realizedPnlDeltaCents;
    return {
      date: event.date,
      investedCostCents: runningCost,
      cumulativeRealizedPnlCents: runningRealized,
    };
  });

  return { positions: sortedPositions, history, totals };
}

/** All tickers that currently have an open position (for price syncing). */
export function heldTickers(transactions: ParsedTransaction[]): string[] {
  const view = buildView(transactions, {});
  return view.positions.map((p) => p.ticker);
}

/** Best-effort live price sync from data912 (reuses the app's client). May be
 *  blocked by the browser's CORS policy; callers should handle rejection. */
export async function syncPrices(tickers: string[]): Promise<Record<string, bigint>> {
  if (tickers.length === 0) return {};
  const { fetchLivePrices } = await import('../../src/lib/market/data912Client');
  const quotes = await fetchLivePrices(tickers);
  const prices: Record<string, bigint> = {};
  for (const q of quotes) prices[q.ticker] = q.priceCents;
  return prices;
}
