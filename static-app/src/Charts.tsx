// Adapted from the main app's PortfolioCharts component (same Recharts setup),
// with self-contained class names instead of the Next.js CSS module.
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

interface Props {
  positions: ChartPosition[];
  history: ChartHistoryPoint[];
}

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#84cc16'];

function formatMoney(value: number): string {
  return `$ ${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function Charts({ positions, history }: Props) {
  if (positions.length === 0) return null;

  const holdingsData = positions.map((p) => ({ name: p.ticker, value: p.marketValue, pct: p.pctOfPortfolio }));
  const historyData = history.map((h) => ({
    date: new Date(h.date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }),
    investedCost: h.investedCost,
    cumulativeRealizedPnl: h.cumulativeRealizedPnl,
  }));

  return (
    <section className="section">
      <h2 className="sectionTitle">Gráficos</h2>
      <div className="chartsGrid">
        <div className="chartCard">
          <h3 className="chartTitle">Tenencia actual (mayor a menor)</h3>
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
                  const entry = props.payload as { name: string; pct: number };
                  return `${entry.name} ${entry.pct.toFixed(1)}%`;
                }}
              >
                {holdingsData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chartCard">
          <h3 className="chartTitle">P&amp;L no realizado por activo</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={positions}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="ticker" />
              <YAxis />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Bar dataKey="unrealizedPnl" name="No realizado">
                {positions.map((p, index) => (
                  <Cell key={`u-${index}`} fill={p.unrealizedPnl >= 0 ? '#22c55e' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chartCard">
          <h3 className="chartTitle">Rendimiento en ventas (P&amp;L realizado)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={positions}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="ticker" />
              <YAxis />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Bar dataKey="realizedPnl" name="Realizado">
                {positions.map((p, index) => (
                  <Cell key={`r-${index}`} fill={p.realizedPnl >= 0 ? '#22c55e' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chartCard">
          <h3 className="chartTitle">Evolución del portafolio</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={historyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Area type="monotone" dataKey="investedCost" name="Costo invertido" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
              <Area type="monotone" dataKey="cumulativeRealizedPnl" name="P&L realizado acum." stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
