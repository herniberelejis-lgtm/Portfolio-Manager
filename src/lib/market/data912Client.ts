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
