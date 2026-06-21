// Twelve Data client (free tier, browser-friendly CORS): historical price
// series for stock charts and index/ETF period returns for benchmarks. The key
// is public for client use; it only fetches market data (no user info).
import { lookupSymbol } from './finnhub';

const KEY = '29fc27b8229845cf85971ce33265c193';
const TD = 'https://api.twelvedata.com';
const TTL = 3 * 60 * 60 * 1000; // 3h

export interface PricePoint {
  date: string;
  close: number;
}

async function timeSeries(symbol: string, extra: string): Promise<PricePoint[]> {
  const r = await fetch(`${TD}/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&${extra}&apikey=${KEY}`);
  const j = await r.json();
  if (!j || j.status === 'error' || !Array.isArray(j.values)) throw new Error(j?.message || 'twelvedata');
  return j.values
    .map((v: any) => ({ date: String(v.datetime), close: Number(v.close) }))
    .filter((p: PricePoint) => Number.isFinite(p.close) && p.close > 0)
    .reverse(); // ascending by date
}

/** Daily close history for a ticker's chart (cached 3h). */
export async function fetchPriceHistory(ticker: string, days = 120): Promise<PricePoint[]> {
  const symbol = lookupSymbol(ticker);
  const key = `pm_px_${symbol}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const { t, data } = JSON.parse(raw);
      if (Date.now() - t < TTL) return data as PricePoint[];
    }
  } catch {
    /* ignore */
  }
  const data = await timeSeries(symbol, `outputsize=${days}`);
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
  } catch {
    /* ignore */
  }
  return data;
}

/** Period return (%) of an index/ETF symbol from startDate to the latest close. */
export async function fetchPeriodReturn(symbol: string, startDate: Date): Promise<number> {
  const sd = startDate.toISOString().slice(0, 10);
  const series = await timeSeries(symbol, `start_date=${sd}&outputsize=5000`);
  if (series.length < 2) throw new Error('insuficiente');
  return (series[series.length - 1].close / series[0].close - 1) * 100;
}
