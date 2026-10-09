interface Data912Quote {
  symbol: string;
  c: number; // last price
}

// data912 splits the market across several live feeds. Local equities live in
// arg_stocks, but CEDEARs, corporate bonds (ONs) and sovereign bonds are in
// their own feeds, so we query all of them and merge. All are quoted in ARS.
const FEEDS = ['/live/arg_stocks', '/live/arg_cedears', '/live/arg_bonds', '/live/arg_corp'];

export async function fetchLivePrices(
  tickers: string[],
): Promise<{ ticker: string; priceCents: bigint; currency: 'ARS' | 'USD' }[]> {
  const baseUrl = process.env.DATA912_BASE_URL ?? 'https://data912.com';

  const lists = await Promise.all(
    FEEDS.map((feed) =>
      fetch(`${baseUrl}${feed}`)
        .then((res) => (res.ok ? (res.json() as Promise<Data912Quote[]>) : []))
        .catch(() => [] as Data912Quote[]),
    ),
  );

  const wanted = new Set(tickers);
  const seen = new Set<string>();
  const out: { ticker: string; priceCents: bigint; currency: 'ARS' | 'USD' }[] = [];
  for (const quote of lists.flat()) {
    if (!wanted.has(quote.symbol) || seen.has(quote.symbol) || !quote.c) continue;
    seen.add(quote.symbol);
    out.push({ ticker: quote.symbol, priceCents: BigInt(Math.round(quote.c * 100)), currency: 'ARS' });
  }
  return out;
}

async function fetchFeed(path: string): Promise<Data912Quote[]> {
  const baseUrl = process.env.DATA912_BASE_URL ?? 'https://data912.com';
  try {
    const res = await fetch(`${baseUrl}${path}`);
    return res.ok ? ((await res.json()) as Data912Quote[]) : [];
  } catch {
    return [];
  }
}

/** Last price of bonds/ONs as quoted by the market: per 100 nominal value, in
 *  the bond's own currency (ARS for "AL30"/"MGCTO", USD for "AL30D"/"MGCTD").
 *  Callers must divide by 100 to get a per-nominal price. */
export async function fetchBondPricesPer100(tickers: string[]): Promise<Record<string, number>> {
  const wanted = new Set(tickers);
  const out: Record<string, number> = {};
  if (wanted.size === 0) return out;
  const lists = await Promise.all([fetchFeed('/live/arg_bonds'), fetchFeed('/live/arg_corp')]);
  for (const q of lists.flat()) {
    if (wanted.has(q.symbol) && q.c > 0 && out[q.symbol] === undefined) out[q.symbol] = q.c;
  }
  return out;
}

/** Dólar MEP implied by the bond market (pesos per dollar): the ARS price of a
 *  sovereign divided by its USD-settled twin, both per 100 VN. This is how
 *  brokers (and BYMALAB) value dollar holdings. Tries AL30 first, then GD30. */
export async function fetchMepRate(): Promise<number | null> {
  const bonds = await fetchFeed('/live/arg_bonds');
  const px = (s: string) => bonds.find((q) => q.symbol === s)?.c ?? 0;
  for (const [ars, usd] of [['AL30', 'AL30D'], ['GD30', 'GD30D']]) {
    const a = px(ars);
    const d = px(usd);
    if (a > 0 && d > 0) {
      const rate = a / d;
      if (rate > 50 && rate < 100000) return rate; // sanity: both legs quoted per 100
    }
  }
  return null;
}
