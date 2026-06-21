import { useEffect, useState } from 'react';
import { fetchPriceHistory } from './twelvedata';
import {
  annualizedVolPct,
  correlation,
  cumulativeValue,
  maxDrawdownPct,
  monthlyVaR95Pct,
  portfolioReturns,
  toReturns,
} from './risk';

interface Holding {
  ticker: string;
  marketValueCents: bigint;
}

interface AssetRisk {
  ticker: string;
  weight: number;
  volPct: number;
  maxDDPct: number;
  returnByDate: Map<string, number>;
}

interface Result {
  assets: AssetRisk[];
  excluded: string[];
  portfolioValue: number;
  portVolPct: number;
  varPct: number;
  varValue: number;
  portMaxDDPct: number;
  corr: number[][];
  commonDays: number;
}

function money(n: number): string {
  return `$ ${Math.round(n).toLocaleString('es-AR')}`;
}

function corrColor(v: number): string {
  // green = low/negative (diversified), red = high (moves together)
  if (v >= 0.7) return '#ef4444';
  if (v >= 0.4) return '#f59e0b';
  if (v >= 0) return '#64748b';
  return '#22c55e';
}

export function Riesgo({ holdings }: { holdings: Holding[] }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [res, setRes] = useState<Result | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    (async () => {
      const loaded: { ticker: string; mv: number; closes: number[]; dates: string[] }[] = [];
      const excluded: string[] = [];
      for (const h of holdings) {
        try {
          const hist = await fetchPriceHistory(h.ticker);
          if (hist.length >= 30) {
            loaded.push({
              ticker: h.ticker,
              mv: Number(h.marketValueCents) / 100,
              closes: hist.map((p) => p.close),
              dates: hist.map((p) => p.date),
            });
          } else excluded.push(h.ticker);
        } catch {
          excluded.push(h.ticker);
        }
      }
      if (cancelled) return;
      if (loaded.length === 0) {
        setState('error');
        return;
      }

      const totalMv = loaded.reduce((s, a) => s + a.mv, 0);
      const assets: AssetRisk[] = loaded.map((a) => {
        const rbd = new Map<string, number>();
        for (let i = 1; i < a.dates.length; i++) {
          if (a.closes[i - 1] > 0) rbd.set(a.dates[i], a.closes[i] / a.closes[i - 1] - 1);
        }
        return {
          ticker: a.ticker,
          weight: totalMv > 0 ? a.mv / totalMv : 0,
          volPct: annualizedVolPct(toReturns(a.closes)),
          maxDDPct: maxDrawdownPct(a.closes),
          returnByDate: rbd,
        };
      });

      let common = Array.from(assets[0].returnByDate.keys());
      for (const a of assets.slice(1)) common = common.filter((d) => a.returnByDate.has(d));
      common.sort();

      const portRet = portfolioReturns(
        assets.map((a) => ({ weight: a.weight, returnByDate: a.returnByDate })),
        common,
      );
      const portVolPct = annualizedVolPct(portRet);
      const varPct = monthlyVaR95Pct(portRet);
      const portMaxDDPct = maxDrawdownPct(cumulativeValue(portRet));

      const corr = assets.map((ai) =>
        assets.map((aj) =>
          correlation(
            common.map((d) => ai.returnByDate.get(d) ?? 0),
            common.map((d) => aj.returnByDate.get(d) ?? 0),
          ),
        ),
      );

      setRes({
        assets,
        excluded,
        portfolioValue: totalMv,
        portVolPct,
        varPct,
        varValue: (totalMv * varPct) / 100,
        portMaxDDPct,
        corr,
        commonDays: common.length,
      });
      setState('ok');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings.map((h) => h.ticker).join(',')]);

  if (holdings.length === 0) {
    return (
      <section className="section">
        <p className="hint">No hay acciones/CEDEARs con datos para analizar el riesgo.</p>
      </section>
    );
  }
  if (state === 'loading') {
    return (
      <section className="section">
        <h2 className="sectionTitle">Riesgo</h2>
        <p className="hint">Calculando riesgo (trayendo histórico de precios)… puede tardar unos segundos.</p>
      </section>
    );
  }
  if (state === 'error' || !res) {
    return (
      <section className="section">
        <h2 className="sectionTitle">Riesgo</h2>
        <p className="hint">No se pudieron traer históricos confiables para tus activos. Reintentá más tarde.</p>
      </section>
    );
  }

  return (
    <div>
      <section className="section">
        <h2 className="sectionTitle">Riesgo del portafolio</h2>
        <div className="cards">
          <div className="card">
            <span className="cardLabel">Volatilidad anual</span>
            <span className="cardValue">{res.portVolPct.toFixed(1)}%</span>
            <span className="cardSub">cuánto oscila</span>
          </div>
          <div className="card neg">
            <span className="cardLabel">VaR mensual (95%)</span>
            <span className="cardValue">{money(res.varValue)}</span>
            <span className="cardSub">−{res.varPct.toFixed(1)}% en un mes malo</span>
          </div>
          <div className="card neg">
            <span className="cardLabel">Drawdown máx (1 año)</span>
            <span className="cardValue">{res.portMaxDDPct.toFixed(1)}%</span>
            <span className="cardSub">peor caída desde un pico</span>
          </div>
          <div className="card">
            <span className="cardLabel">Activos analizados</span>
            <span className="cardValue">{res.assets.length}</span>
            <span className="cardSub">{res.commonDays} días en común</span>
          </div>
        </div>
        <p className="hint">
          El <strong>VaR</strong> estima que, en el 95% de los meses, no perderías más que ese monto;
          en el 5% peor, podría ser mayor. Cálculo paramétrico sobre la volatilidad histórica.
        </p>
      </section>

      <section className="section">
        <h2 className="sectionTitle">Simulación de escenarios</h2>
        <div className="cards">
          {[20, 40, 70].map((d) => (
            <div className="card neg" key={d}>
              <span className="cardLabel">Si cae {d}%</span>
              <span className="cardValue">−{money((res.portfolioValue * d) / 100)}</span>
              <span className="cardSub">quedarías en {money((res.portfolioValue * (100 - d)) / 100)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="sectionTitle">Volatilidad y caída por activo</h2>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>% cartera</th>
                <th>Volatilidad anual</th>
                <th>Drawdown máx</th>
              </tr>
            </thead>
            <tbody>
              {res.assets
                .slice()
                .sort((a, b) => b.weight - a.weight)
                .map((a) => (
                  <tr key={a.ticker}>
                    <td className="ticker">{a.ticker}</td>
                    <td>{(a.weight * 100).toFixed(1)}%</td>
                    <td>{a.volPct.toFixed(1)}%</td>
                    <td className="neg">{a.maxDDPct.toFixed(1)}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2 className="sectionTitle">Correlación entre activos</h2>
        <p className="hint">
          1 = se mueven igual (poca diversificación), 0 = independientes, negativo = se compensan.
        </p>
        <div className="tableWrap">
          <table className="table corrTable">
            <thead>
              <tr>
                <th></th>
                {res.assets.map((a) => (
                  <th key={a.ticker}>{a.ticker}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {res.assets.map((ai, i) => (
                <tr key={ai.ticker}>
                  <td className="ticker">{ai.ticker}</td>
                  {res.assets.map((aj, j) => (
                    <td key={aj.ticker} style={{ color: corrColor(res.corr[i][j]), fontWeight: 600 }}>
                      {res.corr[i][j].toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {res.excluded.length > 0 && (
        <p className="hint">
          No incluidos (sin datos de mercado confiables): {res.excluded.join(', ')}. Bonos y FCI se
          excluyen a propósito.
        </p>
      )}
    </div>
  );
}
