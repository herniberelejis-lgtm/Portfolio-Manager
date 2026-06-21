// Finnhub market-data client (free tier, browser-friendly CORS). The key is
// public by design for client use; it's rate-limited (60 req/min) and free.
const FINNHUB_KEY = 'd8reh7pr01qni6titofgd8reh7pr01qni6titog0';
const BASE = 'https://finnhub.io/api/v1';

// Argentine local tickers -> their US/ADR symbol so Finnhub can resolve them.
// CEDEAR tickers (GOOGL, MSFT, JPM, MA, ...) are already US symbols and pass
// through unchanged.
const SYMBOL_MAP: Record<string, string> = {
  GGAL: 'GGAL', YPFD: 'YPF', BMA: 'BMA', PAMP: 'PAM', CEPU: 'CEPU', CRES: 'CRESY',
  EDN: 'EDN', SUPV: 'SUPV', LOMA: 'LOMA', TGSU2: 'TGS', BBAR: 'BBAR', TEO: 'TEO',
  TXAR: 'TX', CAAP: 'CAAP', DESP: 'DESP', GLOB: 'GLOB', MELI: 'MELI', VIST: 'VIST',
};

// Local tickers that happen to share a letters-only symbol with an unrelated
// US-listed company (no real ADR/CEDEAR link). Without this guard, a ticker
// like CELU (Celulosa Argentina, BYMA-only) would silently resolve to
// Celularity Inc (NYSE: CELU) and show that company's data instead.
const NO_US_LISTING = new Set(['CELU']);

export function lookupSymbol(ticker: string): string {
  return SYMBOL_MAP[ticker] ?? ticker;
}

export function hasUsListing(ticker: string): boolean {
  return !NO_US_LISTING.has(ticker);
}

async function get(path: string): Promise<any> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${path}${sep}token=${FINNHUB_KEY}`);
  if (!res.ok) throw new Error(`Finnhub ${res.status}`);
  return res.json();
}

export interface Analysis {
  ticker: string;
  symbol: string;
  name?: string;
  industry?: string;
  logo?: string;
  weburl?: string;
  price?: number;
  changePct?: number;
  high52?: number;
  low52?: number;
  distFromHighPct?: number;
  pe?: number;
  pb?: number;
  ps?: number;
  peg?: number;
  marketCap?: number; // millions USD
  netMargin?: number;
  roe?: number;
  revGrowth?: number;
  divYield?: number;
  eps?: number;
  beta?: number;
  yearReturnPct?: number;
  prevClose?: number;
  rec?: {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
    period: string;
  } | null;
  news: { headline: string; url: string; datetime: number; source: string }[];
  hasData: boolean;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

async function fetchAnalysis(ticker: string): Promise<Analysis> {
  if (!hasUsListing(ticker)) {
    return { ticker, symbol: ticker, news: [], hasData: false };
  }
  const symbol = lookupSymbol(ticker);
  const [quote, profile, metricResp, recs] = await Promise.all([
    get(`/quote?symbol=${symbol}`).catch(() => ({})),
    get(`/stock/profile2?symbol=${symbol}`).catch(() => ({})),
    get(`/stock/metric?symbol=${symbol}&metric=all`).catch(() => ({})),
    get(`/stock/recommendation?symbol=${symbol}`).catch(() => []),
  ]);
  const m = (metricResp && metricResp.metric) || {};
  const price = num(quote.c);
  const high52 = num(m['52WeekHigh']);
  const low52 = num(m['52WeekLow']);
  const dist = price && high52 ? ((price - high52) / high52) * 100 : undefined;

  const to = new Date();
  const from = new Date(Date.now() - 30 * 864e5);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const news = await get(
    `/company-news?symbol=${symbol}&from=${fmt(from)}&to=${fmt(to)}`,
  ).catch(() => []);

  const a: Analysis = {
    ticker,
    symbol,
    name: profile.name,
    industry: profile.finnhubIndustry,
    logo: profile.logo,
    weburl: profile.weburl,
    price,
    changePct: num(quote.dp),
    high52,
    low52,
    distFromHighPct: dist,
    pe: num(m.peTTM) ?? num(m.peBasicExclExtraTTM) ?? num(m.peNormalizedAnnual),
    pb: num(m.pbAnnual) ?? num(m.pbQuarterly),
    ps: num(m.psTTM) ?? num(m.psAnnual),
    peg: num(m.pegTTM) ?? num(m.pegRatio),
    marketCap: num(profile.marketCapitalization),
    netMargin: num(m.netProfitMarginTTM) ?? num(m.netProfitMarginAnnual),
    roe: num(m.roeTTM) ?? num(m.roeRfy),
    revGrowth: num(m.revenueGrowthTTMYoy),
    divYield: num(m.dividendYieldIndicatedAnnual),
    eps: num(m.epsTTM) ?? num(m.epsBasicExclExtraItemsTTM) ?? num(m.epsInclExtraItemsTTM),
    beta: num(m.beta),
    yearReturnPct: num(m['52WeekPriceReturnDaily']),
    prevClose: num(quote.pc),
    rec: Array.isArray(recs) && recs.length ? recs[0] : null,
    news: (Array.isArray(news) ? news : []).slice(0, 5).map((n: any) => ({
      headline: n.headline,
      url: n.url,
      datetime: n.datetime,
      source: n.source,
    })),
    hasData: false,
  };
  a.hasData = a.price !== undefined || a.pe !== undefined || a.name !== undefined;
  return a;
}

const TTL = 60 * 60 * 1000; // 1 hour

/** Cached per-ticker analysis (localStorage, 1h TTL) to respect the rate limit. */
export async function getAnalysis(ticker: string): Promise<Analysis> {
  const key = `pm_an_${ticker}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const { t, data } = JSON.parse(raw);
      if (Date.now() - t < TTL) return data as Analysis;
    }
  } catch {
    /* ignore */
  }
  const data = await fetchAnalysis(ticker);
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
  } catch {
    /* ignore */
  }
  return data;
}
