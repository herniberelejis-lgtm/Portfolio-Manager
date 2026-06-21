import { useEffect, useState } from 'react';
import { fetchBtcUsd, fetchCCL, fetchInflation, inflationAccum, latestValue, valueAtDate } from './benchmarks';
import { fetchPeriodReturn } from './twelvedata';

interface Props {
  startDate: Date | null;
  returnPct: number | null; // total return over the period, %
  currentValueCents: bigint;
}

interface Data {
  cclNow: number;
  cclReturnPct: number;
  inflAccumPct: number;
  usdValue: number;
  btcReturnPct?: number;
  btcValue?: number;
  sp500ReturnPct?: number;
  argtReturnPct?: number;
}

function pctStr(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export function Benchmarks({ startDate, returnPct, currentValueCents }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    if (!startDate) return;
    let cancelled = false;
    setState('loading');
    Promise.all([
      fetchCCL(),
      fetchInflation(),
      fetchBtcUsd(startDate).catch(() => null),
      fetchPeriodReturn('SPY', startDate).catch(() => null),
      fetchPeriodReturn('ARGT', startDate).catch(() => null),
    ])
      .then(([ccl, infl, btc, sp500, argt]) => {
        if (cancelled) return;
        const cclNow = latestValue(ccl);
        const cclStart = valueAtDate(ccl, startDate);
        if (!cclNow || !cclStart) throw new Error('sin datos');
        const usdValue = Number(currentValueCents) / 100 / cclNow;
        setData({
          cclNow,
          cclReturnPct: (cclNow / cclStart - 1) * 100,
          inflAccumPct: inflationAccum(infl, startDate),
          usdValue,
          btcReturnPct: btc ? (btc.now / btc.start - 1) * 100 : undefined,
          btcValue: btc ? usdValue / btc.now : undefined,
          sp500ReturnPct: sp500 ?? undefined,
          argtReturnPct: argt ?? undefined,
        });
        setState('ok');
      })
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
    };
  }, [startDate, currentValueCents]);

  return (
    <section className="section">
      <h2 className="sectionTitle">Benchmarks — ¿le ganaste al dólar y a la inflación?</h2>
      {state === 'loading' && <p className="hint">Cargando dólar CCL e inflación…</p>}
      {state === 'error' && (
        <p className="hint">
          No se pudieron traer los datos de mercado (posible bloqueo del navegador). Reintentá más tarde.
        </p>
      )}
      {state === 'ok' && data && (
        <>
          <div className="cards">
            <div className="card">
              <span className="cardLabel">Valor en USD (CCL)</span>
              <span className="cardValue">US$ {data.usdValue.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
              <span className="cardSub">CCL ${data.cclNow.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="card">
              <span className="cardLabel">Tu retorno (período)</span>
              <span className={`cardValue ${(returnPct ?? 0) >= 0 ? 'pos' : 'neg'}`}>{returnPct != null ? pctStr(returnPct) : '—'}</span>
            </div>
            <div className={`card ${(returnPct ?? 0) >= data.cclReturnPct ? 'pos' : 'neg'}`}>
              <span className="cardLabel">vs Dólar CCL</span>
              <span className="cardValue">{pctStr(data.cclReturnPct)}</span>
              <span className="cardSub">
                {returnPct != null
                  ? returnPct >= data.cclReturnPct
                    ? '✅ Le ganaste al dólar'
                    : '❌ El dólar te ganó'
                  : ''}
              </span>
            </div>
            <div className={`card ${(returnPct ?? 0) >= data.inflAccumPct ? 'pos' : 'neg'}`}>
              <span className="cardLabel">vs Inflación (IPC)</span>
              <span className="cardValue">{pctStr(data.inflAccumPct)}</span>
              <span className="cardSub">
                {returnPct != null
                  ? returnPct >= data.inflAccumPct
                    ? '✅ Ganancia real positiva'
                    : '❌ Perdiste contra la inflación'
                  : ''}
              </span>
            </div>
            {data.btcReturnPct != null && (
              <div className="card">
                <span className="cardLabel">Bitcoin (período, USD)</span>
                <span className={`cardValue ${data.btcReturnPct >= 0 ? 'pos' : 'neg'}`}>{pctStr(data.btcReturnPct)}</span>
                <span className="cardSub">referencia en dólares</span>
              </div>
            )}
            {data.btcValue != null && (
              <div className="card">
                <span className="cardLabel">Tu cartera en BTC</span>
                <span className="cardValue">₿ {data.btcValue.toLocaleString('es-AR', { maximumFractionDigits: 4 })}</span>
              </div>
            )}
            {data.sp500ReturnPct != null && (
              <div className="card">
                <span className="cardLabel">S&amp;P 500 (período, USD)</span>
                <span className={`cardValue ${data.sp500ReturnPct >= 0 ? 'pos' : 'neg'}`}>{pctStr(data.sp500ReturnPct)}</span>
                <span className="cardSub">mercado de EEUU</span>
              </div>
            )}
            {data.argtReturnPct != null && (
              <div className="card">
                <span className="cardLabel">Acciones ARG (período, USD)</span>
                <span className={`cardValue ${data.argtReturnPct >= 0 ? 'pos' : 'neg'}`}>{pctStr(data.argtReturnPct)}</span>
                <span className="cardSub">ETF ARGT (proxy Merval)</span>
              </div>
            )}
          </div>
          <p className="hint">
            Comparado desde tu primera operación. “Tu retorno” es la ganancia total sobre el aporte neto en el
            período; el dólar y la inflación están acumulados en el mismo período.
          </p>
        </>
      )}
    </section>
  );
}
