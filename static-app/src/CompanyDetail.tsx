import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { getAnalysis, type Analysis } from './finnhub';
import { fetchPriceHistory, type PricePoint } from './twelvedata';

const TIMEFRAMES = [
  { label: '1S', days: 7 },
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
function usd(v?: number): string {
  return v == null ? '—' : `US$ ${n(v)}`;
}
function cap(v?: number): string {
  if (v == null) return '—';
  return v >= 1000 ? `US$ ${(v / 1000).toFixed(1)}B` : `US$ ${v.toFixed(0)}M`;
}

function Row({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="ovItem">
      <span className="ovLabel">{label}</span>
      <span className={`ovVal ${cls ?? ''}`}>{value}</span>
    </div>
  );
}

function Consensus({ rec }: { rec: NonNullable<Analysis['rec']> }) {
  const buy = rec.strongBuy + rec.buy;
  const sell = rec.sell + rec.strongSell;
  const total = buy + rec.hold + sell;
  if (total === 0) return null;
  const verdict = buy > rec.hold && buy >= sell ? 'COMPRA' : sell > buy && sell > rec.hold ? 'VENTA' : 'MANTENER';
  return (
    <div className="ovBlock">
      <span className="ovHead">Consenso de analistas — <strong>{verdict}</strong></span>
      <div className="consBar">
        <div className="consSeg pos" style={{ width: `${(buy / total) * 100}%` }} />
        <div className="consSeg hold" style={{ width: `${(rec.hold / total) * 100}%` }} />
        <div className="consSeg neg" style={{ width: `${(sell / total) * 100}%` }} />
      </div>
      <p className="hint">
        <span className="pos">Compra {buy}</span> · Mantener {rec.hold} · <span className="neg">Venta {sell}</span>
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
  if (!data) return <p className="hint">Cargando gráfico…</p>;

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
      <ResponsiveContainer width="100%" height={190}>
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

/** Investing.com-style company detail: price header, chart with timeframes,
 *  key-stats overview grid, analyst consensus and news. */
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
      {status === 'ok' && a && (a.name || a.price != null) && (
        <div className="ivHeader">
          <div>
            <div className="ivName">
              {a.name ?? ticker} <span className="ivTicker">{ticker}</span>
            </div>
            {a.industry && <div className="ivIndustry">{a.industry}</div>}
          </div>
          {a.price != null && (
            <div className="ivPrice">
              <div className="ivPriceNum">US$ {n(a.price)}</div>
              {a.changePct != null && (
                <div className={a.changePct >= 0 ? 'pos' : 'neg'}>
                  {pct(a.changePct, 2)} hoy
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <PriceChart ticker={ticker} />

      {status === 'loading' && <p className="hint">Cargando datos financieros…</p>}
      {status === 'nodata' && (
        <p className="hint">Sin datos de mercado disponibles (común en acciones argentinas chicas).</p>
      )}

      {status === 'ok' && a && (
        <>
          <span className="ovHead">Resumen</span>
          <div className="ovGrid">
            <Row label="Rango 52 sem." value={a.low52 != null && a.high52 != null ? `${usd(a.low52)} – ${usd(a.high52)}` : '—'} />
            <Row label="Desde el máximo" value={pct(a.distFromHighPct)} cls={(a.distFromHighPct ?? 0) < 0 ? 'neg' : 'pos'} />
            <Row label="Variación 1 año" value={pct(a.yearReturnPct)} cls={(a.yearReturnPct ?? 0) >= 0 ? 'pos' : 'neg'} />
            <Row label="Cap. de mercado" value={cap(a.marketCap)} />
            <Row label="P/E (PER)" value={n(a.pe, 1)} />
            <Row label="PEG" value={n(a.peg, 2)} />
            <Row label="P/B" value={n(a.pb, 1)} />
            <Row label="P/S" value={n(a.ps, 1)} />
            <Row label="BPA (EPS)" value={usd(a.eps)} />
            <Row label="Beta" value={n(a.beta, 2)} />
            <Row label="Margen neto" value={pct(a.netMargin)} />
            <Row label="ROE" value={pct(a.roe)} />
            <Row label="Crec. ingresos" value={pct(a.revGrowth)} />
            <Row label="Div. yield" value={pct(a.divYield)} />
            <Row label="Cierre ant." value={usd(a.prevClose)} />
          </div>

          {a.rec && <Consensus rec={a.rec} />}

          {a.news.length > 0 && (
            <div className="ovBlock">
              <span className="ovHead">Noticias</span>
              <div className="empNews">
                {a.news.map((nw, i) => (
                  <a key={i} href={nw.url} target="_blank" rel="noopener noreferrer" className="newsLink">
                    {nw.headline} <span className="hint">· {nw.source}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
