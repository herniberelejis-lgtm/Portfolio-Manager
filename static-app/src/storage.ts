// Persistence in the browser's localStorage. BigInt and Date are not JSON
// serializable, so transactions are stored with amountCents as a string and
// date as an ISO string, then revived on load.
import type { ParsedTransaction } from './portfolio';

const TX_KEY = 'pm_transactions_v1';
const PRICE_KEY = 'pm_prices_v1';

interface StoredTx {
  date: string;
  type: ParsedTransaction['type'];
  ticker: string | null;
  quantity: number | null;
  price: number | null;
  currency: ParsedTransaction['currency'];
  amountCents: string;
  rawRow: Record<string, string>;
}

export function loadTransactions(): ParsedTransaction[] {
  try {
    const raw = localStorage.getItem(TX_KEY);
    if (!raw) return [];
    const stored = JSON.parse(raw) as StoredTx[];
    return stored.map((t) => ({
      date: new Date(t.date),
      type: t.type,
      ticker: t.ticker,
      quantity: t.quantity,
      price: t.price,
      currency: t.currency,
      amountCents: BigInt(t.amountCents),
      rawRow: t.rawRow ?? {},
    }));
  } catch {
    return [];
  }
}

export function saveTransactions(txs: ParsedTransaction[]): void {
  const stored: StoredTx[] = txs.map((t) => ({
    date: t.date instanceof Date ? t.date.toISOString() : new Date(t.date).toISOString(),
    type: t.type,
    ticker: t.ticker,
    quantity: t.quantity,
    price: t.price,
    currency: t.currency,
    amountCents: t.amountCents.toString(),
    rawRow: t.rawRow ?? {},
  }));
  localStorage.setItem(TX_KEY, JSON.stringify(stored));
}

export function loadPrices(): Record<string, bigint> {
  try {
    const raw = localStorage.getItem(PRICE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, bigint> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = BigInt(v);
    return out;
  } catch {
    return {};
  }
}

export function savePrices(prices: Record<string, bigint>): void {
  const obj: Record<string, string> = {};
  for (const [k, v] of Object.entries(prices)) obj[k] = v.toString();
  localStorage.setItem(PRICE_KEY, JSON.stringify(obj));
}

export function clearAll(): void {
  localStorage.removeItem(TX_KEY);
  localStorage.removeItem(PRICE_KEY);
}
