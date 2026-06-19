interface Data912Quote {
  symbol: string;
  c: number; // last price
}

export async function fetchLivePrices(
  tickers: string[],
): Promise<{ ticker: string; priceCents: bigint; currency: 'ARS' | 'USD' }[]> {
  const baseUrl = process.env.DATA912_BASE_URL ?? 'https://data912.com';
  const res = await fetch(`${baseUrl}/live/arg_stocks?symbols=${tickers.join(',')}`);

  if (!res.ok) {
    throw new Error(`data912 request failed with status ${res.status}`);
  }

  // The arg_stocks endpoint quotes Argentine equities in ARS and does not
  // include a currency field in its response, despite accepting a symbols
  // query param it does not actually filter by - filter client-side instead.
  const quotes: Data912Quote[] = await res.json();
  const wanted = new Set(tickers);

  return quotes
    .filter((q) => wanted.has(q.symbol))
    .map((q) => ({
      ticker: q.symbol,
      priceCents: BigInt(Math.round(q.c * 100)),
      currency: 'ARS' as const,
    }));
}
