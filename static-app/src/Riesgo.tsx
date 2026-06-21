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
import type { Conclusion, Level } from './insights';

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

const ICON: Record<Level, string> = { good: '✅', warn: '⚠️', bad: '🔴' };

const INFO = {
  vol: 'Desvío estándar anualizado de los retornos diarios: cuánto sube y baja tu cartera en un año típico. Referencia: 15-25% es lo habitual en un índice diversificado (S&P 500); arriba de 35-40% se considera alta volatilidad, típica de acciones individuales o mercados emergentes como Argentina.',
  var: 'Value at Risk paramétrico: con 95% de confianza, en un mes no perderías más que este monto. El 5% de los meses (1 de cada 20) podría ser peor — es una estimación estadística sobre la volatilidad histórica, no una garantía, y no captura eventos extremos poco frecuentes ("cisnes negros").',
  dd: 'La peor caída registrada desde un máximo previo hasta el mínimo posterior, con el último año de precios. Indica cuánto "dolor" tuviste que aguantar para llegar al retorno actual. Caídas de 30-50% no son raras en acciones individuales; en una cartera diversificada suele ser menor.',
  assets: 'Activos con al menos 30 días de precios históricos confiables (Twelve Data). Bonos, FCI y tickers sin cotización en el exterior se excluyen a propósito: su riesgo no se puede medir con la misma metodología sin usar datos dudosos.',
  scenario: 'Aplica una caída porcentual hipotética al valor total actual, sin modelar cómo reaccionaría cada activo. Sirve para visualizar el impacto en pesos/dólares de un escenario adverso, no es una predicción.',
  perAsset: 'Volatilidad y caída máxima de cada activo por separado. Cruzalo con el "% cartera": un activo con peso alto y volatilidad alta es, en la práctica, el que más mueve el riesgo total de tu cartera.',
  corr: 'Correlación entre los retornos diarios de cada par de activos. 1 = se mueven igual (poca diversificación real entre ellos), 0 = independientes, negativo = se compensan (uno sube cuando el otro baja). Tener muchos tickers no diversifica si todos están altamente correlacionados entre sí.',
};

function InfoToggle({ id, onToggle }: { id: string; onToggle: (id: string) => void }) {
  return (
    <button className="infoBtn" onClick={() => onToggle(id)} aria-label="Qué significa">
      ⓘ
    </button>
  );
}

function riskRecommendations(res: Result): Conclusion[] {
  const out: Conclusion[] = [];

  if (res.portVolPct > 40) {
    out.push({
      level: 'bad',
      title: 'Volatilidad alta',
      detail: `${res.portVolPct.toFixed(0)}% anual: tu cartera puede oscilar fuerte en pocos meses. Si no tolerás esos vaivenes, considerá bajar el peso de los activos más volátiles o sumar algo más defensivo.`,
    });
  } else if (res.portVolPct > 25) {
    out.push({
      level: 'warn',
      title: 'Volatilidad moderada-alta',
      detail: `${res.portVolPct.toFixed(0)}% anual, por encima de un índice diversificado típico (15-25%). Razonable si tu horizonte es largo y lo tenés asumido.`,
    });
  } else {
    out.push({
      level: 'good',
      title: 'Volatilidad controlada',
      detail: `${res.portVolPct.toFixed(0)}% anual, en línea con una cartera diversificada.`,
    });
  }

  let maxCorr = -2;
  let pair: [string, string] | null = null;
  for (let i = 0; i < res.assets.length; i++) {
    for (let j = i + 1; j < res.assets.length; j++) {
      if (res.corr[i][j] > maxCorr) {
        maxCorr = res.corr[i][j];
        pair = [res.assets[i].ticker, res.assets[j].ticker];
      }
    }
  }
  if (pair && maxCorr >= 0.7) {
    out.push({
      level: 'warn',
      title: 'Diversificación real limitada',
      detail: `${pair[0]} y ${pair[1]} tienen correlación ${maxCorr.toFixed(2)}: se mueven casi juntos. Tenerlos a ambos no reduce tu riesgo tanto como parece — buscar activos con correlación más baja entre sí diversifica de verdad.`,
    });
  } else if (pair && maxCorr < 0.3 && res.assets.length >= 3) {
    out.push({
      level: 'good',
      title: 'Buena diversificación entre activos',
      detail: `Tus posiciones principales tienen correlación baja entre sí (máx. ${maxCorr.toFixed(2)}), lo que amortigua caídas puntuales de un activo.`,
    });
  }

  if (res.portMaxDDPct <= -40) {
    out.push({
      level: 'bad',
      title: 'Drawdown histórico severo',
      detail: `Tu cartera llegó a caer ${res.portMaxDDPct.toFixed(0)}% desde un máximo en el último año. Asegurate de tener el horizonte y la espalda financiera para aguantar una caída similar sin vender en el peor momento.`,
    });
  } else if (res.portMaxDDPct <= -20) {
    out.push({
      level: 'warn',
      title: 'Drawdown a tener presente',
      detail: `Caída máxima de ${res.portMaxDDPct.toFixed(0)}% en el último año. No es alarmante, pero conviene tenerlo en mente antes de invertir dinero que podrías necesitar pronto.`,
    });
  }

  const top = res.assets.slice().sort((a, b) => b.weight - a.weight)[0];
  if (top && top.weight > 0.3 && top.volPct > 30) {
    out.push({
      level: 'warn',
      title: 'Un activo concentra el riesgo',
      detail: `${top.ticker} pesa ${(top.weight * 100).toFixed(0)}% de los activos analizados y tiene ${top.volPct.toFixed(0)}% de volatilidad anual: es el principal motor del riesgo total de tu cartera.`,
    });
  }

  return out;
}

export function Riesgo({ holdings }: { holdings: Holding[] }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [res, setRes] = useState<Result | null>(null);
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  function toggleInfo(id: string) {
    setOpenInfo((o) => (o === id ? null : id));
  }

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

  const recs = riskRecommendations(res);

  return (
    <div>
      <section className="section">
        <h2 className="sectionTitle">Riesgo del portafolio</h2>
        <p className="hint">
          Estimaciones cuantitativas calculadas sobre el histórico de precios real de tus activos
          (excluye bonos, FCI y tickers sin datos confiables — ver detalle abajo).
        </p>
        <div className="cards">
          <div className="card">
            <span className="cardLabel">
              Volatilidad anual <InfoToggle id="vol" onToggle={toggleInfo} />
            </span>
            <span className="cardValue">{res.portVolPct.toFixed(1)}%</span>
            <span className="cardSub">cuánto oscila</span>
            {openInfo === 'vol' && <div className="ovInfo">{INFO.vol}</div>}
          </div>
          <div className="card neg">
            <span className="cardLabel">
              VaR mensual (95%) <InfoToggle id="var" onToggle={toggleInfo} />
            </span>
            <span className="cardValue">{money(res.varValue)}</span>
            <span className="cardSub">−{res.varPct.toFixed(1)}% en un mes malo</span>
            {openInfo === 'var' && <div className="ovInfo">{INFO.var}</div>}
          </div>
          <div className="card neg">
            <span className="cardLabel">
              Drawdown máx (1 año) <InfoToggle id="dd" onToggle={toggleInfo} />
            </span>
            <span className="cardValue">{res.portMaxDDPct.toFixed(1)}%</span>
            <span className="cardSub">peor caída desde un pico</span>
            {openInfo === 'dd' && <div className="ovInfo">{INFO.dd}</div>}
          </div>
          <div className="card">
            <span className="cardLabel">
              Activos analizados <InfoToggle id="assets" onToggle={toggleInfo} />
            </span>
            <span className="cardValue">{res.assets.length}</span>
            <span className="cardSub">{res.commonDays} días en común</span>
            {openInfo === 'assets' && <div className="ovInfo">{INFO.assets}</div>}
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="sectionTitle">
          Simulación de escenarios <InfoToggle id="scenario" onToggle={toggleInfo} />
        </h2>
        {openInfo === 'scenario' && <div className="ovInfo" style={{ marginBottom: 10 }}>{INFO.scenario}</div>}
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
        <h2 className="sectionTitle">
          Volatilidad y caída por activo{' '}
          <InfoToggle id="perAsset" onToggle={toggleInfo} />
        </h2>
        {openInfo === 'perAsset' && <div className="ovInfo" style={{ marginBottom: 10 }}>{INFO.perAsset}</div>}
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
        <h2 className="sectionTitle">
          Correlación entre activos <InfoToggle id="corr" onToggle={toggleInfo} />
        </h2>
        <p className="hint">
          1 = se mueven igual (poca diversificación), 0 = independientes, negativo = se compensan.
        </p>
        {openInfo === 'corr' && <div className="ovInfo" style={{ marginBottom: 10 }}>{INFO.corr}</div>}
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

      <section className="section">
        <h2 className="sectionTitle">Recomendaciones</h2>
        <p className="hint">Lectura automática de las métricas de riesgo de arriba.</p>
        <div className="conclList">
          {recs.map((c, i) => (
            <div className={`conclItem ${c.level}`} key={i}>
              <span className="conclIcon">{ICON[c.level]}</span>
              <div>
                <div className="conclTitle">{c.title}</div>
                <div className="conclDetail">{c.detail}</div>
              </div>
            </div>
          ))}
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
