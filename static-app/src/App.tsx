import { useEffect, useMemo, useState } from 'react';
import {
  buildView,
  parseCsv,
  parseXlsx,
  syncPrices,
  txKey,
  type ParsedTransaction,
} from './portfolio';
import {
  clearAll,
  loadPrices,
  loadTransactions,
  savePrices,
  saveTransactions,
} from './storage';
import { Charts } from './Charts';

function centsToPesos(cents: bigint): number {
  return Number(cents) / 100;
}

function formatMoney(cents: bigint, currency = 'ARS'): string {
  const sym = currency === 'USD' ? 'US$' : '$';
  return `${sym} ${centsToPesos(cents).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pesosToCents(value: string): bigint | null {
  const n = Number(value.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n * 100));
}

function sampleTransactions(): ParsedTransaction[] {
  const mk = (
    date: string,
    type: ParsedTransaction['type'],
    ticker: string | null,
    quantity: number | null,
    price: number | null,
    amount: number,
  ): ParsedTransaction => ({
    date: new Date(date),
    type,
    ticker,
    quantity,
    price,
    currency: 'ARS',
    amountCents: BigInt(Math.round(amount * 100)),
    rawRow: {},
  });
  return [
    mk('2025-01-10', 'buy', 'GGAL', 100, 3500, 350000),
    mk('2025-02-05', 'buy', 'YPFD', 20, 28000, 560000),
    mk('2025-03-12', 'buy', 'GGAL', 50, 4200, 210000),
    mk('2025-04-01', 'buy', 'AL30', 1000, 70, 70000),
    mk('2025-05-20', 'sell', 'GGAL', 60, 5200, 312000),
    mk('2025-06-02', 'buy', 'YPFD', 10, 41000, 410000),
  ];
}

export function App() {
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
  const [prices, setPrices] = useState<Record<string, bigint>>({});
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);
  const [message, setMessage] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTransactions(loadTransactions());
    setPrices(loadPrices());
  }, []);

  const view = useMemo(() => buildView(transactions, prices), [transactions, prices]);

  // Seed price inputs for any newly-held ticker (default to avg cost so the
  // portfolio starts at break-even until the user enters real prices).
  useEffect(() => {
    setPriceInputs((prev) => {
      const next = { ...prev };
      for (const p of view.positions) {
        if (next[p.ticker] === undefined) {
          const seed = prices[p.ticker] ?? p.avgCostCents;
          next[p.ticker] = centsToPesos(seed).toString();
        }
      }
      return next;
    });
  }, [view.positions, prices]);

  function persist(txs: ParsedTransaction[]) {
    setTransactions(txs);
    saveTransactions(txs);
  }

  function mergeNew(incoming: ParsedTransaction[]) {
    const existing = new Set(transactions.map(txKey));
    const deduped = incoming.filter((t) => !existing.has(txKey(t)));
    persist([...transactions, ...deduped]);
    return { added: deduped.length, skipped: incoming.length - deduped.length };
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setErrors([]);
    const allErrors: { row: number; message: string }[] = [];
    let totalAdded = 0;
    let totalSkipped = 0;
    try {
      for (const file of Array.from(files)) {
        const isXlsx = /\.xlsx$/i.test(file.name);
        const result = isXlsx
          ? await parseXlsx(await file.arrayBuffer())
          : parseCsv(await file.text());
        allErrors.push(...result.errors);
        const { added, skipped } = mergeNew(result.transactions);
        totalAdded += added;
        totalSkipped += skipped;
      }
      setErrors(allErrors);
      setMessage(
        `Importadas ${totalAdded} transacciones nuevas` +
          (totalSkipped ? `, ${totalSkipped} duplicadas omitidas.` : '.'),
      );
    } catch (e) {
      setMessage(`Error al importar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function updatePrice(ticker: string, raw: string) {
    setPriceInputs((prev) => ({ ...prev, [ticker]: raw }));
    const cents = pesosToCents(raw);
    if (cents === null) return;
    const next = { ...prices, [ticker]: cents };
    setPrices(next);
    savePrices(next);
  }

  async function handleSyncPrices() {
    setBusy(true);
    setMessage('');
    try {
      const tickers = view.positions.map((p) => p.ticker);
      const fetched = await syncPrices(tickers);
      if (Object.keys(fetched).length === 0) {
        setMessage('No se encontraron cotizaciones para tus tickers en data912.');
      } else {
        const next = { ...prices, ...fetched };
        setPrices(next);
        savePrices(next);
        setPriceInputs((prev) => {
          const n = { ...prev };
          for (const [t, c] of Object.entries(fetched)) n[t] = centsToPesos(c).toString();
          return n;
        });
        setMessage(`Precios actualizados para ${Object.keys(fetched).length} activo(s).`);
      }
    } catch (e) {
      setMessage(
        'No se pudieron traer precios (probablemente bloqueo CORS del navegador). ' +
          'Podés cargar los precios actuales a mano. Detalle: ' +
          (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  function loadSample() {
    const { added } = mergeNew(sampleTransactions());
    setMessage(`Cargado portafolio de ejemplo (${added} transacciones).`);
  }

  function handleClear() {
    if (!confirm('¿Borrar todos los datos guardados en este navegador?')) return;
    clearAll();
    setTransactions([]);
    setPrices({});
    setPriceInputs({});
    setErrors([]);
    setMessage('Datos borrados.');
  }

  const hasData = transactions.length > 0;

  return (
    <div className="app">
      <header className="header">
        <h1>📊 Portfolio Manager</h1>
        <p className="subtitle">
          Seguimiento de cartera para brokers argentinos. Corre 100% en tu navegador —
          tus datos no salen de tu equipo (se guardan en este navegador).
        </p>
      </header>

      <section className="section import">
        <h2 className="sectionTitle">Importar movimientos</h2>
        <p className="hint">
          Subí el CSV de <strong>Cocos Capital</strong> o <strong>Bull Market</strong>, o el
          XLSX de <strong>PPI</strong>. Podés subir varios archivos.
        </p>
        <div className="importRow">
          <label className="fileBtn">
            {busy ? 'Procesando…' : 'Elegir archivo(s)'}
            <input
              type="file"
              accept=".csv,.xlsx"
              multiple
              disabled={busy}
              onChange={(e) => handleFiles(e.target.files)}
              style={{ display: 'none' }}
            />
          </label>
          <button className="ghostBtn" onClick={loadSample} disabled={busy}>
            Cargar ejemplo
          </button>
          {hasData && (
            <button className="ghostBtn danger" onClick={handleClear} disabled={busy}>
              Borrar todo
            </button>
          )}
        </div>
        {message && <p className="message">{message}</p>}
        {errors.length > 0 && (
          <details className="errors">
            <summary>{errors.length} fila(s) con problemas (se omitieron)</summary>
            <ul>
              {errors.slice(0, 50).map((e, i) => (
                <li key={i}>
                  Fila {e.row}: {e.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {hasData && (
        <>
          <section className="section">
            <div className="cards">
              <div className="card">
                <span className="cardLabel">Valor de mercado</span>
                <span className="cardValue">{formatMoney(view.totals.marketValueCents)}</span>
              </div>
              <div className={`card ${view.totals.unrealizedPnlCents >= 0n ? 'pos' : 'neg'}`}>
                <span className="cardLabel">P&amp;L no realizado</span>
                <span className="cardValue">{formatMoney(view.totals.unrealizedPnlCents)}</span>
              </div>
              <div className={`card ${view.totals.realizedPnlCents >= 0n ? 'pos' : 'neg'}`}>
                <span className="cardLabel">P&amp;L realizado</span>
                <span className="cardValue">{formatMoney(view.totals.realizedPnlCents)}</span>
              </div>
              <div className="card">
                <span className="cardLabel">Transacciones</span>
                <span className="cardValue">{transactions.length}</span>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="tableHeader">
              <h2 className="sectionTitle">Tenencias</h2>
              <button className="ghostBtn" onClick={handleSyncPrices} disabled={busy}>
                Sincronizar precios (data912)
              </button>
            </div>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Cant.</th>
                    <th>Costo prom.</th>
                    <th>Precio actual</th>
                    <th>Valor mercado</th>
                    <th>P&amp;L no realiz.</th>
                    <th>P&amp;L realiz.</th>
                    <th>% cartera</th>
                  </tr>
                </thead>
                <tbody>
                  {view.positions.map((p) => (
                    <tr key={p.ticker}>
                      <td className="ticker">{p.ticker}</td>
                      <td>{p.quantity}</td>
                      <td>{formatMoney(p.avgCostCents, p.currency)}</td>
                      <td>
                        <input
                          className="priceInput"
                          inputMode="decimal"
                          value={priceInputs[p.ticker] ?? ''}
                          onChange={(e) => updatePrice(p.ticker, e.target.value)}
                        />
                      </td>
                      <td>{formatMoney(p.marketValueCents, p.currency)}</td>
                      <td className={p.unrealizedPnlCents >= 0n ? 'pos' : 'neg'}>
                        {formatMoney(p.unrealizedPnlCents, p.currency)}
                      </td>
                      <td className={p.realizedPnlCents >= 0n ? 'pos' : 'neg'}>
                        {formatMoney(p.realizedPnlCents, p.currency)}
                      </td>
                      <td>{p.pctOfPortfolio.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              El precio actual arranca en el costo promedio. Editalo o usá “Sincronizar
              precios” para ver el P&amp;L no realizado real.
            </p>
          </section>

          <Charts
            positions={view.positions.map((p) => ({
              ticker: p.ticker,
              marketValue: centsToPesos(p.marketValueCents),
              unrealizedPnl: centsToPesos(p.unrealizedPnlCents),
              realizedPnl: centsToPesos(p.realizedPnlCents),
              pctOfPortfolio: p.pctOfPortfolio,
            }))}
            history={view.history.map((h) => ({
              date: h.date.toISOString(),
              investedCost: centsToPesos(h.investedCostCents),
              cumulativeRealizedPnl: centsToPesos(h.cumulativeRealizedPnlCents),
            }))}
          />
        </>
      )}

      <footer className="footer">
        Sin servidor · sin base de datos · tus datos quedan en este navegador.
      </footer>
    </div>
  );
}
