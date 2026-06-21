import { useEffect, useState } from 'react';
import { getAnalysis, type Analysis } from './finnhub';

type CardState = { status: 'loading' | 'ok' | 'error'; data?: Analysis };

function n(v?: number, d = 2): string {
  return v == null ? '—' : v.toLocaleString('es-AR', { maximumFractionDigits: d });
}
function pct(v?: number, d = 1): string {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;
}
function cap(v?: number): string {
  if (v == null) return '—';
  return v >= 1000 ? `US$ ${(v / 1000).toFixed(1)}B` : `US$ ${v.toFixed(0)}M`;
}

function Consensus({ rec }: { rec: NonNullable<Analysis['rec']> }) {
  const buy = rec.strongBuy + rec.buy;
  const sell = rec.sell + rec.strongSell;
  const total = buy + rec.hold + sell;
  if (total === 0) return null;
  const verdict = buy > rec.hold && buy >= sell ? 'Mayoría en COMPRA' : sell > buy && sell > rec.hold ? 'Mayoría en VENTA' : 'Mayoría en MANTENER';
  return (
    <div>
      <div className="consBar">
        <div className="consSeg pos" style={{ width: `${(buy / total) * 100}%` }} />
        <div className="consSeg hold" style={{ width: `${(rec.hold / total) * 100}%` }} />
        <div className="consSeg neg" style={{ width: `${(sell / total) * 100}%` }} />
      </div>
      <p className="hint">
        <span className="pos">Compra {buy}</span> · Mantener {rec.hold} · <span className="neg">Venta {sell}</span> — <strong>{verdict}</strong>
      </p>
    </div>
  );
}

function Card({ ticker, state }: { ticker: string; state?: CardState }) {
  if (!state || state.status === 'loading') {
    return (
      <section className="section">
        <h3 className="sectionTitle">{ticker}</h3>
        <p className="hint">Cargando datos de mercado…</p>
      </section>
    );
  }
  if (state.status === 'error' || !state.data) {
    return (
      <section className="section">
        <h3 className="sectionTitle">{ticker}</h3>
        <p className="hint">Sin datos de mercado disponibles (común en acciones argentinas chicas).</p>
      </section>
    );
  }
  const a = state.data;
  return (
    <section className="section">
      <div className="empHeader">
        {a.logo && <img src={a.logo} alt="" className="empLogo" />}
        <div>
          <h3 className="sectionTitle" style={{ margin: 0 }}>
            {a.name ?? ticker} <span className="hint">({ticker})</span>
          </h3>
          {a.industry && <span className="hint">{a.industry}</span>}
        </div>
        {a.price != null && (
          <div className="empPrice">
            <span className="cardValue">US$ {n(a.price)}</span>
            {a.changePct != null && <span className={a.changePct >= 0 ? 'pos' : 'neg'}>{pct(a.changePct)}</span>}
          </div>
        )}
      </div>

      <div className="cards">
        <div className={`card ${(a.distFromHighPct ?? 0) < -20 ? 'neg' : ''}`}>
          <span className="cardLabel">Del máximo (52s)</span>
          <span className="cardValue">{pct(a.distFromHighPct)}</span>
          <span className="cardSub">máx US$ {n(a.high52)}</span>
        </div>
        <div className="card">
          <span className="cardLabel">P/E</span>
          <span className="cardValue">{n(a.pe, 1)}</span>
        </div>
        <div className="card">
          <span className="cardLabel">PEG</span>
          <span className="cardValue">{n(a.peg, 2)}</span>
        </div>
        <div className="card">
          <span className="cardLabel">P/B · P/S</span>
          <span className="cardValue">{n(a.pb, 1)} · {n(a.ps, 1)}</span>
        </div>
        <div className="card">
          <span className="cardLabel">Market cap</span>
          <span className="cardValue">{cap(a.marketCap)}</span>
        </div>
        <div className="card">
          <span className="cardLabel">Margen neto · ROE</span>
          <span className="cardValue">{pct(a.netMargin)} · {pct(a.roe)}</span>
        </div>
      </div>

      {a.rec && <Consensus rec={a.rec} />}

      {a.news.length > 0 && (
        <div className="empNews">
          <span className="cardLabel">Noticias</span>
          {a.news.map((nw, i) => (
            <a key={i} href={nw.url} target="_blank" rel="noopener noreferrer" className="newsLink">
              {nw.headline} <span className="hint">· {nw.source}</span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

export function Empresas({ tickers }: { tickers: string[] }) {
  const [cards, setCards] = useState<Record<string, CardState>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const t of tickers) {
        if (cancelled) return;
        setCards((prev) => ({ ...prev, [t]: { status: 'loading' } }));
        try {
          const data = await getAnalysis(t);
          if (cancelled) return;
          setCards((prev) => ({ ...prev, [t]: { status: data.hasData ? 'ok' : 'error', data } }));
        } catch {
          if (!cancelled) setCards((prev) => ({ ...prev, [t]: { status: 'error' } }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(',')]);

  if (tickers.length === 0) {
    return (
      <section className="section">
        <p className="hint">No hay acciones o CEDEARs en tu cartera para analizar.</p>
      </section>
    );
  }

  return (
    <div>
      <section className="section">
        <h2 className="sectionTitle">Análisis fundamental por empresa</h2>
        <p className="hint">
          Datos de mercado de Finnhub para tus tenencias. Funciona muy bien con CEDEARs y acciones
          de EEUU; las acciones argentinas pueden tener datos limitados.
        </p>
      </section>
      {tickers.map((t) => (
        <Card key={t} ticker={t} state={cards[t]} />
      ))}
    </div>
  );
}
