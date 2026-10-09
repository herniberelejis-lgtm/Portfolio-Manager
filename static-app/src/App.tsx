import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  buildView,
  computeCashByCurrency,
  heldTickers,
  parseCsvOrGrid,
  parseXlsxOrGrid,
  syncBondPrices,
  syncPrices,
  fetchMep,
  type GridData,
  type ParsedTransaction,
} from './portfolio';
import { ColumnMapper } from './ColumnMapper';
import type { ParseResult } from '../../src/lib/csv/types';
import { supabase, supabaseConfigured } from './supabaseClient';
import {
  deleteAllData,
  fetchPrices,
  fetchTransactions,
  insertTransactions,
  upsertPrices,
} from './remoteStorage';
import { bondTickers, noLivePriceTickers } from './analytics';
import { fetchCCL, latestValue } from './benchmarks';
import { Auth } from './Auth';
import { ChartsTop, ChartsBottom } from './Charts';
import { Movimientos } from './Movimientos';
import { Analisis } from './Analisis';
import { CompanyDetail } from './CompanyDetail';
import { Riesgo } from './Riesgo';
import { Tutorial } from './Tutorial';
import { Asistente } from './Asistente';
import { Cripto } from './Cripto';

const FX_KEY = 'pm_fx_ars_usd';
const FX_MANUAL_KEY = 'pm_fx_manual';

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
  const [mapper, setMapper] = useState<{ grid: GridData; fileName: string } | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [tab, setTab] = useState<'resumen' | 'analisis' | 'riesgo' | 'movimientos' | 'cripto' | 'asistente'>('resumen');
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [pricesUpdatedAt, setPricesUpdatedAt] = useState<Date | null>(null);
  // Pesos per dollar used to put ARS and USD holdings on one scale (totals,
  // % of portfolio, charts). Starts from the last known value, refreshes from
  // the live CCL, and the user can override it (e.g. with their MEP).
  const [fx, setFx] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(FX_KEY));
      return v > 0 ? v : null;
    } catch {
      return null;
    }
  });
  const [fxManual, setFxManual] = useState<boolean>(() => {
    try {
      return localStorage.getItem(FX_MANUAL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [fxInput, setFxInput] = useState<string>('');
  const [fxSource, setFxSource] = useState<'MEP' | 'CCL' | null>(null);
  // Live bond/ON quotes per 100 VN, fetched each session (never persisted).
  const [bondPx, setBondPx] = useState<Record<string, bigint>>({});

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

  const noLivePrice = useMemo(() => noLivePriceTickers(transactions), [transactions]);
  const bonds = useMemo(() => bondTickers(transactions), [transactions]);
  const view = useMemo(
    () => buildView(transactions, prices, noLivePrice, fx ?? undefined, bondPx),
    [transactions, prices, noLivePrice, fx, bondPx],
  );
  // Converts an amount in its own currency to pesos (for cross-currency sums).
  const toArs = (cents: bigint, currency: string): bigint =>
    currency === 'USD' && fx ? BigInt(Math.round(Number(cents) * fx)) : cents;

  // Live dollar rate, unless the user pinned their own. Brokers (BYMALAB
  // included) value dollar holdings at the MEP implied by AL30/AL30D, so we
  // use that; the CCL is only a fallback if the bond feed is unreachable.
  useEffect(() => {
    if (fxManual) return;
    let cancelled = false;
    const apply = (v: number, src: 'MEP' | 'CCL') => {
      if (cancelled) return;
      setFx(v);
      setFxSource(src);
      try {
        localStorage.setItem(FX_KEY, String(v));
      } catch {
        /* ignore */
      }
    };
    fetchMep()
      .catch(() => null)
      .then(async (mep) => {
        if (mep) return apply(mep, 'MEP');
        const ccl = latestValue(await fetchCCL());
        if (ccl) apply(ccl, 'CCL');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fxManual]);

  // Live bond prices (per 100 VN) for held bonds/ONs.
  const heldBonds = useMemo(
    () => heldTickers(transactions).filter((t) => bonds.has(t)),
    [transactions, bonds],
  );
  useEffect(() => {
    if (!session || heldBonds.length === 0) return;
    let cancelled = false;
    syncBondPrices(heldBonds)
      .then((px) => !cancelled && setBondPx(px))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, heldBonds]);

  useEffect(() => {
    if (fx) setFxInput(fx.toLocaleString('es-AR', { maximumFractionDigits: 2 }));
  }, [fx]);

  function commitFx(raw: string) {
    const v = Number(raw.replace(/\./g, '').replace(',', '.'));
    if (!(v > 0)) {
      // Empty/invalid: drop the manual override and go back to the live CCL.
      setFxManual(false);
      try {
        localStorage.removeItem(FX_MANUAL_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    setFx(v);
    setFxManual(true);
    try {
      localStorage.setItem(FX_KEY, String(v));
      localStorage.setItem(FX_MANUAL_KEY, '1');
    } catch {
      /* ignore */
    }
  }
  const cash = useMemo(() => computeCashByCurrency(transactions), [transactions]);

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
    let unmapped: { grid: GridData; fileName: string } | null = null;
    try {
      for (const file of Array.from(files)) {
        const isXlsx = /\.xlsx$/i.test(file.name);
        const outcome = isXlsx
          ? await parseXlsxOrGrid(await file.arrayBuffer())
          : parseCsvOrGrid(await file.text());
        if (outcome.kind === 'needsMapping') {
          // Stop at the first unrecognized file and let the user map its
          // columns; any recognized files in the batch are already imported.
          unmapped = { grid: outcome.grid, fileName: file.name };
          break;
        }
        allErrors.push(...outcome.result.errors);
        totalAdded += await addTransactions(outcome.result.transactions);
      }
      setErrors(allErrors);
      if (unmapped) {
        if (totalAdded > 0) setMessage(`Importadas ${totalAdded} transacciones. Asociá las columnas del archivo no reconocido.`);
        setMapper(unmapped);
      } else {
        setMessage(`Importadas ${totalAdded} transacciones nuevas (las duplicadas se omiten).`);
      }
    } catch (e) {
      setMessage(`Error al importar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleMappedImport(result: ParseResult) {
    setMapper(null);
    setBusy(true);
    try {
      setErrors(result.errors);
      const added = await addTransactions(result.transactions);
      setMessage(`Importadas ${added} transacciones nuevas (las duplicadas se omiten).`);
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
      const [fetched, bpx] = await Promise.all([
        syncPrices(tickers),
        syncBondPrices(heldBonds).catch(() => ({}) as Record<string, bigint>),
      ]);
      if (Object.keys(bpx).length > 0) setBondPx(bpx);
      if (Object.keys(fetched).length === 0 && Object.keys(bpx).length === 0) {
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
        setMessage(`Precios actualizados para ${Object.keys(fetched).length + Object.keys(bpx).length} activo(s).`);
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
  const cashUsdArs = toArs(cash.USD, 'USD');
  const patrimonioArs = view.totals.marketValueCents + cash.ARS + cashUsdArs;
  // Like the broker, "% de cartera" is over everything you own, cash included.
  const pctOfPatrimonio = (ars: bigint) =>
    patrimonioArs > 0n ? (Number(ars) / Number(patrimonioArs)) * 100 : 0;

  // Bonds are quoted per 100 nominal value (US$ 103,08), not per nominal
  // (US$ 1,03 — which also loses precision). Cost comes from what's left of
  // what was paid; price from the market value (live quote or, without one,
  // the cost itself).
  type Pos = (typeof view.positions)[number];
  const per100 = (cents: bigint, q: number) => BigInt(Math.round((Number(cents) / q) * 100));
  function costLabel(p: Pos): string {
    if (bonds.has(p.ticker) && p.quantity > 0) {
      return `${formatMoney(per100(p.marketValueCents - p.unrealizedPnlCents, p.quantity), p.currency)} c/100`;
    }
    return formatMoney(p.avgCostCents, p.currency);
  }
  function priceLabel(p: Pos): string {
    if (bonds.has(p.ticker) && p.quantity > 0) {
      return `${formatMoney(per100(p.marketValueCents, p.quantity), p.currency)} c/100${p.valuedAtCost ? ' (costo)' : ''}`;
    }
    return formatMoney(p.avgCostCents, p.currency);
  }

  return (
    <div className="app">
      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}
      {mapper && (
        <ColumnMapper
          grid={mapper.grid}
          fileName={mapper.fileName}
          onConfirm={handleMappedImport}
          onCancel={() => setMapper(null)}
        />
      )}
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
          Subí el CSV/XLSX de <strong>movimientos</strong> de tu broker para el análisis completo.
          Reconoce solo a <strong>Cocos Capital, Bull Market y PPI</strong>; para cualquier otro
          (Macro Securities, Balanz, IOL…) te abrimos una pantalla para <strong>asociar las
          columnas</strong> y se importa igual. Podés subir varios archivos.
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
              className={`tab ${tab === 'movimientos' ? 'tabActive' : ''}`}
              onClick={() => setTab('movimientos')}
            >
              Movimientos
            </button>
            <button
              className={`tab ${tab === 'cripto' ? 'tabActive' : ''}`}
              onClick={() => setTab('cripto')}
            >
              Cripto
            </button>
            <button
              className={`tab ${tab === 'asistente' ? 'tabActive' : ''}`}
              onClick={() => setTab('asistente')}
            >
              Asistente IA
            </button>
          </div>

          {tab === 'movimientos' ? (
            <Movimientos transactions={transactions} />
          ) : tab === 'cripto' ? (
            <Cripto />
          ) : tab === 'asistente' ? (
            <Asistente transactions={transactions} prices={prices} fx={fx} bondPx={bondPx} />
          ) : tab === 'analisis' ? (
            <Analisis transactions={transactions} prices={prices} fx={fx} bondPx={bondPx} />
          ) : tab === 'riesgo' ? (
            <Riesgo
              holdings={view.positions
                .filter((p) => !noLivePrice.has(p.ticker))
                .map((p) => ({ ticker: p.ticker, marketValueCents: p.valueArsCents }))}
            />
          ) : (
          <>
          <ChartsTop
            positions={[
              ...view.positions.map((p) => ({
                ticker: p.ticker,
                marketValue: centsToPesos(p.valueArsCents),
                unrealizedPnl: centsToPesos(toArs(p.unrealizedPnlCents, p.currency)),
                realizedPnl: centsToPesos(toArs(p.realizedPnlCents, p.currency)),
                pctOfPortfolio: pctOfPatrimonio(p.valueArsCents),
              })),
              // Cash is part of what you own, as in the broker's composition.
              ...(
                [
                  ['Liquidez USD', cashUsdArs],
                  ['Liquidez ARS', cash.ARS],
                ] as const
              )
                .filter(([, v]) => v > 0n)
                .map(([name, v]) => ({
                  ticker: name,
                  marketValue: centsToPesos(v),
                  unrealizedPnl: 0,
                  realizedPnl: 0,
                  pctOfPortfolio: pctOfPatrimonio(v),
                })),
            ].sort((a, b) => b.marketValue - a.marketValue)}
            history={view.history.map((h) => ({
              date: h.date.toISOString(),
              investedCost: centsToPesos(h.investedCostCents),
              cumulativeRealizedPnl: centsToPesos(h.cumulativeRealizedPnlCents),
            }))}
          />

          <section className="section">
            <div className="cards">
              <div className="card">
                <span className="cardLabel">Patrimonio total</span>
                <span className="cardValue">{formatMoney(patrimonioArs)}</span>
                <span className="cardSub">
                  {fx
                    ? `≈ ${formatMoney(BigInt(Math.round(Number(patrimonioArs) / fx)), 'USD')} · activos + liquidez`
                    : 'activos + liquidez en pesos'}
                </span>
              </div>
              <div className="card">
                <span className="cardLabel">Valor de mercado</span>
                <span className="cardValue">{formatMoney(view.totals.marketValueCents)}</span>
                {fx && (
                  <span className="cardSub">
                    ≈ {formatMoney(BigInt(Math.round(Number(view.totals.marketValueCents) / fx)), 'USD')}
                  </span>
                )}
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
              <div className={`card ${cash.ARS < 0n ? 'neg' : ''}`}>
                <span className="cardLabel">Liquidez ARS</span>
                <span className="cardValue">{formatMoney(cash.ARS, 'ARS')}</span>
                <span className="cardSub">efectivo en pesos sin invertir</span>
              </div>
              <div className={`card ${cash.USD < 0n ? 'neg' : ''}`}>
                <span className="cardLabel">Liquidez USD</span>
                <span className="cardValue">{formatMoney(cash.USD, 'USD')}</span>
                <span className="cardSub">
                  efectivo en dólares sin invertir{fx && cash.USD !== 0n ? ` (≈ ${formatMoney(toArs(cash.USD, 'USD'))})` : ''}
                </span>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="tableHeader">
              <h2 className="sectionTitle">Tenencias</h2>
              <div className="priceSync">
                <label className="fxBox" title="Tipo de cambio para sumar pesos y dólares. Se actualiza solo con el CCL; escribí otro (ej. tu MEP) para fijarlo, o borralo para volver al CCL.">
                  <span className="hint">{fxManual ? 'Dólar (fijado)' : `Dólar ${fxSource ?? 'MEP'}`} $</span>
                  <input
                    className="priceInput fxInput"
                    inputMode="decimal"
                    value={fxInput}
                    placeholder="—"
                    onChange={(e) => setFxInput(e.target.value)}
                    onBlur={(e) => commitFx(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitFx((e.target as HTMLInputElement).value);
                    }}
                  />
                </label>
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
                          <td>{costLabel(p)}</td>
                          <td>
                            {noLivePrice.has(p.ticker) ? (
                              // Bonds/FCI are valued at imported cost (quoted per
                              // 100 VN / in cuotapartes → no reliable live price).
                              <span
                                className="priceStatic"
                                title={
                                  p.valuedAtCost
                                    ? 'Sin cotización en vivo: valuado al costo'
                                    : 'Cotización de mercado cada 100 VN (data912)'
                                }
                              >
                                {priceLabel(p)}
                              </span>
                            ) : (
                              <input
                                className="priceInput"
                                inputMode="decimal"
                                value={priceInputs[p.ticker] ?? ''}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => updatePrice(p.ticker, e.target.value)}
                              />
                            )}
                          </td>
                          <td>{formatMoney(p.marketValueCents, p.currency)}</td>
                          <td className={p.unrealizedPnlCents >= 0n ? 'pos' : 'neg'}>
                            {formatMoney(p.unrealizedPnlCents, p.currency)}
                          </td>
                          <td className={p.realizedPnlCents >= 0n ? 'pos' : 'neg'}>
                            {formatMoney(p.realizedPnlCents, p.currency)}
                          </td>
                          <td>{pctOfPatrimonio(p.valueArsCents).toFixed(1)}%</td>
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

          <ChartsBottom
            riskTickers={view.positions.map((p) => p.ticker).filter((t) => !noLivePrice.has(t))}
            positions={view.positions.map((p) => ({
              ticker: p.ticker,
              marketValue: centsToPesos(p.valueArsCents),
              unrealizedPnl: centsToPesos(toArs(p.unrealizedPnlCents, p.currency)),
              realizedPnl: centsToPesos(toArs(p.realizedPnlCents, p.currency)),
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
