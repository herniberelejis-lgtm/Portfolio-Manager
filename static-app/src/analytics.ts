// Portfolio analytics computed purely from the imported transactions. These
// functions are price-independent (exact from the data) except where a price
// map is passed in for current-value metrics. Cocos rows carry the cost
// breakdown (comisión / derechos / IVA) in rawRow, which the parser preserves.
import type { ParsedTransaction } from './portfolio';
import { computePosition } from '../../src/lib/pnl/engine';
import { isExcludedFromPositions } from './portfolio';

export type AssetClass = 'Acción ARG' | 'CEDEAR' | 'Bono/ON' | 'FCI' | 'Dólar MEP' | 'Otro';

function argNum(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(String(v).trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function classifyInstrument(instrumento: string | undefined, tipoOperacion?: string): AssetClass {
  const i = (instrumento ?? '').toUpperCase();
  const op = (tipoOperacion ?? '').toUpperCase();
  if (op.includes('MEP')) return 'Dólar MEP';
  if (i.startsWith('CEDEAR')) return 'CEDEAR';
  if (i.startsWith('FCI')) return 'FCI';
  // Sovereign & sub-sovereign bonds and letras are quoted per 100 nominal value,
  // so a raw quantity*price overstates them ~100x. Catch the common Argentine
  // prefixes (BONO/BONOS/BONAR/BONCER/BONTE, LETRA/LECAP, TÍTULOS PÚBLICOS) plus
  // ONs. Ticker examples: GD35, AL30, GD30, TX26…
  if (
    i.startsWith('ON ') ||
    i.startsWith('BON') ||
    i.startsWith('LETRA') ||
    i.startsWith('LECAP') ||
    i.startsWith('TITULO') ||
    i.includes('TARJETA NARANJA') ||
    i.includes('OBLIGAC')
  )
    return 'Bono/ON';
  if (i) return 'Acción ARG';
  return 'Otro';
}

/** Representative asset class for a ticker, from any of its transactions. */
function tickerClass(txs: ParsedTransaction[]): AssetClass {
  const t = txs.find((x) => x.rawRow?.instrumento);
  return classifyInstrument(t?.rawRow?.instrumento, t?.rawRow?.tipoOperacion);
}

/** Tickers whose live data912 price is an unreliable basis for quantity*price:
 *  bonds/ONs are quoted per 100 nominal value and FCI in cuotapartes, so a raw
 *  qty*price overstates value (often ~100x). We keep these at their imported
 *  value instead of overriding with a live price. */
export function noLivePriceTickers(transactions: ParsedTransaction[]): Set<string> {
  const out = new Set<string>();
  const seen = new Map<string, ParsedTransaction>();
  for (const t of transactions) if (t.ticker && !seen.has(t.ticker)) seen.set(t.ticker, t);
  for (const [ticker, t] of seen) {
    const cls = classifyInstrument(t.rawRow?.instrumento, t.rawRow?.tipoOperacion);
    if (cls === 'Bono/ON' || cls === 'FCI') out.add(ticker);
  }
  return out;
}

export interface CostSummary {
  comision: number;
  derechos: number;
  iva: number;
  otros: number;
  total: number;
  volumenOperado: number; // sum of |montoBruto| of buys+sells
  pctSobreVolumen: number;
}

export function computeCosts(txs: ParsedTransaction[]): CostSummary {
  let comision = 0, derechos = 0, iva = 0, otros = 0, volumen = 0;
  for (const t of txs) {
    const r = t.rawRow;
    if (!r) continue;
    comision += Math.abs(argNum(r.comision));
    derechos += Math.abs(argNum(r.ddmm));
    iva += Math.abs(argNum(r.iva));
    otros += Math.abs(argNum(r.otros));
    if (t.type === 'buy' || t.type === 'sell') volumen += Math.abs(argNum(r.montoBruto));
  }
  const total = comision + derechos + iva + otros;
  return { comision, derechos, iva, otros, total, volumenOperado: volumen, pctSobreVolumen: volumen ? (total / volumen) * 100 : 0 };
}

export interface Sale { ticker: string; date: Date; realizedCents: bigint; costOfSoldCents: bigint; holdingDays: number | null; }

export interface TickerStats {
  ticker: string;
  assetClass: AssetClass;
  currency: string;
  heldQty: number;
  avgCostCents: bigint;
  heldCostCents: bigint;
  boughtCostCents: bigint;
  soldProceedsCents: bigint;
  costOfSoldCents: bigint;
  realizedCents: bigint;
  roiPct: number | null; // realized / cost-of-sold
  avgHoldingDays: number | null;
  sales: Sale[];
}

/** Per-ticker stats using weighted-average cost (matches the app engine),
 *  plus realized P&L, ROI on closed portion, and average holding period. */
export function perTicker(transactions: ParsedTransaction[]): TickerStats[] {
  const byTicker = new Map<string, ParsedTransaction[]>();
  for (const t of transactions) {
    if (!t.ticker || isExcludedFromPositions(t)) continue;
    const a = byTicker.get(t.ticker) ?? [];
    a.push(t);
    byTicker.set(t.ticker, a);
  }

  const out: TickerStats[] = [];
  for (const [ticker, txsRaw] of byTicker) {
    const txs = [...txsRaw].sort((a, b) => a.date.getTime() - b.date.getTime());
    let qty = 0;
    let costCents = 0n;
    let boughtCost = 0n;
    let soldProceeds = 0n;
    let costOfSold = 0n;
    let realized = 0n;
    let wAcqMs = 0; // quantity-weighted acquisition time
    const sales: Sale[] = [];
    const holdDays: number[] = [];

    for (const t of txs) {
      if (t.type === 'buy' && t.quantity) {
        const prevQ = qty;
        qty += t.quantity;
        costCents += t.amountCents;
        boughtCost += t.amountCents;
        wAcqMs = qty > 0 ? (wAcqMs * prevQ + t.date.getTime() * t.quantity) / qty : t.date.getTime();
      } else if (t.type === 'sell' && t.quantity) {
        if (qty <= 0) continue;
        const frac = t.quantity / qty;
        const cos = BigInt(Math.round(Number(costCents) * frac));
        const rea = t.amountCents - cos;
        realized += rea;
        soldProceeds += t.amountCents;
        costOfSold += cos;
        costCents -= cos;
        qty -= t.quantity;
        const hd = wAcqMs ? (t.date.getTime() - wAcqMs) / 864e5 : null;
        sales.push({ ticker, date: t.date, realizedCents: rea, costOfSoldCents: cos, holdingDays: hd });
        if (hd != null) holdDays.push(hd);
      }
    }

    const avg = qty > 0 ? costCents / BigInt(Math.round(qty)) : 0n;
    out.push({
      ticker,
      assetClass: tickerClass(txs),
      currency: txs[0].currency,
      heldQty: qty,
      avgCostCents: avg,
      heldCostCents: costCents,
      boughtCostCents: boughtCost,
      soldProceedsCents: soldProceeds,
      costOfSoldCents: costOfSold,
      realizedCents: realized,
      roiPct: costOfSold > 0n ? (Number(realized) / Number(costOfSold)) * 100 : null,
      avgHoldingDays: holdDays.length ? holdDays.reduce((s, d) => s + d, 0) / holdDays.length : null,
      sales,
    });
  }
  return out;
}

export interface OperationalQuality {
  totalSales: number;
  wins: number;
  losses: number;
  winRatePct: number;
  avgWinCents: bigint;
  avgLossCents: bigint;
  riskReward: number | null; // avgWin / avgLoss
}

export function operationalQuality(stats: TickerStats[]): OperationalQuality {
  const sales = stats.flatMap((s) => s.sales);
  const wins = sales.filter((s) => s.realizedCents > 0n);
  const losses = sales.filter((s) => s.realizedCents < 0n);
  const avgWin = wins.length ? wins.reduce((a, s) => a + s.realizedCents, 0n) / BigInt(wins.length) : 0n;
  const avgLoss = losses.length ? losses.reduce((a, s) => a + s.realizedCents, 0n) / BigInt(losses.length) : 0n;
  return {
    totalSales: sales.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: sales.length ? (wins.length / sales.length) * 100 : 0,
    avgWinCents: avgWin,
    avgLossCents: avgLoss,
    riskReward: avgLoss !== 0n ? Number(avgWin) / Math.abs(Number(avgLoss)) : null,
  };
}

export interface ClassAgg { assetClass: AssetClass; heldCostCents: bigint; realizedCents: bigint; pctOfHeld: number; }

export function byAssetClass(stats: TickerStats[]): ClassAgg[] {
  const map = new Map<AssetClass, { held: bigint; real: bigint }>();
  for (const s of stats) {
    const e = map.get(s.assetClass) ?? { held: 0n, real: 0n };
    if (s.currency === 'ARS') e.held += s.heldCostCents;
    e.real += s.realizedCents;
    map.set(s.assetClass, e);
  }
  const totalHeld = Array.from(map.values()).reduce((a, e) => a + e.held, 0n);
  return Array.from(map.entries())
    .map(([assetClass, e]) => ({ assetClass, heldCostCents: e.held, realizedCents: e.real, pctOfHeld: totalHeld > 0n ? (Number(e.held) / Number(totalHeld)) * 100 : 0 }))
    .sort((a, b) => Number(b.heldCostCents - a.heldCostCents));
}

export interface CashFlows { deposits: bigint; withdrawals: bigint; dividends: bigint; netContributed: bigint; }

export function cashFlows(txs: ParsedTransaction[]): CashFlows {
  let d = 0n, w = 0n, div = 0n;
  for (const t of txs) {
    if (t.type === 'deposit') d += t.amountCents;
    else if (t.type === 'withdrawal') w += t.amountCents;
    else if (t.type === 'dividend') div += t.amountCents;
  }
  return { deposits: d, withdrawals: w, dividends: div, netContributed: d - w };
}

/** Current ARS cash balance left in the account (deposits/sells/dividends in,
 *  withdrawals/buys/fees out). USD legs are tiny here and ignored. */
export function arsCashBalanceCents(txs: ParsedTransaction[]): bigint {
  let bal = 0n;
  for (const t of txs) {
    if (t.currency !== 'ARS') continue;
    if (t.type === 'deposit' || t.type === 'sell' || t.type === 'dividend') bal += t.amountCents;
    else if (t.type === 'withdrawal' || t.type === 'buy' || t.type === 'fee') bal -= t.amountCents;
  }
  return bal;
}

export interface Flow { date: Date; amount: number; }

export interface YearTax { year: number; realizedCents: bigint; dividendsCents: bigint }

/** Realized P&L and dividends per calendar year (for tax estimation). */
export function realizedByYear(transactions: ParsedTransaction[]): YearTax[] {
  const sales = perTicker(transactions).flatMap((s) => s.sales);
  const map = new Map<number, { r: bigint; d: bigint }>();
  for (const s of sales) {
    const y = s.date.getFullYear();
    const e = map.get(y) ?? { r: 0n, d: 0n };
    e.r += s.realizedCents;
    map.set(y, e);
  }
  for (const t of transactions) {
    if (t.type !== 'dividend') continue;
    const y = t.date.getFullYear();
    const e = map.get(y) ?? { r: 0n, d: 0n };
    e.d += t.amountCents;
    map.set(y, e);
  }
  return Array.from(map.entries())
    .map(([year, e]) => ({ year, realizedCents: e.r, dividendsCents: e.d }))
    .sort((a, b) => a.year - b.year);
}

export interface Behavior {
  winHoldDays: number | null;
  lossHoldDays: number | null;
  byClass: { assetClass: AssetClass; wins: number; total: number; winRatePct: number; realizedCents: bigint }[];
  tradesPerMonth: number;
  bestSale: { ticker: string; date: Date; realizedCents: bigint } | null;
  worstSale: { ticker: string; date: Date; realizedCents: bigint } | null;
}

/** Behavioral analysis: disposition effect (selling winners fast / holding
 *  losers), win rate by asset class, trading frequency, best/worst trades. */
export function behavior(transactions: ParsedTransaction[]): Behavior {
  const stats = perTicker(transactions);
  const classOf = new Map(stats.map((s) => [s.ticker, s.assetClass]));
  const sales = stats.flatMap((s) => s.sales);

  const winHolds = sales.filter((s) => s.realizedCents > 0n && s.holdingDays != null).map((s) => s.holdingDays!);
  const lossHolds = sales.filter((s) => s.realizedCents < 0n && s.holdingDays != null).map((s) => s.holdingDays!);
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

  const cmap = new Map<AssetClass, { wins: number; total: number; r: bigint }>();
  for (const s of sales) {
    const cls = classOf.get(s.ticker) ?? 'Otro';
    const e = cmap.get(cls) ?? { wins: 0, total: 0, r: 0n };
    e.total += 1;
    if (s.realizedCents > 0n) e.wins += 1;
    e.r += s.realizedCents;
    cmap.set(cls, e);
  }
  const byClass = Array.from(cmap.entries())
    .map(([assetClass, e]) => ({ assetClass, wins: e.wins, total: e.total, winRatePct: e.total ? (e.wins / e.total) * 100 : 0, realizedCents: e.r }))
    .sort((a, b) => Number(b.realizedCents - a.realizedCents));

  const trades = transactions.filter((t) => t.type === 'buy' || t.type === 'sell');
  let tradesPerMonth = 0;
  if (trades.length) {
    const dates = trades.map((t) => t.date.getTime());
    const months = Math.max(1, (Math.max(...dates) - Math.min(...dates)) / (30.44 * 864e5));
    tradesPerMonth = trades.length / months;
  }

  const sorted = [...sales].sort((a, b) => Number(b.realizedCents - a.realizedCents));
  const pick = (s?: Sale) => (s ? { ticker: s.ticker, date: s.date, realizedCents: s.realizedCents } : null);

  return {
    winHoldDays: avg(winHolds),
    lossHoldDays: avg(lossHolds),
    byClass,
    tradesPerMonth,
    bestSale: pick(sorted[0]),
    worstSale: pick(sorted[sorted.length - 1]),
  };
}

/** Share of held market value tracking USD (CEDEARs + USD positions) vs ARS. */
export function currencyExposure(stats: TickerStats[], prices: Record<string, bigint>): { usdPct: number; arsPct: number } {
  let usd = 0n;
  let total = 0n;
  for (const s of stats) {
    if (s.heldQty <= 0) continue;
    const mv = BigInt(Math.round(s.heldQty)) * (prices[s.ticker] ?? s.avgCostCents);
    total += mv;
    if (s.assetClass === 'CEDEAR' || s.currency === 'USD') usd += mv;
  }
  const usdPct = total > 0n ? (Number(usd) / Number(total)) * 100 : 0;
  return { usdPct, arsPct: 100 - usdPct };
}

/** Money-weighted return (XIRR) via bisection. amount sign: money the investor
 *  receives is positive, money paid in is negative. Returns an annual rate. */
export function xirr(flows: Flow[]): number | null {
  if (flows.length < 2) return null;
  const sorted = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0 = sorted[0].date.getTime();
  const yrs = (d: Date) => (d.getTime() - t0) / (365.25 * 864e5);
  const npv = (r: number) => sorted.reduce((s, f) => s + f.amount / Math.pow(1 + r, yrs(f.date)), 0);
  let lo = -0.9999, hi = 100;
  let flo = npv(lo);
  if (flo * npv(hi) > 0) return null; // no sign change -> undefined
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-4) return mid;
    if (flo * fm < 0) hi = mid;
    else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}
