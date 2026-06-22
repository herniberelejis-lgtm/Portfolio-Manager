// Browser-side portfolio logic. Reuses the tested CSV parsers and P&L engine
// from the main app (../../src/lib) but replaces the Prisma-backed aggregation
// in buildPortfolioView with an in-memory version that works on transactions
// held in the browser.
import { detectAndParse } from '../../src/lib/csv/parserRegistry';
import { computePosition, computePositionTimeline } from '../../src/lib/pnl/engine';
import type { TimelineInput } from '../../src/lib/pnl/engine';
import type { ParsedTransaction } from '../../src/lib/csv/types';
import { parseDelimitedGrid, type GridData } from './genericImport';

export type { ParsedTransaction };
export type { GridData };

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

// When a file matches no known broker, we hand the raw grid to the user to map
// columns by hand (ColumnMapper). This union lets handleFiles branch on it.
export type ImportOutcome =
  | { kind: 'parsed'; result: ImportResult }
  | { kind: 'needsMapping'; grid: GridData };

function cellToString(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if ('result' in o) return String(o.result ?? '');
    if (Array.isArray(o.richText)) return o.richText.map((t) => (t as { text?: string }).text ?? '').join('');
    return String(v);
  }
  return String(v);
}

/** Read the first worksheet of an XLSX into a header+rows grid (lazy exceljs). */
async function readXlsxGrid(buffer: ArrayBuffer): Promise<GridData> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  const matrix: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = (row.values as unknown[]).slice(1); // exceljs values are 1-based
    matrix.push(vals.map((v) => cellToString(v).trim()));
  });
  const firstIdx = matrix.findIndex((r) => r.some((c) => c !== ''));
  if (firstIdx < 0) return { headers: [], rows: [] };
  const [headers, ...rows] = matrix.slice(firstIdx);
  return { headers, rows };
}

/** Parse a CSV: use the matching broker parser, or fall back to manual mapping. */
export function parseCsvOrGrid(text: string): ImportOutcome {
  try {
    const { brokerId, transactions, errors } = detectAndParse(text);
    return { kind: 'parsed', result: { brokerId, transactions, errors } };
  } catch {
    return { kind: 'needsMapping', grid: parseDelimitedGrid(text) };
  }
}

/** Parse an XLSX: try the PPI parser, else fall back to manual mapping of the
 *  first sheet (covers Balanz/IOL/Macro and any other Excel export). */
export async function parseXlsxOrGrid(buffer: ArrayBuffer): Promise<ImportOutcome> {
  try {
    const ppi = await parseXlsx(buffer);
    if (ppi.transactions.length > 0) return { kind: 'parsed', result: ppi };
  } catch {
    /* not a PPI workbook — fall through to manual mapping */
  }
  return { kind: 'needsMapping', grid: await readXlsxGrid(buffer) };
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

// MEP dollar operations (a bond bought/sold purely to convert ARS<->USD) and
// money-market fund (FCI) subscriptions/redemptions are parsed as buy/sell, but
// they are not real equity positions — counting them creates a phantom holding
// and a meaningless mixed-currency P&L. Detect them by the original operation
// label so they're kept in the movements list but excluded from positions.
const EXCLUDED_OP = /\bmep\b|fci/i;
export function isExcludedFromPositions(tx: ParsedTransaction): boolean {
  const op = tx.rawRow?.tipoOperacion;
  return typeof op === 'string' && EXCLUDED_OP.test(op);
}

const TYPE_LABEL: Record<ParsedTransaction['type'], string> = {
  buy: 'Compra',
  sell: 'Venta',
  deposit: 'Ingreso',
  withdrawal: 'Egreso',
  dividend: 'Dividendo',
  fee: 'Comisión',
};

/** Human label for a movement: the broker's original operation name when we
 *  have it, otherwise a friendly label for the normalized type. */
export function opLabel(tx: ParsedTransaction): string {
  const op = tx.rawRow?.tipoOperacion;
  if (typeof op === 'string' && op.trim()) return op.trim();
  return TYPE_LABEL[tx.type] ?? tx.type;
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
    if (isExcludedFromPositions(tx)) continue; // MEP / FCI currency moves
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

  // Market value and unrealized P&L only apply to what's still held; realized
  // P&L must include closed positions too (a fully-sold winner/loser still
  // counts), so it sums over every ticker, not just the held ones.
  const totals = {
    marketValueCents: held.reduce((s, p) => s + p.marketValueCents, 0n),
    unrealizedPnlCents: held.reduce((s, p) => s + p.unrealizedPnlCents, 0n),
    realizedPnlCents: positions.reduce((s, p) => s + p.realizedPnlCents, 0n),
  };

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
