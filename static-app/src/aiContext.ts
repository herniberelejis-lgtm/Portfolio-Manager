// Builds a compact, text-only snapshot of the user's portfolio to feed the
// AI assistant as context. Reuses the same analytics.ts primitives as
// Analisis.tsx and insights.ts — no new math, just a different presentation.
import type { ParsedTransaction } from './portfolio';
import {
  behavior,
  byAssetClass,
  computeCosts,
  operationalQuality,
  perTicker,
  portfolioSummary,
  realizedByYear,
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
  fxArsPerUsd?: number | null,
  bondPricesPer100?: Record<string, bigint>,
): string {
  if (transactions.length === 0) return 'El usuario todavía no cargó movimientos.';

  const stats = perTicker(transactions);
  const costs = computeCosts(transactions);
  const oq = operationalQuality(stats);
  const classes = byAssetClass(stats, fxArsPerUsd ?? undefined);
  const held = stats.filter((s) => s.heldQty > 0);

  // FX-aware headline numbers (USD converted to pesos at the CCL).
  const sum = portfolioSummary(transactions, prices, fxArsPerUsd, bondPricesPer100);
  const cf = { dividends: sum.dividendsCents };
  const currentValue = sum.currentValueCents;
  const latent = sum.latentCents;
  const realized = sum.realizedCents;
  const totalPnl = sum.totalPnlCents;
  const returnPct = sum.returnPct;
  const tir = sum.tir;
  const conc = sum.conc.map((c) => ({ ticker: c.ticker, pct: c.pct }));
  const fx = { usdPct: sum.usdPct, arsPct: sum.arsPct };

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
  lines.push(
    `Valor de mercado actual: ${money(currentValue)} (todo expresado en pesos` +
      (sum.fx ? `; lo que está en dólares se convirtió al dólar MEP $${sum.fx.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : '') +
      `). Liquidez (efectivo sin invertir): ${money(sum.cashCents)}.`,
  );
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
