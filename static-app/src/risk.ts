// Risk math — pure, unit-tested functions over daily price/return series.
// Only fed with reliable equity/CEDEAR price history (bonds/FCI and tickers
// without data are excluded by the caller), so nothing here relies on dubious
// or fabricated data.

const TRADING_DAYS = 252;
const TRADING_DAYS_MONTH = 21;
const Z_95 = 1.645;

export function toReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) r.push(closes[i] / closes[i - 1] - 1);
  }
  return r;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Sample standard deviation (n-1). */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Annualized volatility (%) from a daily-returns array. */
export function annualizedVolPct(returns: number[]): number {
  return stdev(returns) * Math.sqrt(TRADING_DAYS) * 100;
}

/** Max peak-to-trough drawdown (%, negative) over a close series. */
export function maxDrawdownPct(closes: number[]): number {
  let peak = -Infinity;
  let maxDD = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    if (peak > 0) {
      const dd = (c - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    }
  }
  return maxDD * 100;
}

/** Pearson correlation between two return arrays (aligned, same length). */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

/** Parametric 1-month VaR at 95% (% of portfolio value), from daily returns. */
export function monthlyVaR95Pct(dailyReturns: number[]): number {
  const monthlyVol = stdev(dailyReturns) * Math.sqrt(TRADING_DAYS_MONTH);
  return Z_95 * monthlyVol * 100;
}

/** Weighted portfolio daily-return series over a set of aligned dates. */
export function portfolioReturns(
  assets: { weight: number; returnByDate: Map<string, number> }[],
  dates: string[],
): number[] {
  return dates.map((d) => assets.reduce((s, a) => s + a.weight * (a.returnByDate.get(d) ?? 0), 0));
}

/** Cumulative-value series (base 100) from a return series, for drawdown. */
export function cumulativeValue(returns: number[]): number[] {
  const out: number[] = [100];
  for (const r of returns) out.push(out[out.length - 1] * (1 + r));
  return out;
}
