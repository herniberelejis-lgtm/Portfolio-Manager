import { useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
} from 'recharts';
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

function Row({ label, value, cls, info }: { label: string; value: string; cls?: string; info?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ovItem">
      <span className="ovLabel">
        {label}
        {info && (
          <button className="infoBtn" onClick={() => setOpen((o) => !o)} aria-label="Qué significa">
            ⓘ
          </button>
        )}
      </span>
      <span className={`ovVal ${cls ?? ''}`}>{value}</span>
      {open && info && <div className="ovInfo">{info}</div>}
    </div>
  );
}

const INFO = {
  range52: 'Precio mínimo y máximo del último año. Ayuda a ver si está caro o barato respecto a su rango reciente.',
  fromHigh: 'Cuánto está por debajo de su máximo de 52 semanas. Muy negativo puede ser oportunidad… o que algo anda mal.',
  year: 'Cuánto subió o bajó el precio en el último año.',
  cap: 'Valor total de la empresa en bolsa (precio × acciones). >US$10B = "large cap", <US$2B = "small cap".',
  pe: 'P/E (PER) = Precio ÷ Ganancia por acción. Cuánto pagás por cada $1 de ganancia anual. Promedio histórico del S&P 500: ~15-20. Más alto = más caro o más expectativa de crecimiento.',
  peg: 'P/E ajustado por el crecimiento de las ganancias. Menos de 1 suele indicar "barato para lo que crece"; más de 2, caro. Referencia: ~1.',
  pb: 'P/B = Precio ÷ Valor libro (patrimonio contable). ~1-3 es típico; bancos suelen operar por debajo de 1,5.',
  ps: 'P/S = Precio ÷ Ventas. Útil para empresas que aún no dan ganancias. Menos de 2 es bajo; más de 10 es alto (común en tecnología).',
  eps: 'BPA (EPS) = Ganancia por acción de los últimos 12 meses. Cuánto ganó la empresa por cada acción.',
  beta: 'Sensibilidad respecto al mercado. 1 = se mueve igual que el índice; >1 = más volátil/agresiva; <1 = más defensiva.',
  margin: 'Margen neto = qué % de las ventas queda como ganancia. >10% es bueno; >20% excelente.',
  roe: 'ROE = rentabilidad sobre el patrimonio. Cuánto genera la empresa por cada $1 de los accionistas. >15% suele ser bueno.',
  growth: 'Crecimiento de los ingresos (ventas) respecto al año anterior.',
  div: 'Rendimiento por dividendos: el dividendo anual como % del precio. Promedio del S&P 500: ~1,5-2%.',
  prev: 'Precio al que cerró la acción el día hábil anterior.',
};

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

/** Short date label for a 'YYYY-MM-DD' string, parsed as local (no TZ shift). */
function fmtDate(s: string): string {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return s;
  return new Date(y, m - 1, d).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function PriceChart({ ticker }: { ticker: string }) {
  const [data, setData] = useState<PricePoint[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [days, setDays] = useState(90);
  // Drag-to-measure range: two anchors (dates) the user marks on the chart to
  // read the % change between them, Apple Stocks-style.
  const [sel, setSel] = useState<{ start: string; end: string } | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setSel(null);
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

  // Resolve the active selection (ordered, both anchors present in the view).
  let selInfo: { from: string; to: string; startClose: number; endClose: number; pct: number } | null = null;
  if (sel && sel.start !== sel.end) {
    let i = view.findIndex((p) => p.date === sel.start);
    let j = view.findIndex((p) => p.date === sel.end);
    if (i >= 0 && j >= 0) {
      if (i > j) [i, j] = [j, i];
      const startClose = view[i].close;
      const endClose = view[j].close;
      selInfo = { from: view[i].date, to: view[j].date, startClose, endClose, pct: (endClose / startClose - 1) * 100 };
    }
  }

  // Header %: the marked range if any, otherwise the whole visible period.
  const headPct = selInfo ? selInfo.pct : (last / first - 1) * 100;
  const headUp = headPct >= 0;
  const color = last >= first ? '#22c55e' : '#ef4444';

  const onDown = (e: any) => {
    if (!e?.activeLabel) return;
    dragging.current = true;
    setSel({ start: e.activeLabel, end: e.activeLabel });
  };
  const onMove = (e: any) => {
    if (!dragging.current || !e?.activeLabel) return;
    setSel((s) => (s ? { ...s, end: e.activeLabel } : s));
  };
  const onUp = () => {
    dragging.current = false;
    // A plain tap (no drag) leaves start === end: treat it as "clear".
    setSel((s) => (s && s.start === s.end ? null : s));
  };

  return (
    <div className="empChart">
      <div className="chartHead">
        <span className="cardLabel">
          {selInfo ? (
            <>
              {fmtDate(selInfo.from)} → {fmtDate(selInfo.to)}{' '}
              <span className={headUp ? 'pos' : 'neg'}>
                ({headUp ? '+' : ''}
                {headPct.toFixed(1)}%)
              </span>
            </>
          ) : (
            <>
              Precio{' '}
              <span className={headUp ? 'pos' : 'neg'}>
                ({headUp ? '+' : ''}
                {headPct.toFixed(1)}%)
              </span>
            </>
          )}
        </span>
        <div className="filterRow">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.label}
              className={`chip ${days === tf.days ? 'chipActive' : ''}`}
              onClick={() => {
                setDays(tf.days);
                setSel(null);
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>
      <div className="chartWrap" style={{ touchAction: 'none', userSelect: 'none' }}>
        <ResponsiveContainer width="100%" height={190}>
          <AreaChart
            data={view}
            margin={{ top: 6, right: 6, bottom: 0, left: 0 }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            onTouchStart={onDown}
            onTouchMove={onMove}
            onTouchEnd={onUp}
          >
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
              labelFormatter={(l) => fmtDate(String(l))}
            />
            <Area type="monotone" dataKey="close" stroke={color} fill={`url(#g-${ticker})`} strokeWidth={2} />
            {sel && (
              <>
                <ReferenceArea x1={sel.start} x2={sel.end} fill="#f59e0b" fillOpacity={0.12} stroke="none" />
                <ReferenceLine x={sel.start} stroke="#f59e0b" strokeWidth={1} />
                <ReferenceLine x={sel.end} stroke="#f59e0b" strokeWidth={1} />
              </>
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="hint chartHint">
        {selInfo ? (
          <>
            US$ {n(selInfo.startClose)} → US$ {n(selInfo.endClose)} ·{' '}
            <button className="linkBtn" onClick={() => setSel(null)}>
              limpiar selección
            </button>
          </>
        ) : (
          '👆 Arrastrá sobre el gráfico para medir la variación de un tramo.'
        )}
      </p>
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
            <Row label="Rango 52 sem." value={a.low52 != null && a.high52 != null ? `${usd(a.low52)} – ${usd(a.high52)}` : '—'} info={INFO.range52} />
            <Row label="Desde el máximo" value={pct(a.distFromHighPct)} cls={(a.distFromHighPct ?? 0) < 0 ? 'neg' : 'pos'} info={INFO.fromHigh} />
            <Row label="Variación 1 año" value={pct(a.yearReturnPct)} cls={(a.yearReturnPct ?? 0) >= 0 ? 'pos' : 'neg'} info={INFO.year} />
            <Row label="Cap. de mercado" value={cap(a.marketCap)} info={INFO.cap} />
            <Row label="P/E (PER)" value={n(a.pe, 1)} info={INFO.pe} />
            <Row label="PEG" value={n(a.peg, 2)} info={INFO.peg} />
            <Row label="P/B" value={n(a.pb, 1)} info={INFO.pb} />
            <Row label="P/S" value={n(a.ps, 1)} info={INFO.ps} />
            <Row label="BPA (EPS)" value={usd(a.eps)} info={INFO.eps} />
            <Row label="Beta" value={n(a.beta, 2)} info={INFO.beta} />
            <Row label="Margen neto" value={pct(a.netMargin)} info={INFO.margin} />
            <Row label="ROE" value={pct(a.roe)} info={INFO.roe} />
            <Row label="Crec. ingresos" value={pct(a.revGrowth)} info={INFO.growth} />
            <Row label="Div. yield" value={pct(a.divYield)} info={INFO.div} />
            <Row label="Cierre ant." value={usd(a.prevClose)} info={INFO.prev} />
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
