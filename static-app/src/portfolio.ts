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
  // Market value converted to pesos (USD × fx) so positions in different
  // currencies can be summed, ranked and expressed as % of the portfolio.
  valueArsCents: bigint;
  // True when the position is shown at its cost because there's no usable
  // market price (bonds/FCI without a live quote).
  valuedAtCost: boolean;
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
  // All totals are in pesos (USD positions converted at fxArsPerUsd).
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
    /* not a PPI workbook — fall through */
  }
  // "Copa BYMA" tracking workbook (orders on a "Base Operaciones" sheet).
  try {
    const { parseCopaBymaWorkbook } = await import('./copaByma');
    const copa = await parseCopaBymaWorkbook(buffer);
    if (copa && copa.transactions.length > 0) {
      return { kind: 'parsed', result: { brokerId: 'copa-byma', ...copa } };
    }
  } catch {
    /* not a Copa BYMA workbook — fall through to manual mapping */
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

// Cash / liquidity-fund rows (Cocos "EFECTIVO / LIQUIDEZ (ARS)") are the cash
// leg of each trade — parking idle pesos/dollars in a remunerated account, not
// a tradeable asset. They must never become a position; instead they feed the
// cash balance (see computeCashByCurrency).
const CASH_INSTRUMENT = /efectivo|liquidez/i;
export function isCashRow(tx: ParsedTransaction): boolean {
  const instr = tx.rawRow?.instrumento;
  return typeof instr === 'string' && CASH_INSTRUMENT.test(instr);
}

// MEP dollar operations (a bond bought/sold purely to convert ARS<->USD) and
// money-market fund (FCI) subscriptions/redemptions are parsed as buy/sell, but
// they are not real equity positions — counting them creates a phantom holding
// and a meaningless mixed-currency P&L. Detect them by the original operation
// label so they're kept in the movements list but excluded from positions.
const EXCLUDED_OP = /\bmep\b|fci/i;
export function isExcludedFromPositions(tx: ParsedTransaction): boolean {
  if (isCashRow(tx)) return true;
  const op = tx.rawRow?.tipoOperacion;
  return typeof op === 'string' && EXCLUDED_OP.test(op);
}

export interface CashBalance {
  ARS: bigint;
  USD: bigint;
}

/** Free cash held per currency, derived from every movement's cash effect:
 *  deposits/sells/dividends add, buys/withdrawals/fees subtract. Internal
 *  liquidity-fund transfers (EFECTIVO/LIQUIDEZ) are skipped — the deposit that
 *  funded them and the trade that spent them already move the balance, so
 *  counting the parking leg too would double it. */
export function computeCashByCurrency(transactions: ParsedTransaction[]): CashBalance {
  const bal: CashBalance = { ARS: 0n, USD: 0n };
  for (const tx of transactions) {
    if (isCashRow(tx)) continue;
    let delta = 0n;
    switch (tx.type) {
      case 'deposit':
      case 'sell':
      case 'dividend':
        delta = tx.amountCents;
        break;
      case 'withdrawal':
      case 'buy':
      case 'fee':
        delta = -tx.amountCents;
        break;
    }
    if (tx.currency === 'USD') bal.USD += delta;
    else bal.ARS += delta;
  }
  return bal;
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
  // Tickers that must be valued at their imported cost (weighted-average),
  // never at a live/stored price. Bonds and FCI quote per 100 nominal value /
  // in cuotapartes, so a raw quantity*price from data912 overstates them ~100x.
  snapshotValued?: Set<string>,
  // Pesos per dollar (e.g. CCL). USD amounts are converted with it so totals,
  // % of portfolio and the cost history don't add dollars to pesos as if they
  // were the same unit. Without it, amounts are summed raw (legacy behavior).
  fxArsPerUsd?: number,
  // Live bond/ON prices per 100 nominal value (cents, in the bond's currency).
  // Only used for snapshotValued tickers; never persisted, so a stale or
  // mis-scaled price can't stick the way GD35 did.
  bondPricesPer100?: Record<string, bigint>,
): PortfolioView {
  const toArs = (cents: bigint, currency: string): bigint =>
    currency === 'USD' && fxArsPerUsd && fxArsPerUsd > 0
      ? BigInt(Math.round(Number(cents) * fxArsPerUsd))
      : cents;

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
    let currentPriceCents: bigint;
    let r: ReturnType<typeof computePosition>;
    let valuedAtCost = false;
    if (snapshotValued?.has(entry.ticker)) {
      // Bonds/FCI: value at exactly the remaining cost (unrealized P&L = 0),
      // ignoring any live or stored per-100 price that would inflate it. We
      // take the remaining cost itself rather than qty × rounded avg price —
      // a bond quoted ~US$1,0307 per nominal rounds to 1,03 and, over
      // thousands of nominals, shows a fake P&L of tens of dollars.
      const base = computePosition(entry.txs, 0n);
      const remainingCost = -base.unrealizedPnlCents;
      let mv = remainingCost;
      valuedAtCost = true;
      const px100 = bondPricesPer100?.[entry.ticker];
      if (px100 && px100 > 0n && base.quantity > 0) {
        const live = BigInt(Math.round((base.quantity * Number(px100)) / 100));
        // Guard against a quote in the wrong unit (e.g. per nominal instead of
        // per 100): a real price can't be 3x away from what was paid.
        const ratio = remainingCost > 0n ? Number(live) / Number(remainingCost) : 1;
        if (ratio > 1 / 3 && ratio < 3) {
          mv = live;
          valuedAtCost = false;
        }
      }
      currentPriceCents = base.quantity > 0 ? BigInt(Math.round(Number(mv) / base.quantity)) : 0n;
      r = { ...base, marketValueCents: mv, unrealizedPnlCents: mv - remainingCost };
    } else {
      currentPriceCents = prices[entry.ticker] ?? 0n;
      r = computePosition(entry.txs, currentPriceCents);
    }
    return {
      ticker: entry.ticker,
      currency: entry.currency,
      quantity: r.quantity,
      avgCostCents: r.avgCostCents,
      currentPriceCents,
      marketValueCents: r.marketValueCents,
      unrealizedPnlCents: r.unrealizedPnlCents,
      realizedPnlCents: r.realizedPnlCents,
      valueArsCents: toArs(r.marketValueCents, entry.currency),
      valuedAtCost,
      pctOfPortfolio: 0,
    };
  });

  const held = positions.filter((p) => p.quantity > 0);

  // Market value and unrealized P&L only apply to what's still held; realized
  // P&L must include closed positions too (a fully-sold winner/loser still
  // counts), so it sums over every ticker, not just the held ones.
  const totals = {
    marketValueCents: held.reduce((s, p) => s + p.valueArsCents, 0n),
    unrealizedPnlCents: held.reduce((s, p) => s + toArs(p.unrealizedPnlCents, p.currency), 0n),
    realizedPnlCents: positions.reduce((s, p) => s + toArs(p.realizedPnlCents, p.currency), 0n),
  };

  const sortedPositions = held
    .map((p) => ({
      ...p,
      pctOfPortfolio:
        totals.marketValueCents > 0n
          ? (Number(p.valueArsCents) / Number(totals.marketValueCents)) * 100
          : 0,
    }))
    .sort((a, b) => (b.valueArsCents > a.valueArsCents ? 1 : -1));

  const timelineEvents = Array.from(byTicker.values())
    .flatMap((entry) =>
      computePositionTimeline(entry.txs).map((ev) => ({
        ...ev,
        costDeltaCents: toArs(ev.costDeltaCents, entry.currency),
        realizedPnlDeltaCents: toArs(ev.realizedPnlDeltaCents, entry.currency),
      })),
    )
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

/** Live bond/ON prices per 100 VN (cents). Best-effort; empty on failure. */
export async function syncBondPrices(tickers: string[]): Promise<Record<string, bigint>> {
  if (tickers.length === 0) return {};
  const { fetchBondPricesPer100 } = await import('../../src/lib/market/data912Client');
  const raw = await fetchBondPricesPer100(tickers);
  const out: Record<string, bigint> = {};
  for (const [t, c] of Object.entries(raw)) out[t] = BigInt(Math.round(c * 100));
  return out;
}

/** Dólar MEP implied by AL30/AL30D (pesos per dollar), or null. */
export async function fetchMep(): Promise<number | null> {
  const { fetchMepRate } = await import('../../src/lib/market/data912Client');
  return fetchMepRate();
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
