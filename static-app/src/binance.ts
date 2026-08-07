// Binance client — runs entirely in the browser. The API secret never leaves
// the device: requests are signed locally with HMAC-SHA256 (Web Crypto) and
// sent straight to Binance over HTTPS. Use a READ-ONLY key (no trading, no
// withdrawals). Balances across Spot, Funding and Simple Earn are aggregated
// and valued in USD from public tickers.

const BASE = 'https://api.binance.com';

export interface Creds {
  key: string;
  secret: string;
}

export interface CryptoHolding {
  asset: string;
  amount: number;
  priceUsd: number | null; // null when no USD/BTC pair is found
  valueUsd: number | null;
  sources: string[]; // Spot / Funding / Earn
}

export interface CryptoSnapshot {
  holdings: CryptoHolding[];
  totalUsd: number;
  warnings: string[]; // wallets that couldn't be read (e.g. blocked endpoint)
}

export class BinanceError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

const enc = new TextEncoder();

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Binance rejects requests whose timestamp drifts from server time, so we sign
// with the server clock (offset measured once) instead of the local clock.
let clockOffset = 0;
let clockSynced = false;
async function serverNow(): Promise<number> {
  if (!clockSynced) {
    try {
      const r = await fetch(`${BASE}/api/v3/time`);
      const j = await r.json();
      if (typeof j.serverTime === 'number') clockOffset = j.serverTime - Date.now();
      clockSynced = true;
    } catch {
      /* fall back to the local clock */
    }
  }
  return Date.now() + clockOffset;
}

function friendly(code: number | undefined, msg: string): string {
  if (code === -2015)
    return 'Clave inválida, sin permiso de lectura, o restringida por IP. Creá una key con “Enable Reading” y sin restricción de IP (o agregá tu IP).';
  if (code === -2014) return 'Formato de API key inválido. Revisá que la hayas copiado completa.';
  if (code === -1022) return 'Firma inválida: revisá que el Secret sea correcto.';
  if (code === -1021) return 'Desfasaje de reloj con Binance. Reintentá en unos segundos.';
  return msg || 'Error de Binance';
}

async function signedFetch(
  path: string,
  params: Record<string, string | number>,
  creds: Creds,
  method: 'GET' | 'POST' = 'GET',
): Promise<any> {
  const query = new URLSearchParams({
    ...(params as Record<string, string>),
    timestamp: String(Math.floor(await serverNow())),
    recvWindow: '60000',
  }).toString();
  const signature = await hmacHex(creds.secret, query);
  const url = `${BASE}${path}?${query}&signature=${signature}`;
  let r: Response;
  try {
    r = await fetch(url, { method, headers: { 'X-MBX-APIKEY': creds.key } });
  } catch {
    // Network/CORS failure never reaches an HTTP status.
    throw new BinanceError(
      'No se pudo contactar a Binance desde el navegador (posible bloqueo de red/CORS o restricción geográfica).',
    );
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j && typeof j.code === 'number' && j.code < 0)) {
    throw new BinanceError(friendly(j?.code, j?.msg), j?.code);
  }
  return j;
}

/** Public: all spot tickers as a symbol→price map (no auth). */
async function fetchTickerPrices(): Promise<Record<string, number>> {
  const r = await fetch(`${BASE}/api/v3/ticker/price`);
  const arr = (await r.json()) as { symbol: string; price: string }[];
  const map: Record<string, number> = {};
  for (const x of arr) map[x.symbol] = Number(x.price);
  return map;
}

const STABLE = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD', 'USDP']);

function usdPrice(asset: string, px: Record<string, number>): number | null {
  if (STABLE.has(asset)) return 1;
  const direct = px[`${asset}USDT`];
  if (direct) return direct;
  const viaBtc = px[`${asset}BTC`];
  const btc = px['BTCUSDT'];
  if (viaBtc && btc) return viaBtc * btc;
  return null;
}

type Acc = Map<string, { amount: number; sources: Set<string> }>;
function add(acc: Acc, asset: string, amount: number, source: string) {
  if (!(amount > 0)) return;
  const cur = acc.get(asset) ?? { amount: 0, sources: new Set<string>() };
  cur.amount += amount;
  cur.sources.add(source);
  acc.set(asset, cur);
}

/** Fetch and aggregate all balances, valued in USD. Each wallet is best-effort:
 *  if one endpoint is blocked, the rest still load and a warning is returned. */
export async function fetchCrypto(creds: Creds): Promise<CryptoSnapshot> {
  const acc: Acc = new Map();
  const warnings: string[] = [];

  // Spot balances (this must work; its failure is the real connection error).
  const spot = await signedFetch('/api/v3/account', {}, creds);
  for (const b of spot.balances ?? []) {
    add(acc, b.asset, Number(b.free) + Number(b.locked), 'Spot');
  }

  // Funding wallet — best-effort.
  try {
    const funding = await signedFetch('/sapi/v1/asset/get-funding-asset', {}, creds, 'POST');
    for (const b of funding ?? []) {
      add(acc, b.asset, Number(b.free) + Number(b.locked) + Number(b.freeze ?? 0), 'Funding');
    }
  } catch {
    warnings.push('No se pudo leer la billetera Funding.');
  }

  // Simple Earn (flexible + locked) — best-effort.
  try {
    const flex = await signedFetch('/sapi/v1/simple-earn/flexible/position', { size: 100 }, creds);
    for (const p of flex.rows ?? []) add(acc, p.asset, Number(p.totalAmount), 'Earn');
  } catch {
    warnings.push('No se pudo leer Simple Earn (flexible).');
  }
  try {
    const locked = await signedFetch('/sapi/v1/simple-earn/locked/position', { size: 100 }, creds);
    for (const p of locked.rows ?? []) add(acc, p.asset, Number(p.amount), 'Earn');
  } catch {
    warnings.push('No se pudo leer Simple Earn (bloqueado).');
  }

  const px = await fetchTickerPrices().catch(() => ({} as Record<string, number>));

  const holdings: CryptoHolding[] = [...acc.entries()]
    .map(([asset, { amount, sources }]) => {
      const priceUsd = usdPrice(asset, px);
      const valueUsd = priceUsd != null ? amount * priceUsd : null;
      return { asset, amount, priceUsd, valueUsd, sources: [...sources] };
    })
    // Drop dust below 1 cent to keep the list readable.
    .filter((h) => (h.valueUsd ?? 0) >= 0.01 || h.valueUsd == null)
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  const totalUsd = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
  return { holdings, totalUsd, warnings };
}

// ---- Credential storage (browser only; never sent to our servers) ----------
const K_KEY = 'pm_binance_key';
const K_SECRET = 'pm_binance_secret';

export function loadCreds(): Creds | null {
  try {
    const key = localStorage.getItem(K_KEY) ?? '';
    const secret = localStorage.getItem(K_SECRET) ?? '';
    return key && secret ? { key, secret } : null;
  } catch {
    return null;
  }
}

export function saveCreds(c: Creds): void {
  localStorage.setItem(K_KEY, c.key.trim());
  localStorage.setItem(K_SECRET, c.secret.trim());
}

export function clearCreds(): void {
  localStorage.removeItem(K_KEY);
  localStorage.removeItem(K_SECRET);
}
