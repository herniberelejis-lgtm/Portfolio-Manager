import { useMemo, useState } from 'react';
import { opLabel, type ParsedTransaction } from './portfolio';

function centsToPesos(cents: bigint): number {
  return Number(cents) / 100;
}

function formatMoney(cents: bigint, currency: string): string {
  const sym = currency === 'USD' ? 'US$' : '$';
  return `${sym} ${centsToPesos(cents).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Direction for display: money in (+) vs money out (-).
function isInflow(type: ParsedTransaction['type']): boolean {
  return type === 'sell' || type === 'deposit' || type === 'dividend';
}

type Filter = 'all' | 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'dividend';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'buy', label: 'Compras' },
  { key: 'sell', label: 'Ventas' },
  { key: 'deposit', label: 'Ingresos' },
  { key: 'withdrawal', label: 'Egresos' },
  { key: 'dividend', label: 'Dividendos' },
];

export function Movimientos({ transactions }: { transactions: ParsedTransaction[] }) {
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    const sorted = [...transactions].sort((a, b) => b.date.getTime() - a.date.getTime());
    return filter === 'all' ? sorted : sorted.filter((t) => t.type === filter);
  }, [transactions, filter]);

  return (
    <section className="section">
      <div className="tableHeader">
        <h2 className="sectionTitle">Movimientos ({rows.length})</h2>
        <div className="filterRow">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip ${filter === f.key ? 'chipActive' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Operación</th>
              <th>Ticker</th>
              <th>Cant.</th>
              <th>Precio</th>
              <th>Monto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={i}>
                <td>{t.date.toLocaleDateString('es-AR')}</td>
                <td className="opCell">{opLabel(t)}</td>
                <td className="ticker">{t.ticker ?? '—'}</td>
                <td>{t.quantity ?? '—'}</td>
                <td>
                  {t.price != null
                    ? t.price.toLocaleString('es-AR', { maximumFractionDigits: 4 })
                    : '—'}
                </td>
                <td className={isInflow(t.type) ? 'pos' : 'neg'}>
                  {isInflow(t.type) ? '+' : '−'} {formatMoney(t.amountCents, t.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="hint">No hay movimientos de este tipo.</p>}
    </section>
  );
}
