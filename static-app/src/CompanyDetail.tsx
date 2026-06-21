import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { getAnalysis, type Analysis } from './finnhub';
import { fetchPriceHistory, type PricePoint } from './twelvedata';

const TIMEFRAMES = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1A', days: 365 },
];

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
      <span className="cardLabel">Consenso de analistas</span>
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

function PriceChart({ ticker }: { ticker: string }) {
  const [data, setData] = useState<PricePoint[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [days, setDays] = useState(90);

  useEffect(() => {
    let cancelled = false;
    fetchPriceHistory(ticker)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (failed) return null;
  if (!data) return <p className="hint">Cargando gráfico de precio…</p>;

  const cutoff = Date.now() - days * 864e5;
  const slice = data.filter((p) => new Date(p.date).getTime() >= cutoff);
  const view = slice.length >= 2 ? slice : data;
  if (view.length < 2) return null;

  const first = view[0].close;
  const last = view[view.length - 1].close;
  const color = last >= first ? '#22c55e' : '#ef4444';
  const periodPct = ((last / first - 1) * 100).toFixed(1);

  return (
    <div className="empChart">
      <div className="chartHead">
        <span className="cardLabel">
          Precio{' '}
          <span className={last >= first ? 'pos' : 'neg'}>
            ({last >= first ? '+' : ''}
            {periodPct}%)
          </span>
        </span>
        <div className="filterRow">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.label}
              className={`chip ${days === tf.days ? 'chipActive' : ''}`}
              onClick={() => setDays(tf.days)}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={170}>
        <AreaChart data={view} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`g-${ticker}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide />
          <YAxis domain={['auto', 'auto']} width={52} tick={{ fontSize: 11, fill: '#94a3b8' }} />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
            labelStyle={{ color: '#94a3b8' }}
            formatter={(v) => [`US$ ${Number(v).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`, 'Cierre']}
          />
          <Area type="monotone" dataKey="close" stroke={color} fill={`url(#g-${ticker})`} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Full company detail: price chart with timeframes + fundamentals + analyst
 *  consensus + news. Used in the Empresas tab and in the expandable holdings. */
export function CompanyDetail({ ticker }: { ticker: string }) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'nodata'>('loading');
  const [a, setA] = useState<Analysis | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    getAnalysis(ticker)
      .then((data) => {
        if (cancelled) return;
        setA(data);
        setStatus(data.hasData ? 'ok' : 'nodata');
      })
      .catch(() => !cancelled && setStatus('nodata'));
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  return (
    <div className="companyDetail">
      <PriceChart ticker={ticker} />

      {status === 'loading' && <p className="hint">Cargando datos financieros…</p>}
      {status === 'nodata' && (
        <p className="hint">Sin datos financieros disponibles (común en acciones argentinas chicas).</p>
      )}
      {status === 'ok' && a && (
        <>
          {(a.name || a.price != null) && (
            <div className="empHeadRow">
              <span className="hint">{a.name ?? ticker}{a.industry ? ` · ${a.industry}` : ''}</span>
              {a.price != null && (
                <span className="cardValue">
                  US$ {n(a.price)}{' '}
                  {a.changePct != null && <span className={a.changePct >= 0 ? 'pos' : 'neg'}>{pct(a.changePct)}</span>}
                </span>
              )}
            </div>
          )}
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
              <span className="cardLabel">Margen · ROE</span>
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
        </>
      )}
    </div>
  );
}
