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
  if (i.startsWith('ON ') || i.includes('TARJETA NARANJA') || i.includes('OBLIGAC')) return 'Bono/ON';
  if (i) return 'Acción ARG';
  return 'Otro';
}

/** Representative asset class for a ticker, from any of its transactions. */
function tickerClass(txs: ParsedTransaction[]): AssetClass {
  const t = txs.find((x) => x.rawRow?.instrumento);
  return classifyInstrument(t?.rawRow?.instrumento, t?.rawRow?.tipoOperacion);
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

export interface Sale { ticker: string; date: Date; realizedCents: bigint; costOfSoldCents: bigint; }

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
        sales.push({ ticker, date: t.date, realizedCents: rea, costOfSoldCents: cos });
        if (wAcqMs) holdDays.push((t.date.getTime() - wAcqMs) / 864e5);
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
