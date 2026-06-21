import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
} from 'recharts';
import { fetchPriceHistory } from './twelvedata';
import { annualizedVolPct, toReturns } from './risk';

export interface ChartPosition {
  ticker: string;
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  pctOfPortfolio: number;
}

export interface ChartHistoryPoint {
  date: string;
  investedCost: number;
  cumulativeRealizedPnl: number;
}

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#84cc16'];

function money(value: number): string {
  return `$ ${value.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
}
function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
const tooltipStyle = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8 };

/** Top of the Resumen tab: composition pie + portfolio evolution. */
export function ChartsTop({ positions, history }: { positions: ChartPosition[]; history: ChartHistoryPoint[] }) {
  if (positions.length === 0) return null;
  const holdingsData = positions.map((p) => ({ name: p.ticker, value: p.marketValue, pct: p.pctOfPortfolio }));
  const historyData = history.map((h) => ({ date: fmtDate(h.date), investedCost: h.investedCost }));

  return (
    <section className="section">
      <h2 className="sectionTitle">Tu cartera</h2>
      <div className="chartsGrid">
        <div className="chartCard">
          <h3 className="chartTitle">Composición (mayor a menor)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={holdingsData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={(props) => {
                  const e = props.payload as { name: string; pct: number };
                  return `${e.name} ${e.pct.toFixed(1)}%`;
                }}
              >
                {holdingsData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(Number(v))} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chartCard">
          <h3 className="chartTitle">Evolución del portafolio (costo invertido)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={historyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(Number(v))} />
              <Area type="monotone" dataKey="investedCost" name="Costo invertido" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

/** Bottom of the Resumen tab: P&L over time + asset distribution + risk per asset. */
export function ChartsBottom({
  positions,
  history,
  riskTickers,
}: {
  positions: ChartPosition[];
  history: ChartHistoryPoint[];
  riskTickers: string[];
}) {
  const [risk, setRisk] = useState<{ ticker: string; vol: number }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: { ticker: string; vol: number }[] = [];
      for (const t of riskTickers) {
        try {
          const h = await fetchPriceHistory(t);
          if (h.length >= 30) out.push({ ticker: t, vol: annualizedVolPct(toReturns(h.map((p) => p.close))) });
        } catch {
          /* skip */
        }
      }
      if (!cancelled) setRisk(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [riskTickers.join(',')]);

  if (positions.length === 0) return null;
  const pnlData = history.map((h) => ({ date: fmtDate(h.date), pnl: h.cumulativeRealizedPnl }));
  const distData = positions
    .slice()
    .sort((a, b) => b.marketValue - a.marketValue)
    .map((p) => ({ ticker: p.ticker, value: p.marketValue }));

  return (
    <section className="section">
      <h2 className="sectionTitle">Análisis gráfico</h2>
      <div className="chartsGrid">
        <div className="chartCard">
          <h3 className="chartTitle">P&amp;L realizado en el tiempo</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={pnlData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(Number(v))} />
              <Area type="monotone" dataKey="pnl" name="P&L realizado acum." stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chartCard">
          <h3 className="chartTitle">Distribución por activo</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={distData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="ticker" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(Number(v))} />
              <Bar dataKey="value" name="Valor de mercado">
                {distData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chartCard">
          <h3 className="chartTitle">Riesgo por activo (volatilidad anual)</h3>
          {risk == null ? (
            <p className="hint">Calculando volatilidad…</p>
          ) : risk.length === 0 ? (
            <p className="hint">Sin datos de mercado para calcular el riesgo.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={risk.slice().sort((a, b) => b.vol - a.vol)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="ticker" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} unit="%" />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(1)}%`} />
                <Bar dataKey="vol" name="Volatilidad anual">
                  {risk.map((r, i) => (
                    <Cell key={i} fill={r.vol > 50 ? '#ef4444' : r.vol > 30 ? '#f59e0b' : '#22c55e'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  );
}
