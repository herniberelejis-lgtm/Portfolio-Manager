// Builds a compact, text-only snapshot of the user's portfolio to feed the
// AI assistant as context. Reuses the same analytics.ts primitives as
// Analisis.tsx and insights.ts — no new math, just a different presentation.
import type { ParsedTransaction } from './portfolio';
import {
  arsCashBalanceCents,
  behavior,
  byAssetClass,
  cashFlows,
  computeCosts,
  currencyExposure,
  operationalQuality,
  perTicker,
  realizedByYear,
  xirr,
  type Flow,
} from './analytics';
import { coreConclusions, type ConclusionInput } from './insights';

function pesos(cents: bigint): number {
  return Number(cents) / 100;
}
function money(cents: bigint): string {
  return `$${pesos(cents).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
}

export function buildPortfolioContext(
  transactions: ParsedTransaction[],
  prices: Record<string, bigint>,
): string {
  if (transactions.length === 0) return 'El usuario todavía no cargó movimientos.';

  const stats = perTicker(transactions);
  const costs = computeCosts(transactions);
  const cf = cashFlows(transactions);
  const oq = operationalQuality(stats);
  const classes = byAssetClass(stats);
  const held = stats.filter((s) => s.heldQty > 0);

  let currentValue = 0n;
  let heldCost = 0n;
  for (const s of held) {
    const price = prices[s.ticker] ?? s.avgCostCents;
    currentValue += BigInt(Math.round(s.heldQty)) * price;
    heldCost += s.heldCostCents;
  }
  const latent = currentValue - heldCost;
  const realized = stats.reduce((s, t) => s + t.realizedCents, 0n);
  const totalPnl = realized + latent + cf.dividends;
  const returnPct = cf.netContributed > 0n ? (Number(totalPnl) / Number(cf.netContributed)) * 100 : null;

  const cash = arsCashBalanceCents(transactions);
  const flows: Flow[] = [];
  for (const t of transactions) {
    if (t.currency !== 'ARS') continue;
    if (t.type === 'deposit') flows.push({ date: t.date, amount: -pesos(t.amountCents) });
    else if (t.type === 'withdrawal') flows.push({ date: t.date, amount: pesos(t.amountCents) });
  }
  flows.push({ date: new Date(), amount: pesos(currentValue + cash) });
  const tir = xirr(flows);

  const heldArs = held.filter((s) => s.currency === 'ARS');
  let totMv = 0n;
  const mvByTicker = heldArs.map((s) => {
    const mv = BigInt(Math.round(s.heldQty)) * (prices[s.ticker] ?? s.avgCostCents);
    totMv += mv;
    return { ticker: s.ticker, mv };
  });
  const conc = mvByTicker
    .map((x) => ({ ticker: x.ticker, pct: totMv > 0n ? (Number(x.mv) / Number(totMv)) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct);

  const fx = currencyExposure(stats, prices);
  const beh = behavior(transactions);
  const fiscal = realizedByYear(transactions);

  const cedearB = beh.byClass.find((c) => c.assetClass === 'CEDEAR');
  const argB = beh.byClass.find((c) => c.assetClass === 'Acción ARG');
  const conclusionInput: ConclusionInput = {
    maxPosTicker: conc[0]?.ticker ?? '—',
    maxPosPct: conc[0]?.pct ?? 0,
    maxClassName: classes[0]?.assetClass ?? '—',
    maxClassPct: classes[0]?.pctOfHeld ?? 0,
    classCount: classes.length,
    usdPct: fx.usdPct,
    cedear: cedearB ? { winRatePct: cedearB.winRatePct, realizedCents: cedearB.realizedCents } : undefined,
    arg: argB ? { winRatePct: argB.winRatePct, realizedCents: argB.realizedCents } : undefined,
    winRatePct: oq.winRatePct,
    totalSales: oq.totalSales,
    riskReward: oq.riskReward,
    costsPctOfVolume: costs.pctSobreVolumen,
    totalPnlCents: totalPnl,
    returnPct,
    holdingsCount: held.length,
  };
  const conclusions = coreConclusions(conclusionInput);

  const lines: string[] = [];
  lines.push(`Valor de mercado actual: ${money(currentValue)}.`);
  lines.push(
    `P&L total: ${money(totalPnl)} (${returnPct != null ? returnPct.toFixed(1) + '%' : '—'} sobre aporte neto). ` +
      `P&L realizado: ${money(realized)}. P&L latente: ${money(latent)}. Dividendos cobrados: ${money(cf.dividends)}.`,
  );
  if (tir != null) lines.push(`TIR anualizada (money-weighted): ${(tir * 100).toFixed(1)}%.`);
  lines.push(`Exposición en dólares (CEDEARs/USD): ${fx.usdPct.toFixed(0)}%. En pesos: ${fx.arsPct.toFixed(0)}%.`);
  lines.push(`Distribución por clase de activo: ${classes.map((c) => `${c.assetClass} ${c.pctOfHeld.toFixed(0)}%`).join(', ') || '—'}.`);
  lines.push(`Posiciones actuales y su peso: ${conc.map((c) => `${c.ticker} ${c.pct.toFixed(1)}%`).join(', ') || 'ninguna'}.`);
  lines.push(
    `Win rate en ventas cerradas: ${oq.winRatePct.toFixed(0)}% (${oq.wins} de ${oq.totalSales}). ` +
      `Ratio riesgo/recompensa: ${oq.riskReward != null ? oq.riskReward.toFixed(2) : '—'}.`,
  );
  lines.push(`Costos totales: ${costs.pctSobreVolumen.toFixed(2)}% del volumen operado.`);
  if (fiscal.length) lines.push(`P&L realizado por año: ${fiscal.map((y) => `${y.year}: ${money(y.realizedCents)}`).join(', ')}.`);
  if (beh.bestSale) lines.push(`Mejor operación: ${beh.bestSale.ticker} ${money(beh.bestSale.realizedCents)}.`);
  if (beh.worstSale) lines.push(`Peor operación: ${beh.worstSale.ticker} ${money(beh.worstSale.realizedCents)}.`);
  lines.push('Conclusiones automáticas detectadas sobre esta cartera:');
  for (const c of conclusions) lines.push(`- [${c.level}] ${c.title}: ${c.detail}`);

  return lines.join('\n');
}
