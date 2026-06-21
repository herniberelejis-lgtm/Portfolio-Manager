import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  buildView,
  heldTickers,
  parseCsv,
  parseXlsx,
  syncPrices,
  type ParsedTransaction,
} from './portfolio';
import { supabase, supabaseConfigured } from './supabaseClient';
import {
  deleteAllData,
  fetchPrices,
  fetchTransactions,
  insertTransactions,
  upsertPrices,
} from './remoteStorage';
import { noLivePriceTickers } from './analytics';
import { Auth } from './Auth';
import { Charts } from './Charts';
import { Movimientos } from './Movimientos';
import { Analisis } from './Analisis';
import { Empresas } from './Empresas';
import { CompanyDetail } from './CompanyDetail';
import { Riesgo } from './Riesgo';
import { Tutorial } from './Tutorial';

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
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
  const [prices, setPrices] = useState<Record<string, bigint>>({});
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [tab, setTab] = useState<'resumen' | 'analisis' | 'riesgo' | 'empresas' | 'movimientos'>('resumen');
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [pricesUpdatedAt, setPricesUpdatedAt] = useState<Date | null>(null);

  // Track the auth session.
  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => {})
      .finally(() => setAuthReady(true));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load this user's data whenever they log in.
  useEffect(() => {
    if (!session) {
      setTransactions([]);
      setPrices({});
      setPriceInputs({});
      return;
    }
    let cancelled = false;
    setLoadingData(true);
    Promise.all([fetchTransactions(), fetchPrices()])
      .then(([txs, pr]) => {
        if (cancelled) return;
        setTransactions(txs);
        setPrices(pr);
      })
      .catch((e) => !cancelled && setMessage(`Error al cargar tus datos: ${(e as Error).message}`))
      .finally(() => !cancelled && setLoadingData(false));
    return () => {
      cancelled = true;
    };
  }, [session]);

  const view = useMemo(() => buildView(transactions, prices), [transactions, prices]);
  const noLivePrice = useMemo(() => noLivePriceTickers(transactions), [transactions]);

  // Show the tutorial automatically the first time a new user lands with no data.
  useEffect(() => {
    if (!session || loadingData) return;
    if (transactions.length === 0 && !localStorage.getItem('pm_tut_seen')) {
      setShowTutorial(true);
      try {
        localStorage.setItem('pm_tut_seen', '1');
      } catch {
        /* ignore */
      }
    }
  }, [session, loadingData, transactions.length]);

  // Seed the current price for any held ticker without one yet (default to its
  // average cost = break-even). Seeded defaults stay in memory only.
  useEffect(() => {
    const missing = view.positions.filter((p) => prices[p.ticker] === undefined);
    if (missing.length === 0) return;
    const nextPrices = { ...prices };
    const nextInputs = { ...priceInputs };
    for (const p of missing) {
      nextPrices[p.ticker] = p.avgCostCents;
      if (nextInputs[p.ticker] === undefined) {
        nextInputs[p.ticker] = centsToPesos(p.avgCostCents).toString();
      }
    }
    setPrices(nextPrices);
    setPriceInputs(nextInputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.positions, prices]);

  // Auto-update current prices from data912 whenever the holdings load or
  // change. Best-effort: if the browser blocks the request (CORS) we silently
  // keep the seeded average-cost prices and the user can still edit by hand.
  useEffect(() => {
    if (!session || transactions.length === 0) return;
    const tickers = heldTickers(transactions).filter((t) => !noLivePrice.has(t));
    if (tickers.length === 0) return;
    let cancelled = false;
    syncPrices(tickers)
      .then((fetched) => {
        if (cancelled || Object.keys(fetched).length === 0) return;
        setPrices((prev) => ({ ...prev, ...fetched }));
        setPriceInputs((prev) => {
          const n = { ...prev };
          for (const [t, c] of Object.entries(fetched)) n[t] = centsToPesos(c).toString();
          return n;
        });
        setPricesUpdatedAt(new Date());
        upsertPrices(fetched).catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, transactions]);

  async function addTransactions(incoming: ParsedTransaction[]): Promise<number> {
    const added = await insertTransactions(incoming, transactions);
    if (added > 0) {
      const refreshed = await fetchTransactions();
      setTransactions(refreshed);
    }
    return added;
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setErrors([]);
    const allErrors: { row: number; message: string }[] = [];
    let totalAdded = 0;
    try {
      for (const file of Array.from(files)) {
        const isXlsx = /\.xlsx$/i.test(file.name);
        const result = isXlsx
          ? await parseXlsx(await file.arrayBuffer())
          : parseCsv(await file.text());
        allErrors.push(...result.errors);
        totalAdded += await addTransactions(result.transactions);
      }
      setErrors(allErrors);
      setMessage(`Importadas ${totalAdded} transacciones nuevas (las duplicadas se omiten).`);
    } catch (e) {
      setMessage(`Error al importar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function updatePrice(ticker: string, raw: string) {
    setPriceInputs((prev) => ({ ...prev, [ticker]: raw }));
    const cents = pesosToCents(raw);
    if (cents === null) return;
    const next = { ...prices, [ticker]: cents };
    setPrices(next);
    try {
      await upsertPrices({ [ticker]: cents });
    } catch (e) {
      setMessage(`No se pudo guardar el precio: ${(e as Error).message}`);
    }
  }

  async function handleSyncPrices() {
    setBusy(true);
    setMessage('');
    try {
      const tickers = view.positions.map((p) => p.ticker).filter((t) => !noLivePrice.has(t));
      const fetched = await syncPrices(tickers);
      if (Object.keys(fetched).length === 0) {
        setMessage('No se encontraron cotizaciones para tus tickers en data912.');
      } else {
        const next = { ...prices, ...fetched };
        setPrices(next);
        setPriceInputs((prev) => {
          const n = { ...prev };
          for (const [t, c] of Object.entries(fetched)) n[t] = centsToPesos(c).toString();
          return n;
        });
        await upsertPrices(fetched);
        setPricesUpdatedAt(new Date());
        setMessage(`Precios actualizados para ${Object.keys(fetched).length} activo(s).`);
      }
    } catch (e) {
      setMessage(
        'No se pudieron traer precios (posible bloqueo CORS del navegador). ' +
          'Podés cargarlos a mano. Detalle: ' +
          (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadSample() {
    setBusy(true);
    try {
      const added = await addTransactions(sampleTransactions());
      setMessage(`Cargado portafolio de ejemplo (${added} transacciones).`);
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    if (!confirm('¿Borrar todos tus datos de la cuenta? Esto no se puede deshacer.')) return;
    setBusy(true);
    try {
      await deleteAllData();
      setTransactions([]);
      setPrices({});
      setPriceInputs({});
      setErrors([]);
      setMessage('Datos borrados.');
    } catch (e) {
      setMessage(`Error al borrar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await supabase!.auth.signOut();
  }

  if (!supabaseConfigured) {
    return (
      <div className="authWrap">
        <div className="authCard">
          <h1>📊 Portfolio Manager</h1>
          <p className="message">
            Falta configurar la conexión con Supabase (URL y anon key) para habilitar las
            cuentas. Avisá para terminar de cablearlo.
          </p>
        </div>
      </div>
    );
  }

  if (!authReady) {
    return <div className="loading">Cargando…</div>;
  }

  if (!session) {
    return <Auth />;
  }

  const hasData = transactions.length > 0;

  return (
    <div className="app">
      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}
      <header className="header">
        <div className="headerTop">
          <h1>📊 Portfolio Manager</h1>
          <div className="userBox">
            <button className="helpBtn" onClick={() => setShowTutorial(true)}>
              ❓ Cómo funciona
            </button>
            <span className="userEmail">{session.user.email}</span>
            <button className="ghostBtn" onClick={handleLogout}>
              Salir
            </button>
          </div>
        </div>
        <p className="subtitle">
          Tu cartera, sincronizada en tu cuenta. Solo vos podés ver estos datos.
        </p>
      </header>

      <section className="section import">
        <h2 className="sectionTitle">Importar movimientos</h2>
        <p className="hint">
          Subí el CSV de <strong>movimientos</strong> de Cocos Capital o Bull Market (o el XLSX de
          PPI) para el análisis completo. ¿Solo querés seguir tu cartera actual? Subí tu
          <strong> reporte de tenencias</strong> (posiciones de hoy). Podés subir varios archivos.
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

      {loadingData && <div className="loading">Cargando tus datos…</div>}

      {hasData && (
        <>
          <div className="tabs">
            <button
              className={`tab ${tab === 'resumen' ? 'tabActive' : ''}`}
              onClick={() => setTab('resumen')}
            >
              Resumen
            </button>
            <button
              className={`tab ${tab === 'analisis' ? 'tabActive' : ''}`}
              onClick={() => setTab('analisis')}
            >
              Análisis
            </button>
            <button
              className={`tab ${tab === 'riesgo' ? 'tabActive' : ''}`}
              onClick={() => setTab('riesgo')}
            >
              Riesgo
            </button>
            <button
              className={`tab ${tab === 'empresas' ? 'tabActive' : ''}`}
              onClick={() => setTab('empresas')}
            >
              Empresas
            </button>
            <button
              className={`tab ${tab === 'movimientos' ? 'tabActive' : ''}`}
              onClick={() => setTab('movimientos')}
            >
              Movimientos
            </button>
          </div>

          {tab === 'movimientos' ? (
            <Movimientos transactions={transactions} />
          ) : tab === 'analisis' ? (
            <Analisis transactions={transactions} prices={prices} />
          ) : tab === 'empresas' ? (
            <Empresas tickers={view.positions.map((p) => p.ticker).filter((t) => !noLivePrice.has(t))} />
          ) : tab === 'riesgo' ? (
            <Riesgo
              holdings={view.positions
                .filter((p) => !noLivePrice.has(p.ticker))
                .map((p) => ({ ticker: p.ticker, marketValueCents: p.marketValueCents }))}
            />
          ) : (
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
              <div className="priceSync">
                {pricesUpdatedAt && (
                  <span className="hint">
                    Precios al {pricesUpdatedAt.toLocaleTimeString('es-AR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
                <button className="ghostBtn" onClick={handleSyncPrices} disabled={busy}>
                  Actualizar precios
                </button>
              </div>
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
                  {view.positions.map((p) => {
                    const canExpand = !noLivePrice.has(p.ticker);
                    const isOpen = expandedTicker === p.ticker;
                    return (
                      <Fragment key={p.ticker}>
                        <tr
                          className={canExpand ? 'rowClickable' : ''}
                          onClick={canExpand ? () => setExpandedTicker(isOpen ? null : p.ticker) : undefined}
                        >
                          <td className="ticker">
                            {canExpand && <span className="chevron">{isOpen ? '▾' : '▸'}</span>}
                            {p.ticker}
                          </td>
                          <td>{p.quantity}</td>
                          <td>{formatMoney(p.avgCostCents, p.currency)}</td>
                          <td>
                            <input
                              className="priceInput"
                              inputMode="decimal"
                              value={priceInputs[p.ticker] ?? ''}
                              onClick={(e) => e.stopPropagation()}
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
                        {isOpen && (
                          <tr className="detailRow">
                            <td colSpan={8}>
                              <CompanyDetail ticker={p.ticker} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint">
              👆 Tocá una fila para ver el <strong>gráfico de precio</strong> y los datos
              financieros de la empresa. El precio actual arranca en el costo promedio; editalo o
              usá “Actualizar precios”.
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
        </>
      )}

      <footer className="footer">Datos sincronizados en tu cuenta · privados.</footer>
    </div>
  );
}
