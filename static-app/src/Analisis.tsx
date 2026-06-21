import { useMemo } from 'react';
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
import { Benchmarks } from './Benchmarks';
import { Conclusiones } from './Conclusiones';
import type { ConclusionInput } from './insights';

function pesos(cents: bigint): number {
  return Number(cents) / 100;
}
function money(cents: bigint, currency = 'ARS'): string {
  const sym = currency === 'USD' ? 'US$' : '$';
  return `${sym} ${pesos(cents).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(n: number | null | undefined, d = 1): string {
  return n == null ? '—' : `${n.toFixed(d)}%`;
}

// Rough liquidity by asset class (data on traded volume isn't available in a
// static app, so this is an estimate).
const LIQUIDITY: Record<string, 'alta' | 'media' | 'baja'> = {
  CEDEAR: 'alta',
  FCI: 'alta',
  'Acción ARG': 'media',
  'Bono/ON': 'media',
  'Dólar MEP': 'alta',
  Otro: 'media',
};

export function Analisis({
  transactions,
  prices,
}: {
  transactions: ParsedTransaction[];
  prices: Record<string, bigint>;
}) {
  const a = useMemo(() => {
    const stats = perTicker(transactions);
    const costs = computeCosts(transactions);
    const cf = cashFlows(transactions);
    const oq = operationalQuality(stats);
    const classes = byAssetClass(stats);

    const held = stats.filter((s) => s.heldQty > 0);
    let currentValue = 0n;
    let heldCost = 0n;
    const priceAlerts: { ticker: string; diffPct: number }[] = [];
    for (const s of held) {
      const price = prices[s.ticker] ?? s.avgCostCents;
      currentValue += BigInt(Math.round(s.heldQty)) * price;
      heldCost += s.heldCostCents;
      const diff = Number(s.avgCostCents) > 0 ? ((Number(price) - Number(s.avgCostCents)) / Number(s.avgCostCents)) * 100 : 0;
      if (Math.abs(diff) >= 15) priceAlerts.push({ ticker: s.ticker, diffPct: diff });
    }
    const latent = currentValue - heldCost;
    const realized = stats.reduce((s, t) => s + t.realizedCents, 0n);
    const totalPnl = realized + latent + cf.dividends;
    const returnPct = cf.netContributed > 0n ? (Number(totalPnl) / Number(cf.netContributed)) * 100 : null;

    // money-weighted return (XIRR): deposits out, withdrawals in, terminal = holdings + cash
    const cash = arsCashBalanceCents(transactions);
    const flows: Flow[] = [];
    for (const t of transactions) {
      if (t.currency !== 'ARS') continue;
      if (t.type === 'deposit') flows.push({ date: t.date, amount: -pesos(t.amountCents) });
      else if (t.type === 'withdrawal') flows.push({ date: t.date, amount: pesos(t.amountCents) });
    }
    flows.push({ date: new Date(), amount: pesos(currentValue + cash) });
    const tir = xirr(flows);

    // concentration by ticker (ARS, at market)
    const heldArs = held.filter((s) => s.currency === 'ARS');
    let totMv = 0n;
    const mvByTicker = heldArs.map((s) => {
      const mv = BigInt(Math.round(s.heldQty)) * (prices[s.ticker] ?? s.avgCostCents);
      totMv += mv;
      return { ticker: s.ticker, mv, assetClass: s.assetClass };
    });
    const conc = mvByTicker
      .map((x) => ({ ...x, pct: totMv > 0n ? (Number(x.mv) / Number(totMv)) * 100 : 0 }))
      .sort((x, y) => y.pct - x.pct);

    const maxPos = conc.length ? conc[0].pct : 0;
    const maxClass = classes.length ? Math.max(...classes.map((c) => c.pctOfHeld)) : 0;
    const riskLevel = maxPos > 40 || maxClass > 70 ? 'Alto' : maxPos > 20 || maxClass > 50 ? 'Medio' : 'Bajo';

    // liquidity
    let liqAlta = 0n;
    for (const x of mvByTicker) if (LIQUIDITY[x.assetClass] === 'alta') liqAlta += x.mv;
    const liqAltaPct = totMv > 0n ? (Number(liqAlta) / Number(totMv)) * 100 : 0;

    const realizedRows = stats.filter((s) => s.realizedCents !== 0n).sort((x, y) => Number(y.realizedCents - x.realizedCents));
    const beh = behavior(transactions);
    const fiscal = realizedByYear(transactions);
    const fx = currencyExposure(stats, prices);
    const startDate = transactions.length
      ? new Date(Math.min(...transactions.map((t) => t.date.getTime())))
      : null;

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

    return {
      stats, costs, cf, oq, classes, currentValue, latent, realized, totalPnl, returnPct,
      tir, conc, riskLevel, liqAltaPct, priceAlerts, realizedRows, held, beh, fiscal, fx, startDate,
      conclusionInput,
    };
  }, [transactions, prices]);

  return (
    <div>
      <Conclusiones input={a.conclusionInput} startDate={a.startDate} returnPct={a.returnPct} />

      {/* Executive summary */}
      <section className="section">
        <h2 className="sectionTitle">Resumen ejecutivo</h2>
        <div className="cards">
          <div className="card">
            <span className="cardLabel">Valor actual</span>
            <span className="cardValue">{money(a.currentValue)}</span>
          </div>
          <div className={`card ${a.totalPnl >= 0n ? 'pos' : 'neg'}`}>
            <span className="cardLabel">Ganancia total</span>
            <span className="cardValue">{money(a.totalPnl)}</span>
            <span className="cardSub">{pct(a.returnPct)} sobre aporte neto</span>
          </div>
          <div className={`card ${(a.tir ?? 0) >= 0 ? 'pos' : 'neg'}`}>
            <span className="cardLabel">TIR anual (estimada)</span>
            <span className="cardValue">{a.tir != null ? pct(a.tir * 100) : '—'}</span>
          </div>
          <div className={`card ${a.riskLevel === 'Alto' ? 'neg' : a.riskLevel === 'Bajo' ? 'pos' : ''}`}>
            <span className="cardLabel">Nivel de riesgo</span>
            <span className="cardValue">{a.riskLevel}</span>
            <span className="cardSub">por concentración</span>
          </div>
        </div>
      </section>

      {/* Benchmarks (USD CCL + inflation) */}
      <Benchmarks startDate={a.startDate} returnPct={a.returnPct} currentValueCents={a.currentValue} />

      {/* Return breakdown */}
      <section className="section">
        <h2 className="sectionTitle">Retorno</h2>
        <div className="cards">
          <div className={`card ${a.realized >= 0n ? 'pos' : 'neg'}`}>
            <span className="cardLabel">P&amp;L realizado</span>
            <span className="cardValue">{money(a.realized)}</span>
          </div>
          <div className={`card ${a.latent >= 0n ? 'pos' : 'neg'}`}>
            <span className="cardLabel">P&amp;L latente</span>
            <span className="cardValue">{money(a.latent)}</span>
          </div>
          <div className="card">
            <span className="cardLabel">Dividendos</span>
            <span className="cardValue">{money(a.cf.dividends)}</span>
          </div>
          <div className="card">
            <span className="cardLabel">Aporte neto</span>
            <span className="cardValue">{money(a.cf.netContributed)}</span>
          </div>
        </div>
      </section>

      {/* Operational quality */}
      <section className="section">
        <h2 className="sectionTitle">Calidad operativa</h2>
        <div className="cards">
          <div className="card">
            <span className="cardLabel">Win rate</span>
            <span className="cardValue">{pct(a.oq.winRatePct)}</span>
            <span className="cardSub">{a.oq.wins} de {a.oq.totalSales} ventas</span>
          </div>
          <div className="card">
            <span className="cardLabel">Riesgo / Recompensa</span>
            <span className="cardValue">{a.oq.riskReward != null ? a.oq.riskReward.toFixed(2) : '—'}</span>
            <span className="cardSub">ganás vs perdés</span>
          </div>
          <div className="card">
            <span className="cardLabel">Ganancia prom.</span>
            <span className="cardValue pos">{money(a.oq.avgWinCents)}</span>
          </div>
          <div className="card">
            <span className="cardLabel">Pérdida prom.</span>
            <span className="cardValue neg">{money(a.oq.avgLossCents)}</span>
          </div>
        </div>
      </section>

      {/* Behavior */}
      <section className="section">
        <h2 className="sectionTitle">Comportamiento</h2>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Clase de activo</th>
                <th>Win rate</th>
                <th>Operaciones</th>
                <th>Realizado</th>
              </tr>
            </thead>
            <tbody>
              {a.beh.byClass.map((c) => (
                <tr key={c.assetClass}>
                  <td className="opCell">{c.assetClass}</td>
                  <td className={c.winRatePct >= 50 ? 'pos' : 'neg'}>{pct(c.winRatePct, 0)}</td>
                  <td>{c.wins}/{c.total}</td>
                  <td className={c.realizedCents >= 0n ? 'pos' : 'neg'}>{money(c.realizedCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="cards" style={{ marginTop: 14 }}>
          <div className="card">
            <span className="cardLabel">Holding ganadoras</span>
            <span className="cardValue">{a.beh.winHoldDays != null ? `${Math.round(a.beh.winHoldDays)}d` : '—'}</span>
          </div>
          <div className="card">
            <span className="cardLabel">Holding perdedoras</span>
            <span className="cardValue">{a.beh.lossHoldDays != null ? `${Math.round(a.beh.lossHoldDays)}d` : '—'}</span>
          </div>
          <div className="card">
            <span className="cardLabel">Operaciones / mes</span>
            <span className="cardValue">{a.beh.tradesPerMonth.toFixed(1)}</span>
          </div>
          <div className="card">
            <span className="cardLabel">Exposición USD</span>
            <span className="cardValue">{a.fx.usdPct.toFixed(0)}%</span>
            <span className="cardSub">{a.fx.arsPct.toFixed(0)}% en pesos</span>
          </div>
        </div>
        {a.beh.bestSale && a.beh.worstSale && (
          <p className="hint">
            Mejor operación: <span className="pos">{a.beh.bestSale.ticker} {money(a.beh.bestSale.realizedCents)}</span> ·
            {' '}Peor: <span className="neg">{a.beh.worstSale.ticker} {money(a.beh.worstSale.realizedCents)}</span>
          </p>
        )}
        {(() => {
          const cedear = a.beh.byClass.find((c) => c.assetClass === 'CEDEAR');
          const arg = a.beh.byClass.find((c) => c.assetClass === 'Acción ARG');
          if (cedear && arg && cedear.realizedCents > 0n && arg.realizedCents < 0n) {
            return (
              <p className="message">
                📌 Patrón detectado: tus <strong>CEDEARs</strong> ganan {pct(cedear.winRatePct, 0)} de las veces ({money(cedear.realizedCents)}),
                mientras tus <strong>acciones argentinas</strong> ganan solo {pct(arg.winRatePct, 0)} ({money(arg.realizedCents)}).
                Tu edge está claramente en los CEDEARs.
              </p>
            );
          }
          return null;
        })()}
      </section>

      {/* Tax by year */}
      <section className="section">
        <h2 className="sectionTitle">Resumen fiscal por año</h2>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Año</th>
                <th>P&amp;L realizado</th>
                <th>Dividendos</th>
              </tr>
            </thead>
            <tbody>
              {a.fiscal.map((y) => (
                <tr key={y.year}>
                  <td className="ticker">{y.year}</td>
                  <td className={y.realizedCents >= 0n ? 'pos' : 'neg'}>{money(y.realizedCents)}</td>
                  <td>{money(y.dividendsCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">P&amp;L realizado por año calendario (ventas cerradas) — útil para estimar Ganancias.</p>
      </section>

      {/* Concentration */}
      <section className="section">
        <h2 className="sectionTitle">Concentración</h2>
        {a.conc.map((c) => (
          <div className="concRow" key={c.ticker}>
            <span className="concTicker">{c.ticker}</span>
            <div className="concBarWrap">
              <div className="concBar" style={{ width: `${Math.min(c.pct, 100)}%` }} />
            </div>
            <span className={`concPct ${c.pct > 20 ? 'neg' : ''}`}>
              {c.pct.toFixed(1)}% {c.pct > 20 ? '⚠️' : ''}
            </span>
          </div>
        ))}
        <p className="hint">
          Por clase:{' '}
          {a.classes.map((c) => `${c.assetClass} ${c.pctOfHeld.toFixed(0)}%`).join(' · ')}.
          {a.classes.some((c) => c.pctOfHeld > 50) && ' ⚠️ Una clase supera el 50%.'}
        </p>
      </section>

      {/* Price alerts */}
      {a.priceAlerts.length > 0 && (
        <section className="section">
          <h2 className="sectionTitle">Alertas de precio (±15% vs costo)</h2>
          {a.priceAlerts.map((p) => (
            <p key={p.ticker} className={p.diffPct >= 0 ? 'pos' : 'neg'}>
              {p.ticker}: {p.diffPct >= 0 ? '+' : ''}
              {p.diffPct.toFixed(1)}% {p.diffPct >= 0 ? '🔼' : '🔽'} desde tu precio de compra
            </p>
          ))}
        </section>
      )}

      {/* Realized P&L by asset */}
      <section className="section">
        <h2 className="sectionTitle">P&amp;L realizado por activo</h2>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Clase</th>
                <th>Realizado</th>
                <th>ROI</th>
                <th>Hold prom.</th>
              </tr>
            </thead>
            <tbody>
              {a.realizedRows.map((s) => (
                <tr key={s.ticker}>
                  <td className="ticker">{s.ticker}</td>
                  <td className="opCell">{s.assetClass}</td>
                  <td className={s.realizedCents >= 0n ? 'pos' : 'neg'}>{money(s.realizedCents)}</td>
                  <td className={s.roiPct != null && s.roiPct >= 0 ? 'pos' : 'neg'}>{pct(s.roiPct)}</td>
                  <td>{s.avgHoldingDays != null ? `${Math.round(s.avgHoldingDays)}d` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Costs + liquidity */}
      <section className="section">
        <h2 className="sectionTitle">Costos y liquidez</h2>
        <div className="cards">
          <div className="card">
            <span className="cardLabel">Costos totales</span>
            <span className="cardValue">$ {a.costs.total.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className="cardSub">{a.costs.pctSobreVolumen.toFixed(2)}% del volumen operado</span>
          </div>
          <div className="card">
            <span className="cardLabel">Liquidez alta (estim.)</span>
            <span className="cardValue">{a.liqAltaPct.toFixed(0)}%</span>
            <span className="cardSub">convertible a cash &lt; 48h</span>
          </div>
        </div>
        <p className="hint">
          Comisiones $ {a.costs.comision.toLocaleString('es-AR', { maximumFractionDigits: 0 })} · Derechos $
          {' '}{a.costs.derechos.toLocaleString('es-AR', { maximumFractionDigits: 0 })} · IVA $
          {' '}{a.costs.iva.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
        </p>
      </section>
    </div>
  );
}
