import { useCallback, useEffect, useState } from 'react';
import {
  clearCreds,
  fetchCrypto,
  loadCreds,
  saveCreds,
  type CryptoSnapshot,
  type Creds,
} from './binance';

function usd(v: number | null): string {
  if (v == null) return '—';
  return `US$ ${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function amt(v: number): string {
  return v.toLocaleString('es-AR', { maximumFractionDigits: 8 });
}

/** Read-only Binance connection: shows spot + funding + earn balances valued in
 *  USD. The API key/secret live only in this browser (localStorage). */
export function Cripto() {
  const [creds, setCreds] = useState<Creds | null>(loadCreds());
  const [snap, setSnap] = useState<CryptoSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Connection form state.
  const [keyInput, setKeyInput] = useState('');
  const [secretInput, setSecretInput] = useState('');

  const load = useCallback((c: Creds) => {
    setLoading(true);
    setError(null);
    fetchCrypto(c)
      .then((s) => setSnap(s))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (creds) load(creds);
  }, [creds, load]);

  function connect(e: React.FormEvent) {
    e.preventDefault();
    const c = { key: keyInput.trim(), secret: secretInput.trim() };
    if (!c.key || !c.secret) return;
    saveCreds(c);
    setKeyInput('');
    setSecretInput('');
    setCreds(c);
  }

  function disconnect() {
    clearCreds();
    setCreds(null);
    setSnap(null);
    setError(null);
  }

  if (!creds) {
    return (
      <section className="section">
        <h2 className="sectionTitle">🪙 Conectar Binance</h2>
        <p className="hint">
          Conectá tu cuenta con una API key <strong>solo-lectura</strong> para ver tus tenencias
          cripto valuadas en dólares. Tus claves quedan <strong>solo en este navegador</strong>: se
          usan para firmar el pedido y van directo a Binance, nunca pasan por nuestros servidores.
        </p>
        <details className="cryptoHelp">
          <summary>¿Cómo creo la API key? (30 seg)</summary>
          <ol className="tutList">
            <li>Binance → <em>Perfil → API Management</em> → <em>Create API</em> (tipo “System generated”).</li>
            <li>Verificá con tu 2FA y ponele un nombre (ej. “Portfolio Manager”).</li>
            <li>
              En permisos, dejá <strong>solo “Enable Reading”</strong>. <strong>Desactivá</strong>{' '}
              Spot Trading, Margin, Futures y Withdrawals.
            </li>
            <li>
              En restricción de IP: lo más simple es “Unrestricted” (sirve desde cualquier lado). Si
              querés máxima seguridad, restringí a tu IP, pero puede fallar si cambia.
            </li>
            <li>Copiá la <strong>API Key</strong> y el <strong>Secret Key</strong> (el Secret se muestra una sola vez).</li>
          </ol>
        </details>
        <form className="cryptoForm" onSubmit={connect}>
          <label className="mapLabel">API Key</label>
          <input
            className="priceInput cryptoInput"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Pegá tu API Key"
            autoComplete="off"
          />
          <label className="mapLabel">Secret Key</label>
          <input
            className="priceInput cryptoInput"
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            placeholder="Pegá tu Secret Key"
            autoComplete="off"
          />
          <button className="fileBtn" type="submit">
            Conectar
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="tableHeader">
        <h2 className="sectionTitle">🪙 Cripto (Binance)</h2>
        <div className="priceSync">
          <button className="ghostBtn" onClick={() => load(creds)} disabled={loading}>
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button className="ghostBtn danger" onClick={disconnect}>
            Desconectar
          </button>
        </div>
      </div>

      {loading && !snap && <p className="hint">Leyendo tu cuenta de Binance…</p>}

      {error && (
        <p className="message">
          ⚠️ {error}
        </p>
      )}

      {snap && (
        <>
          <div className="cards">
            <div className="card">
              <span className="cardLabel">Valor total cripto</span>
              <span className="cardValue">{usd(snap.totalUsd)}</span>
            </div>
            <div className="card">
              <span className="cardLabel">Activos</span>
              <span className="cardValue">{snap.holdings.length}</span>
            </div>
          </div>

          {snap.warnings.length > 0 && (
            <details className="errors">
              <summary>{snap.warnings.length} billetera(s) no se pudieron leer</summary>
              <ul>
                {snap.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Activo</th>
                  <th>Cantidad</th>
                  <th>Precio (USD)</th>
                  <th>Valor (USD)</th>
                  <th>% cripto</th>
                  <th>Dónde</th>
                </tr>
              </thead>
              <tbody>
                {snap.holdings.map((h) => (
                  <tr key={h.asset}>
                    <td className="ticker">{h.asset}</td>
                    <td>{amt(h.amount)}</td>
                    <td>{usd(h.priceUsd)}</td>
                    <td>{usd(h.valueUsd)}</td>
                    <td>
                      {snap.totalUsd > 0 && h.valueUsd != null
                        ? `${((h.valueUsd / snap.totalUsd) * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                    <td className="hint">{h.sources.join(', ')}</td>
                  </tr>
                ))}
                {snap.holdings.length === 0 && (
                  <tr>
                    <td colSpan={6} className="hint">
                      No encontramos saldos con valor. Si tenés cripto en Earn/Funding y no aparece,
                      puede que el navegador haya bloqueado esas billeteras (ver aviso arriba).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="hint">
            Valuado con precios spot de Binance en USDT. Las claves se guardan solo en este
            navegador; “Desconectar” las borra.
          </p>
        </>
      )}
    </section>
  );
}
