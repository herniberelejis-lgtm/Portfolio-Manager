// Benchmark data from argentinadatos.com — a free, no-key, CORS-friendly API
// with historical CCL dollar and monthly inflation (IPC) series for Argentina.
// Pure compute helpers are unit-tested; the fetches run in the browser.

export interface DollarPoint { fecha: string; venta: number }
export interface InflPoint { fecha: string; valor: number }

const A = 'https://api.argentinadatos.com/v1';

export async function fetchCCL(): Promise<DollarPoint[]> {
  const r = await fetch(`${A}/cotizaciones/dolares/contadoconliqui`);
  if (!r.ok) throw new Error(`CCL ${r.status}`);
  const data = (await r.json()) as any[];
  return data
    .map((d) => ({ fecha: String(d.fecha), venta: Number(d.venta ?? d.compra) }))
    .filter((d) => d.venta > 0 && d.fecha)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export async function fetchInflation(): Promise<InflPoint[]> {
  const r = await fetch(`${A}/finanzas/indices/inflacion`);
  if (!r.ok) throw new Error(`IPC ${r.status}`);
  const data = (await r.json()) as any[];
  return data
    .map((d) => ({ fecha: String(d.fecha), valor: Number(d.valor) }))
    .filter((d) => Number.isFinite(d.valor) && d.fecha)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Value of the series on or before `date` (falls back to the earliest point). */
export function valueAtDate(series: DollarPoint[], date: Date): number | null {
  if (!series.length) return null;
  const t = date.getTime();
  let best: DollarPoint | null = null;
  for (const p of series) {
    if (new Date(p.fecha).getTime() <= t) best = p;
    else break;
  }
  return (best ?? series[0]).venta;
}

export function latestValue(series: DollarPoint[]): number | null {
  return series.length ? series[series.length - 1].venta : null;
}

/** Accumulated inflation (%) compounding monthly IPC from the month of `from`. */
export function inflationAccum(series: InflPoint[], from: Date): number {
  const fy = from.getFullYear();
  const fm = from.getMonth();
  let factor = 1;
  for (const p of series) {
    const d = new Date(p.fecha);
    if (d.getFullYear() > fy || (d.getFullYear() === fy && d.getMonth() >= fm)) {
      factor *= 1 + p.valor / 100;
    }
  }
  return (factor - 1) * 100;
}

/** BTC price in USD now and at the portfolio start date (CoinGecko, no key). */
export async function fetchBtcUsd(startDate: Date): Promise<{ now: number; start: number }> {
  const CG = 'https://api.coingecko.com/api/v3';
  const dd = String(startDate.getDate()).padStart(2, '0');
  const mm = String(startDate.getMonth() + 1).padStart(2, '0');
  const yyyy = startDate.getFullYear();
  const [nowR, startR] = await Promise.all([
    fetch(`${CG}/simple/price?ids=bitcoin&vs_currencies=usd`).then((r) => r.json()),
    fetch(`${CG}/coins/bitcoin/history?date=${dd}-${mm}-${yyyy}&localization=false`).then((r) => r.json()),
  ]);
  const now = Number(nowR?.bitcoin?.usd);
  const start = Number(startR?.market_data?.current_price?.usd);
  if (!now || !start) throw new Error('BTC sin datos');
  return { now, start };
}
